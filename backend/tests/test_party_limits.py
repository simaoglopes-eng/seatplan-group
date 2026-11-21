"""One booker cannot take a whole event: the party size and the lifetime limit.

The proof of concept that led here: one POST .../party/confirm with 39
members took every free place of a 40-seat event. Now the event's
max_party_size (default 8, the booker's own seat included) refuses the 9th
seat, and a booker who keeps adding and removing people stops after
3 x their limit companion rows (core/limits.py).
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from party_helpers import (
    Door,
    account_door,
    companions,
    counts,
    invited_event,
    link_door,
    party_body,
    person,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import db
from app.core import limits
from app.core.errors import ApiError
from app.events_service import party, share
from app.events_service.schemas import PartyConfirmIn
from app.models import Event, Guest, Organiser


def _members(seats: list[int]) -> list[dict[str, Any]]:
    return [person(seat, "Kid", f"Number{n}", 7) for n, seat in enumerate(seats)]


def _flat(setup: Any) -> list[int]:
    return [seat for table in setup.seats for seat in table]


def _set_limit(client: TestClient, setup: Any, value: Any) -> Any:
    return client.patch(
        f"/api/events/{setup.eid}", headers=setup.headers, json={"max_party_size": value}
    )


def _doors(client: TestClient, organiser: Organiser, kind: str) -> tuple[Any, Door]:
    if kind == "link":
        setup = invited_event(client, organiser, ["Ana Silva"], tables=10, per_table=4)
        return setup, link_door(setup, "Ana Silva")
    setup, door, _ = account_door(client, organiser, tables=10, per_table=4)
    return setup, door


@pytest.mark.parametrize("kind", ["link", "account"])
def test_the_39_seat_grab_is_refused_at_the_ninth_seat(
    client: TestClient, organiser: Organiser, session: Session, kind: str
) -> None:
    setup, door = _doors(client, organiser, kind)
    seats = _flat(setup)
    assert len(seats) == 40
    before = counts(session)
    grab = door.confirm(client, party_body(seats[0], _members(seats[1:40])))
    assert grab.status_code == 409, grab.text
    error = grab.json()["error"]
    assert error["code"] == "party_too_large"
    assert "up to 8 seats" in error["message"]
    assert error["details"] == {"max_party_size": 8, "party_size_left": 7}
    # Booker + 8 members is 9 seats: still one too many.
    nine = door.confirm(client, party_body(seats[0], _members(seats[1:9])))
    assert nine.status_code == 409 and nine.json()["error"]["code"] == "party_too_large"
    assert counts(session) == before  # nothing written

    eight = door.confirm(client, party_body(seats[0], _members(seats[1:8])))
    assert eight.status_code == 200, eight.text
    view = eight.json()
    assert len(view["members"]) == 7
    assert view["max_party_size"] == 8 and view["party_size_left"] == 0
    # Adding one more later is refused too ("Add people" keeps the booker's seat).
    more = door.confirm(client, party_body(seats[0], _members(seats[20:21])))
    assert more.status_code == 409 and more.json()["error"]["code"] == "party_too_large"
    assert "Ask the organiser" in more.json()["error"]["message"]


def test_a_removed_member_frees_a_place_in_the_party(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"], tables=3, per_table=4)
    ana = link_door(setup, "Ana Silva")
    seats = _flat(setup)
    assert _set_limit(client, setup, 3).status_code == 200
    booked = ana.confirm(client, party_body(seats[0], _members(seats[1:3])))
    assert booked.status_code == 200, booked.text
    assert booked.json()["party_size_left"] == 0
    first = booked.json()["members"][0]["id"]
    assert ana.delete(client, f"/party/{first}").status_code == 200
    page = ana.page(client)
    assert page["party"]["party_size_left"] == 1
    again = ana.confirm(client, party_body(seats[0], _members(seats[5:6])))
    assert again.status_code == 200, again.text


def test_the_organiser_sets_the_limit_or_no_limit(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"], tables=6, per_table=4)
    seats = _flat(setup)
    event = client.get(f"/api/events/{setup.eid}", headers=setup.headers).json()["event"]
    assert event["max_party_size"] is None and event["default_max_party_size"] == 8
    for bad in (-1, 501, "4", 2.5, True):
        refused = _set_limit(client, setup, bad)
        assert refused.status_code == 422, (bad, refused.text)
    assert _set_limit(client, setup, 0).json()["max_party_size"] == 0  # 0: no limit
    ana = link_door(setup, "Ana Silva")
    big = ana.confirm(client, party_body(seats[0], _members(seats[1:16])))
    assert big.status_code == 200, big.text
    assert big.json()["max_party_size"] is None and big.json()["party_size_left"] is None
    # Back to the default with null.
    assert _set_limit(client, setup, None).json()["max_party_size"] is None
    assert ana.page(client)["party"]["max_party_size"] == 8


def test_the_body_limit_is_500_members(client: TestClient, organiser: Organiser) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"])
    ana = link_door(setup, "Ana Silva")
    body = party_body(setup.seats[0][0], [person(1, "A", "B", 1)] * 501)
    assert ana.confirm(client, body).status_code == 422


def test_the_limit_is_read_after_the_lock(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    """L3: the organiser lowers the limit while a confirm waits for the lock.

    The request loaded the event before the lock; party.confirm_party must
    read it again (session.refresh) instead of trusting the old copy.
    """
    setup = invited_event(client, organiser, ["Ana Silva"])
    seats = _flat(setup)
    event = session.scalars(select(Event).where(Event.public_id == setup.eid)).one()
    me = session.scalars(select(Guest).where(Guest.name == "Ana Silva")).one()
    assert event.max_party_size is None  # loaded now: the default, 8
    with db.new_session() as other:
        other.get(Event, event.id).max_party_size = 2  # type: ignore[union-attr]
        other.commit()
    body = PartyConfirmIn.model_validate(party_body(seats[0], _members(seats[1:3])))
    with pytest.raises(ApiError) as refused:
        party.confirm_party(session, event, me, body, None)
    assert refused.value.code == "party_too_large"
    session.rollback()


def test_a_booker_who_keeps_changing_people_stops_at_three_times_the_limit(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"], tables=2, per_table=4)
    ana = link_door(setup, "Ana Silva")
    seats = _flat(setup)
    assert _set_limit(client, setup, 2).status_code == 200  # 1 member at a time, 6 in all
    booked = ana.confirm(client, party_body(seats[0]))
    assert booked.status_code == 200, booked.text
    for _ in range(6):
        added = ana.confirm(client, party_body(seats[0], _members(seats[1:2])))
        assert added.status_code == 200, added.text
        member_id = added.json()["members"][0]["id"]
        assert ana.delete(client, f"/party/{member_id}").status_code == 200
    me = session.scalars(select(Guest).where(Guest.name == "Ana Silva")).one()
    assert len(companions(session, me.id)) == 6  # six emptied rows
    before = counts(session)
    seventh = ana.confirm(client, party_body(seats[0], _members(seats[1:2])))
    assert seventh.status_code == 409, seventh.text
    assert seventh.json()["error"]["code"] == "party_changes_exhausted"
    assert "Ask the organiser" in seventh.json()["error"]["message"]
    assert counts(session) == before


def test_no_party_limit_counts_as_the_largest_setting_for_the_lifetime_limit(
    client: TestClient, organiser: Organiser
) -> None:
    """No limit (0) is never stricter than 500: 3 x 500 people over the event, not 24."""
    assert limits.PARTY_CHANGES_NO_LIMIT == 3 * limits.MAX_PARTY_SIZE_SETTING == 1500
    setup = invited_event(client, organiser, ["Ana Silva"], tables=8, per_table=4)
    assert _set_limit(client, setup, 0).status_code == 200
    ana = link_door(setup, "Ana Silva")
    seats = _flat(setup)
    first = ana.confirm(client, party_body(seats[0], _members(seats[1:31])))
    assert first.status_code == 200, first.text  # 30 members at once (24 was refused)
    assert len(first.json()["members"]) == 30


def test_erased_members_are_not_read_for_the_place_counts(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    """Churn: emptied companion rows stay, but the counts under the lock skip them."""
    setup = invited_event(client, organiser, ["Ana Silva"], tables=2, per_table=4)
    ana = link_door(setup, "Ana Silva")
    seats = _flat(setup)
    booked = ana.confirm(client, party_body(seats[0], _members(seats[1:3])))
    gone = booked.json()["members"][0]["id"]
    assert ana.delete(client, f"/party/{gone}").status_code == 200
    session.expire_all()
    event = session.scalars(select(Event).where(Event.public_id == setup.eid)).one()
    read = {guest.id for guest in share._counted_guests(session, event)}
    assert gone not in read
    assert share.place_counts(session, event) == {"capacity": 8, "guests": 2, "joined": 0}
    assert ana.page(client)["party"]["places_left"] == 6
    assert limits.DEFAULT_MAX_PARTY_SIZE == 8
