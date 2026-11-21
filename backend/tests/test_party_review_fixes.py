"""Party booking: the defects the security and correctness reviews found.

Each test failed before its fix:
- a request that waited on the event lock wrote on a guest the organiser
  erased (or re-linked) meanwhile;
- the old one-seat /confirm booked a seat without first name, last name and age;
- party members did not follow the booker's "appear anonymously";
- names made only of invisible or control characters passed "name required";
- venue team members saw ages, which are for the event's organiser only;
- the organiser could empty the details of a guest who chose their own seat.

The race tests play two requests by hand: session `waiting` is the request
whose route already loaded the guest, and the test client is the other one,
which commits while `waiting` waits for the lock.

Unusual characters are written with chr(), so this file holds none itself.
"""

from typing import Any

import pytest
from conftest import auth_header, make_user
from fastapi.testclient import TestClient
from guest_helpers import open_link
from party_helpers import (
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

from app.core.errors import ApiError
from app.events_service import party, seating
from app.events_service.schemas import MyDetailsIn, PartyConfirmIn, PersonPatch
from app.models import Event, Guest, Organiser, SeatAssignment, Venue

NAMES = ["Ana Silva", "Bruno Costa"]


def _waiting_request(session: Session, guest_id: int) -> tuple[Session, Guest, Event]:
    """A second session that loaded the guest and the event, as a route does before the lock."""
    other = Session(session.get_bind(), expire_on_commit=False)
    me = other.get(Guest, guest_id)
    assert me is not None
    event = other.get(Event, me.event_id)
    assert event is not None
    return other, me, event


def _seat_rows(session: Session, guest_id: int) -> list[SeatAssignment]:
    session.expire_all()
    query = select(SeatAssignment).where(SeatAssignment.guest_id == guest_id)
    return list(session.scalars(query))


def _error(response: Any) -> dict[str, Any]:
    return response.json()["error"]


def _erase(client: TestClient, setup: Any, guest_id: int, choice: str = "") -> None:
    query = f"?party={choice}" if choice else ""
    url = f"/api/events/{setup.eid}/guests/{guest_id}{query}"
    erased = client.delete(url, headers=setup.headers)
    assert erased.status_code == 200, erased.text


# ---------------------------------------------------------------- H1: the stale row after the lock


def test_booker_erased_while_party_confirm_waits_writes_nothing(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0, s1 = setup.seats[0][:2]
    ana_id = setup.guests["Ana Silva"]
    waiting, me, event = _waiting_request(session, ana_id)
    _erase(client, setup, ana_id)

    body = PartyConfirmIn.model_validate(party_body(s0, [person(s1, "Bea", "Silva", 9)]))
    with pytest.raises(ApiError) as refused:
        party.confirm_party(waiting, event, me, body, None)
    assert refused.value.status == 404
    waiting.rollback()
    waiting.close()

    ana = session.get(Guest, ana_id)
    assert ana is not None
    session.refresh(ana)
    assert ana.token_revoked_at is not None
    assert (ana.first_name, ana.last_name, ana.age_years) == (None, None, None)
    assert _seat_rows(session, ana_id) == []
    assert companions(session, ana_id) == []


def test_booker_erased_while_saving_details_writes_nothing(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana_id = setup.guests["Ana Silva"]
    waiting, me, event = _waiting_request(session, ana_id)
    _erase(client, setup, ana_id)

    body = MyDetailsIn(first_name="Ana", last_name="Silva", age=40)
    with pytest.raises(ApiError) as refused:
        party.set_my_details(waiting, event, me, body)
    assert refused.value.status == 404
    waiting.rollback()
    waiting.close()
    ana = session.get(Guest, ana_id)
    assert ana is not None
    session.refresh(ana)
    assert (ana.first_name, ana.last_name, ana.age_years) == (None, None, None)


def test_new_link_while_party_confirm_waits_refuses_the_old_link(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0 = setup.seats[0][0]
    ana_id = setup.guests["Ana Silva"]
    waiting, me, event = _waiting_request(session, ana_id)
    url = f"/api/events/{setup.eid}/guests/{ana_id}/new-link"
    relinked = client.post(url, headers=setup.headers)
    assert relinked.status_code == 200, relinked.text

    body = PartyConfirmIn.model_validate(party_body(s0))
    with pytest.raises(ApiError) as refused:
        party.confirm_party(waiting, event, me, body, None)
    assert refused.value.status == 404
    waiting.rollback()
    waiting.close()
    assert _seat_rows(session, ana_id) == []


def test_member_removed_in_one_tab_cannot_be_moved_or_edited_in_another(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0, s1, s2 = setup.seats[0][:3]
    ana = link_door(setup, "Ana Silva")
    booked = ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)]))
    assert booked.status_code == 200, booked.text
    bea_id = booked.json()["members"][0]["id"]
    ana_id = setup.guests["Ana Silva"]

    moving, me, event = _waiting_request(session, ana_id)
    editing, me2, event2 = _waiting_request(session, ana_id)
    # Both tabs found Bea before the lock (load_member).
    assert party.load_member(moving, me, bea_id).id == bea_id
    assert party.load_member(editing, me2, bea_id).id == bea_id
    assert ana.delete(client, f"/party/{bea_id}").status_code == 200

    with pytest.raises(ApiError) as refused_move:
        party.move_member(moving, event, me, bea_id, s2)
    assert refused_move.value.status == 404
    moving.rollback()
    moving.close()
    with pytest.raises(ApiError) as refused_edit:
        party.edit_member(editing, event2, me2, bea_id, PersonPatch(first_name="Beatriz"))
    assert refused_edit.value.status == 404
    editing.rollback()
    editing.close()

    assert _seat_rows(session, bea_id) == []
    [bea] = companions(session, ana_id)
    assert bea.token_revoked_at is not None and bea.first_name is None


def test_booker_erased_while_removing_a_member_keeps_the_organisers_choice(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0, s1 = setup.seats[0][:2]
    ana = link_door(setup, "Ana Silva")
    booked = ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)]))
    bea_id = booked.json()["members"][0]["id"]
    ana_id = setup.guests["Ana Silva"]
    waiting, me, event = _waiting_request(session, ana_id)
    _erase(client, setup, ana_id, "keep")

    with pytest.raises(ApiError) as refused:
        party.remove_member(waiting, event, me, bea_id)
    assert refused.value.status == 404
    waiting.rollback()
    waiting.close()
    # The organiser kept Bea: she is still seated and named.
    [bea] = companions(session, ana_id)
    assert bea.token_revoked_at is None and bea.first_name == "Bea"
    assert [row.seat_id for row in _seat_rows(session, bea_id)] == [s1]


