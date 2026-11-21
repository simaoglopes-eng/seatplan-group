"""Who may touch a party member (IDOR checks).

A booker reaches only the rows they booked, on their own event. Anything
else, including an id that does not exist, answers the same 404, so a wrong
id and a forbidden one cannot be told apart. A party member has no login.
"""

from typing import Any

import pytest
from conftest import auth_header, make_user
from fastapi.testclient import TestClient
from guest_helpers import account_headers, make_account
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
from sqlalchemy.orm import Session

from app.models import Guest, Organiser

NOT_IN_PARTY = "This person is not in your party."


def _book(client: TestClient, door: Door, seats: list[int]) -> int:
    response = door.confirm(client, party_body(seats[0], [person(seats[1], "Bea", "Silva", 9)]))
    assert response.status_code == 200, response.text
    return int(response.json()["members"][0]["id"])


def _all_member_calls(client: TestClient, door: Door, member_id: Any, seat_id: int) -> list[Any]:
    return [
        door.patch(client, f"/party/{member_id}", {"first_name": "Hacked"}),
        door.put(client, f"/party/{member_id}/seat", {"seat_id": seat_id}),
        door.delete(client, f"/party/{member_id}"),
    ]


def _assert_not_found(responses: list[Any]) -> None:
    for response in responses:
        assert response.status_code == 404, response.text
        assert response.json()["error"] == {"code": "not_found", "message": NOT_IN_PARTY}


def test_booker_cannot_touch_another_bookers_member(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva", "Bruno Costa"])
    member_id = _book(client, link_door(setup, "Ana Silva"), setup.seats[0])
    bruno = link_door(setup, "Bruno Costa")
    before = counts(session)
    _assert_not_found(_all_member_calls(client, bruno, member_id, setup.seats[1][0]))
    assert counts(session) == before
    member = session.get(Guest, member_id)
    assert member is not None and member.first_name == "Bea" and member.token_revoked_at is None
    # Bruno's own party view does not list Ana's member.
    assert bruno.get(client, "/party").json()["members"] == []


def test_member_of_another_event_is_not_found(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    first = invited_event(client, organiser, ["Ana Silva"])
    second = invited_event(client, organiser, ["Ana Silva"])
    member_id = _book(client, link_door(first, "Ana Silva"), first.seats[0])
    other_ana = link_door(second, "Ana Silva")
    _assert_not_found(_all_member_calls(client, other_ana, member_id, second.seats[1][0]))


def test_booker_id_is_not_a_member_id(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva", "Bruno Costa"])
    ana = link_door(setup, "Ana Silva")
    member_id = _book(client, ana, setup.seats[0])
    for target in (setup.guests["Ana Silva"], setup.guests["Bruno Costa"], 1999999):
        _assert_not_found(_all_member_calls(client, ana, target, setup.seats[1][0]))
    # A removed member is gone for good.
    assert ana.delete(client, f"/party/{member_id}").status_code == 200
    _assert_not_found(_all_member_calls(client, ana, member_id, setup.seats[1][0]))


@pytest.mark.parametrize(
    "member_id", ["abc", "1.5", "0", "-3", "99999999999999999999", "2000000001"]
)
def test_member_id_that_is_not_a_sane_integer_is_a_validation_error(
    client: TestClient, organiser: Organiser, member_id: str
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"])
    ana = link_door(setup, "Ana Silva")
    _book(client, ana, setup.seats[0])
    for response in _all_member_calls(client, ana, member_id, setup.seats[1][0]):
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation"


def test_account_door_only_reaches_own_rows(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup, kai, _token = account_door(client, organiser)
    member_id = _book(client, kai, setup.seats[0])
    lia = Door(kai.base, account_headers(make_account(session, "lia@example.com")))
    # Lia has no row on this event at all: the door itself is closed.
    assert lia.get(client, "/party").status_code == 404
    for response in _all_member_calls(client, lia, member_id, setup.seats[1][0]):
        assert response.status_code == 404
    # Kai's own session on another event he never joined.
    other = invited_event(client, organiser, ["Olga Outro"])
    elsewhere = Door(f"/api/guest/events/{other.eid}", kai.headers)
    assert elsewhere.get(client, "/party").status_code == 404
    for response in _all_member_calls(client, elsewhere, member_id, other.seats[0][0]):
        assert response.status_code == 404
    # No session at all.
    assert Door(kai.base).get(client, "/party").status_code == 401
    session.expire_all()
    assert session.get(Guest, member_id).first_name == "Bea"  # type: ignore[union-attr]


def test_member_has_no_link_and_new_link_is_refused(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"])
    member_id = _book(client, link_door(setup, "Ana Silva"), setup.seats[0])
    member = companions(session, setup.guests["Ana Silva"])[0]
    assert (member.account_id, member.email) == (None, None)
    base = f"/api/events/{setup.eid}/guests/{member_id}"
    refused = client.post(f"{base}/new-link", headers=setup.headers)
    assert refused.status_code == 409
    assert refused.json()["error"] == {
        "code": "party_member",
        "message": "Party members are managed by the guest who booked them.",
    }
    # Giving the member an address would let an account with it take the row over.
    email = client.patch(base, headers=setup.headers, json={"email": "bea@example.com"})
    assert email.status_code == 409 and email.json()["error"]["code"] == "party_member"
    session.expire_all()
    stored = session.get(Guest, member_id)
    assert stored is not None and stored.email is None
    # The booker's own link still works as before.
    own_link = f"/api/events/{setup.eid}/guests/{setup.guests['Ana Silva']}/new-link"
    assert client.post(own_link, headers=setup.headers).status_code == 200


def test_organiser_of_another_event_sees_nothing(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"])
    member_id = _book(client, link_door(setup, "Ana Silva"), setup.seats[0])
    stranger = auth_header(make_user(session, "someone.else@example.com"))
    base = f"/api/events/{setup.eid}/guests"
    assert client.get(base, headers=stranger).status_code == 404
    assert client.patch(f"{base}/{member_id}", headers=stranger, json={"age": 1}).status_code == 404
    assert client.delete(f"{base}/{member_id}", headers=stranger).status_code == 404
    # Their own event does not reach it either.
    own = invited_event(client, make_user(session, "own.event@example.com"), ["Olga Outro"])
    reach = client.patch(
        f"/api/events/{own.eid}/guests/{member_id}", headers=own.headers, json={"age": 1}
    )
    assert reach.status_code == 404
    session.expire_all()
    assert session.get(Guest, member_id).age_years == 9  # type: ignore[union-attr]
