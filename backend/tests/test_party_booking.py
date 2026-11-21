"""Party booking: one booker chooses several seats and names everyone on them.

POST {door}/party/confirm seats the booker and every new party member in one
transaction under the event lock: all of it is written, or none of it.
There are no holds (they answer 410): the first to confirm wins.
"""

import json
import threading
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
    seat_of,
)
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_events_setup import choose, recorded_writes, seat_state

from app.models import AuditLog, EmailOutbox, Guest, GuestGroup, Organiser, SeatAssignment

NAMES = ["Ana Silva", "Bruno Costa", "Carla Dias"]


def _guest(session: Session, guest_id: int) -> Guest:
    session.expire_all()
    found = session.get(Guest, guest_id)
    assert found is not None
    return found


def _seat_owner(session: Session, seat_id: int) -> int | None:
    session.expire_all()
    row = session.scalars(select(SeatAssignment).where(SeatAssignment.seat_id == seat_id)).first()
    return row.guest_id if row else None


def _error(response: Any) -> dict[str, Any]:
    return response.json()["error"]


def test_party_confirm_seats_booker_and_members_in_one_go(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1, s2 = setup.seats[0][:3]
    members = [person(s1, "Bea", "Silva", 9), person(s2, "Caio", "Silva", 12)]
    response = ana.confirm(client, party_body(s0, members, first="Ana", last="Silva", age=40))
    assert response.status_code == 200, response.text
    view = response.json()
    ana_id = setup.guests["Ana Silva"]
    assert view["me"] == {
        "guest_id": ana_id,
        "first_name": "Ana",
        "last_name": "Silva",
        "age_saved": True,
        "seat_id": s0,
        "details_complete": True,
    }
    rows = companions(session, ana_id)
    assert [(m["id"], m["first_name"], m["last_name"], m["seat_id"]) for m in view["members"]] == [
        (rows[0].id, "Bea", "Silva", s1),
        (rows[1].id, "Caio", "Silva", s2),
    ]
    assert all(m["age_saved"] is True and m["rsvp"] == "yes" for m in view["members"])
    # 8 seats, 3 invited guests and 2 new members: 3 places left.
    assert view["places_left"] == 3

    for row, age in zip(rows, (9, 12), strict=True):
        assert row.source == "companion" and row.event_id == _guest(session, ana_id).event_id
        assert (row.email, row.account_id, row.reserved_tag) == (None, None, None)
        assert row.age_years == age and row.rsvp == "yes" and not row.wants_anonymous
        assert row.token_hash and row.token_revoked_at is None
    assert [_seat_owner(session, seat) for seat in (s0, s1, s2)] == [ana_id, rows[0].id, rows[1].id]
    session.expire_all()
    sources = {row.source for row in session.scalars(select(SeatAssignment))}
    assert sources == {"self"}

    page = ana.page(client)
    assert page["party"] == view
    assert page["me"]["name"] == "Ana Silva" and page["me"]["age_saved"] is True
    assert seat_of(page, s0)["occupant"] == "You" and seat_of(page, s0)["state"] == "mine"
    assert "party_member_id" not in seat_of(page, s0)
    bea_seat = seat_of(page, s1)
    assert bea_seat["state"] == "mine" and bea_seat["occupant"] == "Bea Silva"
    assert bea_seat["party_member_id"] == rows[0].id
    # The booker's own members are in "Your party", not in the people list.
    assert {p["name"] for p in page["people"]} == {"Bruno C.", "Carla D."}

    session.expire_all()
    audits = list(session.scalars(select(AuditLog).where(AuditLog.action == "party.confirm")))
    assert len(audits) == 1
    assert audits[0].actor == f"guest:{ana_id}" and audits[0].entity_id == str(ana_id)
    assert audits[0].detail == {
        "seat_ids": [s0, s1, s2],
        "member_ids": [rows[0].id, rows[1].id],
        "old_seat_id": None,
    }
    mails = [m for m in session.scalars(select(EmailOutbox)) if m.kind.startswith("seat")]
    assert [(m.kind, m.to_email) for m in mails] == [("seat_confirmed", "ana@example.com")]


def test_party_of_one_saves_booker_details_and_seat(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    body = party_body(setup.seats[0][0], first="  Ana Maria ", last=" Silva ", age=33)
    response = ana.confirm(client, body)
    assert response.status_code == 200, response.text
    assert response.json()["members"] == []
    assert response.json()["me"]["details_complete"] is True
    row = _guest(session, setup.guests["Ana Silva"])
    assert (row.first_name, row.last_name, row.name, row.age_years) == (
        "Ana Maria",
        "Silva",
        "Ana Maria Silva",
        33,
    )
    # No members, so no party group.
    assert row.group_id is None
    assert seat_state(ana.page(client), setup.seats[0][0]) == "mine"


def test_add_your_details_after_a_legacy_confirm(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    # Seated without details: the one-seat confirm now needs them first, so the
    # organiser places her (as for a guest seated before details existed).
    placed = client.put(
        f"/api/events/{setup.eid}/assignments/{setup.guests['Ana Silva']}",
        headers=setup.headers,
        json={"seat_id": setup.seats[0][0]},
    )
    assert placed.status_code == 200, placed.text
    ana = link_door(setup, "Ana Silva")
    party = ana.page(client)["party"]
    assert party["me"]["details_complete"] is False and party["me"]["age_saved"] is False
    no_age = ana.post(client, "/party/me", {"first_name": "Ana", "last_name": "Silva"})
    assert no_age.status_code == 422 and _error(no_age)["message"] == "age: Enter your age."
    saved = ana.post(client, "/party/me", {"first_name": "Ana", "last_name": "Silva", "age": 41})
    assert saved.status_code == 200, saved.text
    assert saved.json()["me"]["details_complete"] is True
    # Leaving the age out keeps the saved one.
    kept = ana.post(client, "/party/me", {"first_name": "Anabela", "last_name": "Silva"})
    assert kept.status_code == 200 and kept.json()["me"]["first_name"] == "Anabela"
    assert _guest(session, setup.guests["Ana Silva"]).age_years == 41
    assert "age" not in kept.json()["me"]


BAD_PEOPLE = [
    ("first_name", ""),
    ("first_name", "   "),
    ("first_name", "x" * 61),
    ("last_name", ""),
    ("last_name", " \t "),
    ("last_name", "y" * 61),
    ("first_name", "A\x00na"),
    ("age", -1),
    ("age", 121),
    ("age", "7"),
    ("age", 7.5),
    ("age", True),
    ("age", None),
]


@pytest.mark.parametrize(("field", "value"), BAD_PEOPLE)
def test_every_person_needs_first_last_and_age(
    client: TestClient, organiser: Organiser, session: Session, field: str, value: Any
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1 = setup.seats[0][:2]
    before = counts(session)
    member = {**person(s1, "Bea", "Silva", 9), field: value}
    response = ana.confirm(client, party_body(s0, [member]))
    assert response.status_code == 422, response.text
    assert _error(response)["code"] == "validation"
    # The same rule for the booker's own card (age None means "keep the saved one").
    if not (field == "age" and value is None):
        me = {**party_body(s0)["me"], field: value}
        refused = ana.confirm(client, {"me": me, "members": []})
        assert refused.status_code == 422, refused.text
    assert counts(session) == before
    assert _guest(session, setup.guests["Ana Silva"]).first_name is None


def test_a_member_without_age_and_a_booker_without_any_age_are_refused(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1 = setup.seats[0][:2]
    member = {"seat_id": s1, "first_name": "Bea", "last_name": "Silva"}
    assert ana.confirm(client, party_body(s0, [member])).status_code == 422
    no_age = ana.confirm(client, party_body(s0, age=None))
    assert no_age.status_code == 422
    assert _error(no_age)["message"] == "age: Enter your age."
    blank = ana.confirm(client, party_body(s0, [person(s1, " ", "Silva", 9)]))
    assert _error(blank)["message"] == "first_name: Enter a first name."
    blank_last = ana.confirm(client, party_body(s0, [person(s1, "Bea", " ", 9)]))
    assert _error(blank_last)["message"] == "last_name: Enter a last name."
    unknown = ana.confirm(client, {**party_body(s0), "extra": 1})
    assert unknown.status_code == 422
    assert companions(session, setup.guests["Ana Silva"]) == []


def test_combined_name_over_120_is_refused(client: TestClient, organiser: Organiser) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1 = setup.seats[0][:2]
    too_long = ana.confirm(client, party_body(s0, [person(s1, "a" * 60, "b" * 60, 9)]))
    assert too_long.status_code == 422
    assert _error(too_long)["message"] == (
        "Shorten the first or last name (120 characters together at most)."
    )
    fits = ana.confirm(client, party_body(s0, [person(s1, "a" * 60, "b" * 59, 9)]))
    assert fits.status_code == 200, fits.text


def test_duplicate_seat_in_one_request_is_refused(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1 = setup.seats[0][:2]
    before = counts(session)
    for body in (
        party_body(s0, [person(s0, "Bea", "Silva", 9)]),
        party_body(s0, [person(s1, "Bea", "Silva", 9), person(s1, "Caio", "Silva", 12)]),
    ):
        response = ana.confirm(client, body)
        assert response.status_code == 422
        assert _error(response)["message"] == "Each seat can be chosen once."
    assert counts(session) == before


def test_one_taken_seat_refuses_the_whole_party_and_writes_nothing(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0, s1, s2 = setup.seats[0][:3]
    choose(client, setup, "Bruno Costa", s2)
    ana = link_door(setup, "Ana Silva")
    before = counts(session)
    body = party_body(s0, [person(s1, "Bea", "Silva", 9), person(s2, "Caio", "Silva", 12)])
    response = ana.confirm(client, body)
    assert response.status_code == 409
    error = _error(response)
    assert error["code"] == "seat_taken" and error["details"] == {"seat_ids": [s2]}
    assert counts(session) == before
    row = _guest(session, setup.guests["Ana Silva"])
    assert (row.first_name, row.age_years, row.name) == (None, None, "Ana Silva")
    assert _seat_owner(session, s0) is None and _seat_owner(session, s1) is None
    # The booker's own seat taken by someone else also names it.
    mine_taken = ana.confirm(client, party_body(s2, [person(s1, "Bea", "Silva", 9)]))
    assert _error(mine_taken)["details"] == {"seat_ids": [s2]}
    assert counts(session) == before


def test_blocked_reserved_and_foreign_seats_are_refused_with_their_ids(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    extras = {(0, 2): {"is_blocked": True}, (0, 3): {"reserved_tag": "vip"}}
    setup = invited_event(client, organiser, NAMES, extras=extras)
    other = invited_event(client, organiser, ["Olga Outro"])
    ana = link_door(setup, "Ana Silva")
    s0, s1, blocked, vip = setup.seats[0]
    before = counts(session)
    refused = ana.confirm(
        client,
        party_body(s0, [person(blocked, "Bea", "Silva", 9), person(vip, "Caio", "Silva", 12)]),
    )
    assert refused.status_code == 409
    assert _error(refused)["code"] == "conflict"
    assert _error(refused)["details"] == {"seat_ids": [blocked, vip]}
    foreign = other.seats[0][0]
    missing = ana.confirm(
        client,
        party_body(s0, [person(foreign, "Bea", "Silva", 9), person(1999999, "Caio", "S", 1)]),
    )
    assert missing.status_code == 404
    assert _error(missing)["code"] == "not_found"
    assert _error(missing)["details"] == {"seat_ids": [foreign, 1999999]}
    assert counts(session) == before
    assert ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)])).status_code == 200


def test_member_without_tag_cannot_take_reserved_seat(
    client: TestClient, organiser: Organiser
) -> None:
    extras = {(0, 0): {"reserved_tag": "vip"}, (0, 1): {"reserved_tag": "vip"}}
    guests = [{"name": "Vasco Vip", "reserved_tag": "vip"}]
    from test_events_setup import make_event

    setup = make_event(client, organiser, guests, extras=extras)
    vasco = link_door(setup, "Vasco Vip")
    vip_mine, vip_other, free = setup.seats[0][0], setup.seats[0][1], setup.seats[0][2]
    refused = vasco.confirm(client, party_body(vip_mine, [person(vip_other, "Vera", "Vip", 30)]))
    assert refused.status_code == 409 and _error(refused)["details"] == {"seat_ids": [vip_other]}
    # The booker keeps their own tag: the reserved seat is fine for them.
    allowed = vasco.confirm(client, party_body(vip_mine, [person(free, "Vera", "Vip", 30)]))
    assert allowed.status_code == 200, allowed.text


def test_deadline_refuses_every_party_write(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES, change_deadline="2030-04-01T00:00:00Z")
    ana = link_door(setup, "Ana Silva")
    s0, s1, s2 = setup.seats[0][:3]
    booked = ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)]))
    member_id = booked.json()["members"][0]["id"]
    closed = client.patch(
        f"/api/events/{setup.eid}",
        headers=setup.headers,
        json={"change_deadline": "2020-01-01T00:00:00Z"},
    )
    assert closed.status_code == 200, closed.text
    before = counts(session)
    for response in (
        ana.confirm(client, party_body(s0, [person(s2, "Caio", "Silva", 12)])),
        ana.post(client, "/party/me", {"first_name": "Ana", "last_name": "Silva", "age": 3}),
        ana.patch(client, f"/party/{member_id}", {"first_name": "Beatriz"}),
        ana.put(client, f"/party/{member_id}/seat", {"seat_id": s2}),
        ana.delete(client, f"/party/{member_id}"),
    ):
        assert response.status_code == 409, response.text
        assert _error(response)["code"] == "deadline_passed"
    assert counts(session) == before
    assert ana.get(client, "/party").status_code == 200


