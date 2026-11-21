"""Deleting a booker, a party member, or the account that booked a party.

Erasure keeps the row (plan snapshots point at ids) but overwrites every
personal detail, the age included, and frees the seat.
"""

import pytest
from fastapi.testclient import TestClient
from guest_helpers import GUEST_PASSWORD, bearer, shared_event, sign_up, use_inbox_code
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
from test_events_setup import EventSetup

from app.models import Guest, Organiser, SeatAssignment


def _seated(session: Session) -> dict[int, int]:
    session.expire_all()
    return {row.guest_id: row.seat_id for row in session.scalars(select(SeatAssignment))}


def _book_two(client: TestClient, door: Door, seats: list[int]) -> list[int]:
    members = [person(seats[1], "Bea", "Silva", 9), person(seats[2], "Caio", "Silva", 12)]
    response = door.confirm(client, party_body(seats[0], members, age=41))
    assert response.status_code == 200, response.text
    return [member["id"] for member in response.json()["members"]]


def _assert_erased(session: Session, guest_id: int) -> None:
    session.expire_all()
    row = session.get(Guest, guest_id)
    assert row is not None, "erasure keeps the row"
    assert row.token_revoked_at is not None and row.name == "Deleted guest"
    assert (row.first_name, row.last_name, row.age_years, row.email) == (None, None, None, None)
    assert row.rsvp == "no"


def _guest_ids(client: TestClient, setup: EventSetup) -> set[int]:
    response = client.get(f"/api/events/{setup.eid}/guests", headers=setup.headers)
    return {guest["id"] for guest in response.json()}