def test_booker_erased_while_privacy_waits_leaves_the_kept_party_alone(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    from app.events_service import attendee_view

    setup = invited_event(client, organiser, NAMES)
    s0, s1 = setup.seats[0][:2]
    ana = link_door(setup, "Ana Silva")
    assert ana.post(client, "/privacy", {"wants_anonymous": True}).status_code == 200
    assert ana.confirm(client, party_body(s0, [person(s1, "Bea", "Silva", 9)])).status_code == 200
    ana_id = setup.guests["Ana Silva"]
    waiting, me, _event = _waiting_request(session, ana_id)
    _erase(client, setup, ana_id, "keep")

    with pytest.raises(ApiError) as refused:
        attendee_view.set_privacy(waiting, me, False)
    assert refused.value.status == 404
    waiting.rollback()
    waiting.close()
    [bea] = companions(session, ana_id)
    assert bea.token_revoked_at is None and bea.wants_anonymous is True


def test_one_seat_confirm_after_erase_writes_nothing(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana_id = setup.guests["Ana Silva"]
    waiting, me, event = _waiting_request(session, ana_id)
    _erase(client, setup, ana_id)
    with pytest.raises(ApiError) as refused:
        seating.confirm_seat(waiting, event, me, setup.seats[0][0])
    assert refused.value.status == 404
    waiting.rollback()
    waiting.close()
    assert _seat_rows(session, ana_id) == []


# ---------------------------------------------------------------- M1: the old one-seat confirm


def test_one_seat_confirm_needs_first_last_and_age_by_link(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana = link_door(setup, "Ana Silva")
    seat = setup.seats[0][0]
    before = counts(session)
    refused = ana.post(client, "/confirm", {"seat_id": seat})
    assert refused.status_code == 422, refused.text
    assert _error(refused)["code"] == "details_required"
    assert counts(session) == before
    assert ana.page(client)["me"]["seat_id"] is None

    saved = ana.post(client, "/party/me", {"first_name": "Ana", "last_name": "Silva", "age": 40})
    assert saved.status_code == 200, saved.text
    confirmed = ana.post(client, "/confirm", {"seat_id": seat})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json() == {"seat_id": seat, "source": "self"}


def test_one_seat_confirm_needs_first_last_and_age_by_account(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup, door, _token = account_door(client, organiser)
    seat = setup.seats[0][0]
    before = counts(session)
    refused = door.post(client, "/confirm", {"seat_id": seat})
    assert refused.status_code == 422, refused.text
    assert _error(refused)["code"] == "details_required"
    assert counts(session) == before
    details = {"first_name": "Kai", "last_name": "Lobo", "age": 30}
    assert door.post(client, "/party/me", details).status_code == 200
    assert door.post(client, "/confirm", {"seat_id": seat}).status_code == 200


def test_a_taken_seat_is_still_seat_taken_without_details(
    client: TestClient, organiser: Organiser
) -> None:
    setup = invited_event(client, organiser, NAMES)
    seat = setup.seats[0][0]
    assert link_door(setup, "Ana Silva").confirm(client, party_body(seat)).status_code == 200
    clash = link_door(setup, "Bruno Costa").post(client, "/confirm", {"seat_id": seat})
    assert clash.status_code == 409 and _error(clash)["code"] == "seat_taken"


# ---------------------------------------------------------------- M2: members follow the booker


def _occupants(page: dict[str, Any]) -> dict[int, Any]:
    return {seat["id"]: seat.get("occupant") for seat in page["map"]["seats"]}


def test_members_of_an_anonymous_booker_are_anonymous_too(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Menor", "Bruno Costa"], privacy_mode="full_name")
    s0, s1 = setup.seats[0][:2]
    ana = link_door(setup, "Ana Menor")
    assert ana.post(client, "/privacy", {"wants_anonymous": True}).status_code == 200
    body = party_body(s0, [person(s1, "Bea", "Menor", 7)], first="Ana", last="Menor")
    booked = ana.confirm(client, body)
    assert booked.status_code == 200, booked.text
    [bea] = companions(session, setup.guests["Ana Menor"])
    assert bea.wants_anonymous is True

    visitor = client.get(f"/api/j/{open_link(client, setup)}").json()
    bruno = setup.page(client, "Bruno Costa")
    people = link_door(setup, "Bruno Costa").get(client, "/people").json()
    for occupants in (_occupants(visitor), _occupants(bruno)):
        assert "Menor" not in str(occupants[s0]) and "Menor" not in str(occupants[s1])
    assert all("Menor" not in item["name"] for item in people)
    # The booker still sees her own people by name.
    assert _occupants(ana.page(client))[s1] == "Bea Menor"


def test_the_bookers_privacy_choice_reaches_the_party_later(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, ["Ana Menor", "Bruno Costa"], privacy_mode="full_name")
    s0, s1 = setup.seats[0][:2]
    ana = link_door(setup, "Ana Menor")
    body = party_body(s0, [person(s1, "Bea", "Menor", 7)], first="Ana", last="Menor")
    assert ana.confirm(client, body).status_code == 200
    assert _occupants(setup.page(client, "Bruno Costa"))[s1] == "Bea Menor"

    assert ana.post(client, "/privacy", {"wants_anonymous": True}).status_code == 200
    [bea] = companions(session, setup.guests["Ana Menor"])
    assert bea.wants_anonymous is True
    assert "Menor" not in str(_occupants(setup.page(client, "Bruno Costa"))[s1])

    assert ana.post(client, "/privacy", {"wants_anonymous": False}).status_code == 200
    [bea] = companions(session, setup.guests["Ana Menor"])
    assert bea.wants_anonymous is False


# ---------------------------------------------------------------- L1: names that are not names

INVISIBLE = [
    chr(0x200B),  # zero width space
    chr(0x2060),  # word joiner
    chr(0xFEFF),  # byte order mark
    chr(0x200E),  # left-to-right mark
    chr(0x202E),  # right-to-left override
    chr(0x3164),  # Hangul filler
    chr(0x115F),  # Hangul choseong filler
    chr(0xFFA0),  # halfwidth Hangul filler
    chr(0x2800),  # Braille blank
    "Be" + chr(0x202E) + "a",  # an override inside a real name
    "Bea\nBcc",
    "Bea\tSilva",
    "Bea\r",
    "Bea" + chr(0x2028),  # line separator
    "--",  # no letter at all
]


@pytest.mark.parametrize("bad", INVISIBLE)
def test_names_without_visible_letters_are_refused(
    client: TestClient, organiser: Organiser, session: Session, bad: str
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0, s1 = setup.seats[0][:2]
    ana = link_door(setup, "Ana Silva")
    before = counts(session)
    as_member = ana.confirm(client, party_body(s0, [person(s1, bad, "Silva", 9)]))
    assert as_member.status_code == 422, as_member.text
    as_booker = ana.confirm(client, party_body(s0, last=bad))
    assert as_booker.status_code == 422, as_booker.text
    as_me = ana.post(client, "/party/me", {"first_name": bad, "last_name": "Silva", "age": 40})
    assert as_me.status_code == 422, as_me.text
    assert counts(session) == before


ZOE_TYPED = "Zoe" + chr(0x0308)  # "e" and a separate diaeresis
ZOE = "Zo" + chr(0x00EB)  # the composed letter
LI, HUA = chr(0x674E), chr(0x534E)
# A Persian first name with a zero width non-joiner inside, and a last name.
MAHSA = "".join(chr(c) for c in (0x0645, 0x0647, 0x200C, 0x0633, 0x0627))
REZAEI = "".join(chr(c) for c in (0x0631, 0x0636, 0x0627, 0x06CC, 0x06CC))


def test_real_names_in_any_script_are_kept(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0, s1, s2, s3 = setup.seats[0][:4]
    members = [
        person(s1, ZOE_TYPED, "O'Brien-Lee", 9),
        person(s2, LI, HUA, 30),
        person(s3, MAHSA, REZAEI, 41),
    ]
    body = party_body(s0, members, first="Jos" + chr(0x00E9))
    booked = link_door(setup, "Ana Silva").confirm(client, body)
    assert booked.status_code == 200, booked.text
    zoe, li, mahsa = companions(session, setup.guests["Ana Silva"])
    assert zoe.first_name == ZOE and zoe.name == f"{ZOE} O'Brien-Lee"
    assert li.name == f"{LI} {HUA}"
    assert mahsa.first_name == MAHSA


def test_organiser_cannot_save_an_invisible_name(client: TestClient, organiser: Organiser) -> None:
    setup = invited_event(client, organiser, NAMES)
    gid = setup.guests["Bruno Costa"]
    url = f"/api/events/{setup.eid}/guests/{gid}"
    for bad in (chr(0x200B), chr(0x3164), "Bruno\n"):
        refused = client.patch(url, headers=setup.headers, json={"first_name": bad})
        assert refused.status_code == 422, (bad, refused.text)


def test_details_with_an_invisible_saved_name_are_not_complete(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    """A name saved before this rule does not count as a name."""
    setup = invited_event(client, organiser, NAMES)
    ana_id = setup.guests["Ana Silva"]
    ana = session.get(Guest, ana_id)
    assert ana is not None
    ana.first_name, ana.last_name, ana.age_years = chr(0x3164), "Silva", 40
    session.commit()
    door = link_door(setup, "Ana Silva")
    assert door.page(client)["me"]["details_complete"] is False
    refused = door.post(client, "/confirm", {"seat_id": setup.seats[0][0]})
    assert refused.status_code == 422 and _error(refused)["code"] == "details_required"


# ---------------------------------------------------------------- L2: ages for the organiser only


def test_venue_team_members_do_not_see_ages(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    s0, s1 = setup.seats[0][:2]
    body = party_body(s0, [person(s1, "Bea", "Silva", 9)])
    assert link_door(setup, "Ana Silva").confirm(client, body).status_code == 200
    event = session.scalars(select(Event).where(Event.public_id == setup.eid)).one()
    venue = session.get(Venue, event.venue_id)
    assert venue is not None
    added = client.post(
        f"/api/owner/venues/{venue.public_id}/members",
        headers=setup.headers,
        json={"email": "mia.member@example.com"},
    )
    assert added.status_code == 201, added.text
    mia = auth_header(make_user(session, "mia.member@example.com"))

    as_team = client.get(f"/api/events/{setup.eid}/guests", headers=mia)
    assert as_team.status_code == 200, as_team.text
    assert {item["age"] for item in as_team.json()} == {None}
    bruno = setup.guests["Bruno Costa"]
    patched = client.patch(
        f"/api/events/{setup.eid}/guests/{bruno}", headers=mia, json={"needs_accessible": True}
    )
    assert patched.status_code == 200 and patched.json()["age"] is None

    as_owner = client.get(f"/api/events/{setup.eid}/guests", headers=setup.headers).json()
    assert sorted(item["age"] for item in as_owner if item["age"] is not None) == [9, 40]


# ---------------------------------------------------------------- corr 5: a booking stays whole


def test_organiser_cannot_empty_the_details_of_a_guest_who_chose_a_seat(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = invited_event(client, organiser, NAMES)
    ana_id = setup.guests["Ana Silva"]
    booked = link_door(setup, "Ana Silva").confirm(client, party_body(setup.seats[0][0]))
    assert booked.status_code == 200
    url = f"/api/events/{setup.eid}/guests/{ana_id}"
    no_age = client.patch(url, headers=setup.headers, json={"age": None})
    assert no_age.status_code == 422, no_age.text
    renamed = client.patch(url, headers=setup.headers, json={"name": "Ana Maria"})
    assert renamed.status_code == 422, renamed.text
    ana = session.get(Guest, ana_id)
    assert ana is not None
    session.refresh(ana)
    assert (ana.first_name, ana.last_name, ana.age_years) == ("Ana", "Silva", 40)
    # Correcting the details stays possible.
    fixed = client.patch(url, headers=setup.headers, json={"first_name": "Anabela", "age": 41})
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["name"] == "Anabela Silva" and fixed.json()["age"] == 41
    # A guest without a seat of their own is renamed as before.
    bruno = f"/api/events/{setup.eid}/guests/{setup.guests['Bruno Costa']}"
    assert client.patch(bruno, headers=setup.headers, json={"name": "Bruno C."}).status_code == 200