def test_booker_who_said_no_cannot_book_a_party(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    assert ana.post(client, "/rsvp", {"rsvp": "no"}).status_code == 200
    before = counts(session)
    refused = ana.confirm(client, party_body(setup.seats[0][0]))
    assert refused.status_code == 409 and _error(refused)["code"] == "conflict"
    assert counts(session) == before


def test_party_respects_places_left_for_invited_booker(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    # One table of four seats and three invited guests: one place left.
    setup = invited_event(client, organiser, NAMES, tables=1, per_table=4)
    ana = link_door(setup, "Ana Silva")
    s0, s1, s2, _s3 = setup.seats[0]
    assert ana.get(client, "/party").json()["places_left"] == 1
    before = counts(session)
    full = ana.confirm(
        client, party_body(s0, [person(s1, "Bea", "Silva", 9), person(s2, "Caio", "Silva", 12)])
    )
    assert full.status_code == 409
    assert _error(full)["code"] == "event_full"
    assert _error(full)["message"] == "Only 1 more person can join this event."
    assert _error(full)["details"] == {"places_left": 1}
    assert counts(session) == before
    fits = ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)]))
    assert fits.status_code == 200 and fits.json()["places_left"] == 0
    none_left = ana.confirm(client, party_body(s0, [person(s2, "Caio", "Silva", 12)]))
    assert _error(none_left)["details"] == {"places_left": 0}
    assert _error(none_left)["message"] == "This event is full. Every place has a guest."
    # Bruno and Carla still have their places kept for them.
    choose(client, setup, "Bruno Costa", s2)