def test_delete_booker_without_choice_is_409_has_party(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"])
    member_ids = _book_two(client, link_door(setup, "Ana Silva"), setup.seats[0])
    before = counts(session)
    url = f"/api/events/{setup.eid}/guests/{setup.guests['Ana Silva']}"
    refused = client.delete(url, headers=setup.headers)
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "has_party"
    assert refused.json()["error"]["details"] == {"party_size": 2, "member_ids": member_ids}
    assert counts(session) == before
    assert client.delete(f"{url}?party=everyone", headers=setup.headers).status_code == 422
    # Deleting a member directly needs no choice.
    alone = client.delete(f"/api/events/{setup.eid}/guests/{member_ids[0]}", headers=setup.headers)
    assert alone.status_code == 200
    assert alone.json() == {"erased": True, "guest_id": member_ids[0]}
    _assert_erased(session, member_ids[0])


def test_delete_booker_party_erase_erases_all(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva", "Bruno Costa"])
    ana_id = setup.guests["Ana Silva"]
    member_ids = _book_two(client, link_door(setup, "Ana Silva"), setup.seats[0])
    url = f"/api/events/{setup.eid}/guests/{ana_id}?party=erase"
    response = client.delete(url, headers=setup.headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"erased": True, "guest_id": ana_id, "party_erased": member_ids}
    for guest_id in (ana_id, *member_ids):
        _assert_erased(session, guest_id)
    assert _seated(session) == {}
    assert _guest_ids(client, setup) == {setup.guests["Bruno Costa"]}


def test_delete_booker_party_keep_keeps_members_seated(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"])
    ana_id = setup.guests["Ana Silva"]
    member_ids = _book_two(client, link_door(setup, "Ana Silva"), setup.seats[0])
    url = f"/api/events/{setup.eid}/guests/{ana_id}?party=keep"
    response = client.delete(url, headers=setup.headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"erased": True, "guest_id": ana_id, "party_erased": []}
    _assert_erased(session, ana_id)
    seated = _seated(session)
    assert seated == {member_ids[0]: setup.seats[0][1], member_ids[1]: setup.seats[0][2]}
    guests = client.get(f"/api/events/{setup.eid}/guests", headers=setup.headers).json()
    assert [(g["id"], g["booked_by_guest_id"]) for g in guests] == [
        (member_ids[0], ana_id),
        (member_ids[1], ana_id),
    ]
    # The booker's link is dead, so only the organiser manages the members now.
    assert link_door(setup, "Ana Silva").get(client, "/party").status_code == 404
    edited = client.patch(
        f"/api/events/{setup.eid}/guests/{member_ids[0]}", headers=setup.headers, json={"age": 10}
    )
    assert edited.status_code == 200 and edited.json()["age"] == 10


def test_account_deletion_erases_members_self_registered(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup, kai, token = account_door(client, organiser)
    member_ids = _book_two(client, kai, setup.seats[0])
    kai_id = kai.get(client, "/party").json()["me"]["guest_id"]
    assert [row.id for row in companions(session, kai_id)] == member_ids
    deleted = client.post(
        "/api/guest/me/delete", headers=bearer(token), json={"password": GUEST_PASSWORD}
    )
    assert deleted.status_code == 200, deleted.text
    for guest_id in member_ids:
        _assert_erased(session, guest_id)
    assert _seated(session) == {}
    assert _guest_ids(client, setup) == set()


def test_account_deletion_erases_members_invited(
    client: TestClient, organiser: Organiser, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    invited = [{"name": "Lia Lobo", "email": "lia@example.com"}]
    setup, share_token = shared_event(client, organiser, invited)
    # No code is shown on screen for an invited address: read it from the "inbox".
    code = use_inbox_code(monkeypatch)
    token = sign_up(client, share_token, "lia@example.com", name="Lia Lobo", code=code)["token"]
    door = Door(f"/api/guest/events/{setup.eid}", bearer(token))
    lia_id = door.get(client, "/party").json()["me"]["guest_id"]
    member_ids = _book_two(client, door, setup.seats[0])
    session.expire_all()
    assert session.get(Guest, lia_id).age_years == 41  # type: ignore[union-attr]
    deleted = client.post(
        "/api/guest/me/delete", headers=bearer(token), json={"password": GUEST_PASSWORD}
    )
    assert deleted.status_code == 200, deleted.text
    for guest_id in member_ids:
        _assert_erased(session, guest_id)
    session.expire_all()
    lia = session.get(Guest, lia_id)
    # The invitation stays the organiser's, without what the account holder typed.
    assert lia is not None and lia.token_revoked_at is None and lia.account_id is None
    assert (lia.first_name, lia.last_name, lia.age_years) == (None, None, None)
    assert _seated(session) == {}
    assert _guest_ids(client, setup) == {lia_id}


def test_account_deletion_after_keep_erases_the_kept_members(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup, kai, token = account_door(client, organiser)
    member_ids = _book_two(client, kai, setup.seats[0])
    kai_id = kai.get(client, "/party").json()["me"]["guest_id"]
    kept = client.delete(
        f"/api/events/{setup.eid}/guests/{kai_id}?party=keep", headers=setup.headers
    )
    assert kept.status_code == 200
    assert _guest_ids(client, setup) == set(member_ids)
    deleted = client.post(
        "/api/guest/me/delete", headers=bearer(token), json={"password": GUEST_PASSWORD}
    )
    assert deleted.status_code == 200, deleted.text
    for guest_id in member_ids:
        _assert_erased(session, guest_id)
    assert _guest_ids(client, setup) == set()


def test_erase_clears_age_years(client: TestClient, organiser: Organiser, session: Session) -> None:
    setup = invited_event(client, organiser, ["Ana Silva"])
    ana_id = setup.guests["Ana Silva"]
    member_ids = _book_two(client, link_door(setup, "Ana Silva"), setup.seats[0])
    session.expire_all()
    assert session.get(Guest, ana_id).age_years == 41  # type: ignore[union-attr]
    for guest_id in member_ids:
        url = f"/api/events/{setup.eid}/guests/{guest_id}"
        assert client.delete(url, headers=setup.headers).status_code == 200
        _assert_erased(session, guest_id)
    # No members left: the booker goes without a choice, age and all.
    url = f"/api/events/{setup.eid}/guests/{ana_id}"
    assert client.delete(url, headers=setup.headers).json() == {"erased": True, "guest_id": ana_id}
    _assert_erased(session, ana_id)