def test_share_cap_counts_members_of_link_joiners(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup, kai, _token = account_door(client, organiser)
    share = f"/api/events/{setup.eid}/share"
    assert client.patch(share, headers=setup.headers, json={"cap": 2}).status_code == 200
    s0, s1, s2 = setup.seats[0][:3]
    assert kai.get(client, "/party").json()["places_left"] == 1
    over = kai.confirm(
        client, party_body(s0, [person(s1, "Bea", "Lobo", 9), person(s2, "Caio", "Lobo", 12)])
    )
    assert over.status_code == 409 and _error(over)["details"] == {"places_left": 1}
    booked = kai.confirm(client, party_body(s0, [person(s1, "Bea", "Lobo", 9)]))
    assert booked.status_code == 200, booked.text
    settings = client.get(share, headers=setup.headers).json()
    assert (settings["guests"], settings["joined"], settings["places_left"]) == (2, 2, 0)


def test_two_bookers_overlapping_seats_have_one_winner(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0, s1, s2, s3 = setup.seats[0]
    s4 = setup.seats[1][0]
    bodies = {
        "Ana Silva": party_body(s0, [person(s1, "Bea", "Silva", 9), person(s2, "Caio", "S", 1)]),
        "Bruno Costa": party_body(s3, [person(s2, "Duda", "Costa", 5), person(s4, "Eva", "C", 2)]),
    }
    start = threading.Barrier(2)
    results: dict[str, Any] = {}

    def book(name: str) -> None:
        start.wait()
        results[name] = link_door(setup, name).confirm(client, bodies[name])

    threads = [threading.Thread(target=book, args=(name,)) for name in bodies]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    statuses = sorted(response.status_code for response in results.values())
    assert statuses == [200, 409]
    loser = next(name for name, response in results.items() if response.status_code == 409)
    assert _error(results[loser])["code"] == "seat_taken"
    assert _error(results[loser])["details"] == {"seat_ids": [s2]}
    assert companions(session, setup.guests[loser]) == []
    assert _guest(session, setup.guests[loser]).age_years is None
    session.expire_all()
    seats = [row.seat_id for row in session.scalars(select(SeatAssignment))]
    assert len(seats) == len(set(seats)) == 3


def test_repeated_submit_creates_no_duplicates(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1, s2 = setup.seats[0][:3]
    body = party_body(s0, [person(s1, "Bea", "Silva", 9), person(s2, "Caio", "Silva", 12)])
    assert ana.confirm(client, body).status_code == 200
    before = counts(session)
    again = ana.confirm(client, body)
    assert again.status_code == 409
    assert _error(again)["details"] == {"seat_ids": [s1, s2]}
    assert counts(session) == before
    assert len(companions(session, setup.guests["Ana Silva"])) == 2


def test_booker_old_seat_can_go_to_a_member_when_booker_moves(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1 = setup.seats[0][:2]
    assert ana.confirm(client, party_body(s0)).status_code == 200
    moved = ana.confirm(client, party_body(s1, [person(s0, "Bea", "Silva", 9)]))
    assert moved.status_code == 200, moved.text
    bea = companions(session, setup.guests["Ana Silva"])[0]
    assert _seat_owner(session, s1) == setup.guests["Ana Silva"]
    assert _seat_owner(session, s0) == bea.id
    session.expire_all()
    entry = session.scalars(select(AuditLog).where(AuditLog.action == "party.confirm")).all()[-1]
    assert entry.detail["old_seat_id"] == s0
    kinds = [m.kind for m in session.scalars(select(EmailOutbox)) if m.kind.startswith("seat")]
    assert kinds == ["seat_confirmed", "seat_changed"]
    # "Change seat" with no new members goes through the same call.
    changed = ana.confirm(client, party_body(setup.seats[0][2]))
    assert changed.status_code == 200 and len(changed.json()["members"]) == 1


def test_edit_member_and_age_stays_write_only(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1 = setup.seats[0][:2]
    member_id = ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)])).json()[
        "members"
    ][0]["id"]
    edited = ana.patch(client, f"/party/{member_id}", {"first_name": " Beatriz ", "age": 10})
    assert edited.status_code == 200, edited.text
    member = edited.json()["members"][0]
    assert (member["first_name"], member["last_name"], member["age_saved"]) == (
        "Beatriz",
        "Silva",
        True,
    )
    assert "age" not in member and "age_years" not in json.dumps(edited.json())
    row = _guest(session, member_id)
    assert (row.name, row.age_years) == ("Beatriz Silva", 10)
    for bad in ({}, {"age": None}, {"first_name": "  "}, {"last_name": None}, {"age": 200}):
        refused = ana.patch(client, f"/party/{member_id}", bad)
        assert refused.status_code == 422, (bad, refused.text)
    session.expire_all()
    entry = session.scalars(select(AuditLog).where(AuditLog.action == "party.edit")).one()
    assert entry.detail == {"member_id": member_id, "fields": ["age", "first_name"]}


def test_move_member_frees_old_seat(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    extras = {(1, 3): {"is_blocked": True}}
    setup = invited_event(client, organiser, NAMES, extras=extras)
    ana = link_door(setup, "Ana Silva")
    s0, s1, s2, s3 = setup.seats[0]
    blocked = setup.seats[1][3]
    member_id = ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)])).json()[
        "members"
    ][0]["id"]
    moved = ana.put(client, f"/party/{member_id}/seat", {"seat_id": s3})
    assert moved.status_code == 200, moved.text
    assert moved.json()["members"][0]["seat_id"] == s3
    assert _seat_owner(session, s1) is None and _seat_owner(session, s3) == member_id
    choose(client, setup, "Bruno Costa", s2)
    taken = ana.put(client, f"/party/{member_id}/seat", {"seat_id": s2})
    assert taken.status_code == 409 and _error(taken)["code"] == "seat_taken"
    assert _error(taken)["details"] == {"seat_ids": [s2]}
    own = ana.put(client, f"/party/{member_id}/seat", {"seat_id": s0})
    assert own.status_code == 409 and _error(own)["code"] == "seat_taken"
    refused = ana.put(client, f"/party/{member_id}/seat", {"seat_id": blocked})
    assert refused.status_code == 409 and _error(refused)["code"] == "conflict"
    session.expire_all()
    entry = session.scalars(select(AuditLog).where(AuditLog.action == "party.move")).one()
    assert entry.detail == {"member_id": member_id, "seat_id": s3, "old_seat_id": s1}
    # The organiser marks the member as not coming: the booker cannot seat them again.
    no = client.patch(
        f"/api/events/{setup.eid}/guests/{member_id}", headers=setup.headers, json={"rsvp": "no"}
    )
    assert no.status_code == 200, no.text
    view = ana.get(client, "/party").json()
    assert view["members"][0]["rsvp"] == "no" and view["members"][0]["seat_id"] is None
    again = ana.put(client, f"/party/{member_id}/seat", {"seat_id": s1})
    assert again.status_code == 409
    assert _error(again)["message"] == "The organiser marked this person as not coming."


def test_remove_member_erases_and_frees_seat(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1 = setup.seats[0][:2]
    member_id = ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)])).json()[
        "members"
    ][0]["id"]
    removed = ana.delete(client, f"/party/{member_id}")
    assert removed.status_code == 200, removed.text
    assert removed.json()["members"] == []
    row = _guest(session, member_id)
    assert row.name == "Deleted guest" and row.token_revoked_at is not None
    assert (row.first_name, row.last_name, row.age_years) == (None, None, None)
    assert _seat_owner(session, s1) is None
    assert seat_state(link_door(setup, "Bruno Costa").page(client), s1) == "free"
    assert ana.delete(client, f"/party/{member_id}").status_code == 404
    guests = client.get(f"/api/events/{setup.eid}/guests", headers=setup.headers).json()
    assert member_id not in {g["id"] for g in guests}


def test_booker_cannot_answer_no_or_release_while_party_seated(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1, s2 = setup.seats[0][:3]
    view = ana.confirm(
        client, party_body(s0, [person(s1, "Bea", "Silva", 9), person(s2, "Caio", "Silva", 12)])
    ).json()
    for response in (ana.post(client, "/rsvp", {"rsvp": "no"}), ana.delete(client, "/seat")):
        assert response.status_code == 409
        assert _error(response)["code"] == "party_exists"
        assert _error(response)["message"] == (
            "You booked seats for 2 other people. "
            "Remove them in Your party first, or ask the organiser."
        )
    assert _seat_owner(session, s0) == setup.guests["Ana Silva"]
    for member in view["members"]:
        assert ana.delete(client, f"/party/{member['id']}").status_code == 200
    assert ana.post(client, "/rsvp", {"rsvp": "no"}).status_code == 200
    assert _seat_owner(session, s0) is None


def test_party_gets_keep_adjacent_group_or_inherits_organiser_group(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    from test_events_setup import make_event

    guests = [{"name": "Ana Silva"}, {"name": "Carla Dias", "group": "Dias family"}]
    setup = make_event(client, organiser, guests)
    ana, carla = link_door(setup, "Ana Silva"), link_door(setup, "Carla Dias")
    a0, a1, c0, c1 = setup.seats[0][0], setup.seats[0][1], setup.seats[1][0], setup.seats[1][1]
    assert ana.confirm(client, party_body(a0, [person(a1, "Bea", "Silva", 9)])).status_code == 200
    assert carla.confirm(client, party_body(c0, [person(c1, "Dora", "Dias", 7)])).status_code == 200
    ana_row = _guest(session, setup.guests["Ana Silva"])
    group = session.get(GuestGroup, ana_row.group_id)
    assert group is not None
    assert (group.name, group.keep_adjacent) == (f"Party of guest #{ana_row.id}", True)
    assert companions(session, ana_row.id)[0].group_id == group.id
    carla_row = _guest(session, setup.guests["Carla Dias"])
    dias = session.get(GuestGroup, carla_row.group_id)
    assert dias is not None and dias.name == "Dias family"
    assert companions(session, carla_row.id)[0].group_id == dias.id
    # A second booking reuses the party's group.
    more = ana.confirm(client, party_body(a0, [person(setup.seats[0][2], "Caio", "Silva", 12)]))
    assert more.status_code == 200
    assert {m.group_id for m in companions(session, ana_row.id)} == {group.id}
    groups = client.get(f"/api/events/{setup.eid}/guests", headers=setup.headers).json()
    assert {g["group"] for g in groups if g["source"] == "companion"} == {
        f"Party of guest #{ana_row.id}",
        "Dias family",
    }


def _journey(client: TestClient, door: Door, seats: list[int]) -> list[Any]:
    """The same steps through one door, with ids replaced so two doors compare."""
    s0, s1, s2, s3 = seats
    steps: list[Any] = []

    member_ids: list[int] = []

    def plain(response: Any) -> Any:
        body = response.json()
        if "members" in body:
            body["me"].pop("guest_id")
            if body["me"]["seat_id"] is not None:
                body["me"]["seat_id"] = seats.index(body["me"]["seat_id"])
            for member in body["members"]:
                if member["id"] not in member_ids:
                    member_ids.append(member["id"])
                member["id"] = member_ids.index(member["id"])
                if member["seat_id"] is not None:
                    member["seat_id"] = seats.index(member["seat_id"])
        return response.status_code, body

    steps.append(plain(door.get(client, "/party")))
    booked = door.confirm(
        client, party_body(s0, [person(s1, "Bea", "Lobo", 9), person(s2, "Caio", "Lobo", 12)])
    )
    steps.append(plain(booked))
    first, second = (member["id"] for member in booked.json()["members"])
    steps.append(plain(door.post(client, "/party/me", {"first_name": "Kai", "last_name": "L"})))
    steps.append(plain(door.patch(client, f"/party/{first}", {"last_name": "Lobos"})))
    steps.append(plain(door.put(client, f"/party/{second}/seat", {"seat_id": s3})))
    steps.append(plain(door.delete(client, f"/party/{first}")))
    steps.append(plain(door.delete(client, f"/party/{first}")))
    steps.append(plain(door.post(client, "/hold", {"seat_id": s1})))
    steps.append(plain(door.post(client, "/rsvp", {"rsvp": "no"})))
    return steps


def test_both_doors_answer_the_same(client: TestClient, organiser: Organiser) -> None:
    linked = invited_event(client, organiser, ["Kai Lobo"])
    by_link = _journey(client, link_door(linked, "Kai Lobo"), linked.seats[0])
    setup, door, _token = account_door(client, organiser)
    by_account = _journey(client, door, setup.seats[0])
    assert by_link == by_account
    assert [status for status, _ in by_link] == [200, 200, 200, 200, 200, 200, 404, 410, 409]


def test_legacy_confirm_still_moves_booker(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1, s2 = setup.seats[0][:3]
    assert ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)])).status_code == 200
    legacy = ana.post(client, "/confirm", {"seat_id": s2})
    assert legacy.status_code == 200 and legacy.json() == {"seat_id": s2, "source": "self"}
    assert _seat_owner(session, s2) == setup.guests["Ana Silva"]
    assert _seat_owner(session, s1) == companions(session, setup.guests["Ana Silva"])[0].id
    # A guest with no details cannot book a seat the old way: every chosen seat
    # carries a first name, a last name and an age (D3 reversed by the owner).
    bruno = link_door(setup, "Bruno Costa")
    refused = bruno.post(client, "/confirm", {"seat_id": s0})
    assert refused.status_code == 422 and _error(refused)["code"] == "details_required"
    assert _seat_owner(session, s0) is None
    saved = bruno.post(
        client, "/party/me", {"first_name": "Bruno", "last_name": "Costa", "age": 52}
    )
    assert saved.status_code == 200, saved.text
    assert bruno.post(client, "/confirm", {"seat_id": s0}).status_code == 200


def test_organiser_tools_work_with_a_party_present(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1, s2 = setup.seats[0][:3]
    booked = ana.confirm(
        client, party_body(s0, [person(s1, "Bea", "Silva", 9), person(s2, "Caio", "Silva", 12)])
    )
    bea, caio = (member["id"] for member in booked.json()["members"])
    base, headers = f"/api/events/{setup.eid}", setup.headers
    elsewhere = setup.seats[1][0]
    moved = client.put(f"{base}/assignments/{bea}", headers=headers, json={"seat_id": elsewhere})
    assert moved.status_code == 200, moved.text
    assert client.delete(f"{base}/assignments/{caio}", headers=headers).status_code == 200
    view = ana.get(client, "/party").json()
    assert [(m["id"], m["seat_id"]) for m in view["members"]] == [(bea, elsewhere), (caio, None)]

    scenario = client.post(f"{base}/optimise/autofill", headers=headers, json={})
    assert scenario.status_code == 200, scenario.text
    applied = client.post(f"{base}/scenarios/{scenario.json()['id']}/apply", headers=headers)
    assert applied.status_code == 200, applied.text
    # Seats a person chose (the booker, the organiser's move) are never moved by a plan.
    assert _seat_owner(session, s0) == setup.guests["Ana Silva"]
    assert _seat_owner(session, elsewhere) == bea
    assert client.post(f"{base}/undo", headers=headers).status_code == 200
    assert _seat_owner(session, s0) == setup.guests["Ana Silva"]
    chart = client.get(f"{base}/chart", headers=headers)
    assert chart.status_code == 200 and "Bea Silva" in chart.text

    banquet = {"preset": "banquet", "confirm": True}
    preset = client.post(f"{base}/layout", headers=headers, json=banquet)
    assert preset.status_code == 200, preset.text
    page = ana.page(client)
    assert [m["id"] for m in page["party"]["members"]] == [bea, caio]
    seated = {seat["party_member_id"] for seat in page["map"]["seats"] if "party_member_id" in seat}
    member_seats = {m["id"] for m in page["party"]["members"] if m["seat_id"] is not None}
    assert seated == member_seats
    assert _guest(session, bea).age_years == 9


def test_a_double_booking_that_slips_past_the_check_is_refused_by_the_database(
    client: TestClient,
    organiser: Organiser,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the occupancy check ever misses a seat, the UNIQUE constraint still decides."""
    from app.events_service import party

    setup = invited_event(client, organiser, NAMES)
    s0, s1, s2 = setup.seats[0][:3]
    choose(client, setup, "Bruno Costa", s2)
    monkeypatch.setattr(party, "current_rows", lambda _session, _event: {})
    ana = link_door(setup, "Ana Silva")
    before = counts(session)
    body = party_body(s0, [person(s1, "Bea", "Silva", 9), person(s2, "Caio", "Silva", 12)])
    response = ana.confirm(client, body)
    assert response.status_code == 409, response.text
    assert _error(response)["code"] == "seat_taken"
    assert _error(response)["details"] == {"seat_ids": []}
    assert counts(session) == before
    assert _seat_owner(session, s2) == setup.guests["Bruno Costa"]
    assert companions(session, setup.guests["Ana Silva"]) == []
    assert _guest(session, setup.guests["Ana Silva"]).age_years is None


def test_party_confirm_locks_the_event_first(client: TestClient, organiser: Organiser) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    s0, s1 = setup.seats[0][:2]
    with recorded_writes() as writes:
        response = ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)]))
    assert response.status_code == 200, response.text
    assert "live_versions" in writes[0]
    member_id = response.json()["members"][0]["id"]
    for call in (
        lambda: ana.post(client, "/party/me", {"first_name": "A", "last_name": "S", "age": 1}),
        lambda: ana.patch(client, f"/party/{member_id}", {"age": 3}),
        lambda: ana.put(client, f"/party/{member_id}/seat", {"seat_id": setup.seats[0][3]}),
        lambda: ana.delete(client, f"/party/{member_id}"),
    ):
        with recorded_writes() as writes:
            assert call().status_code == 200
        assert "live_versions" in writes[0]
