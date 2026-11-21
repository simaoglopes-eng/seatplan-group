"""Ages typed for a party are seen by the organiser only.

The ages 113 and 117 are chosen because no id, coordinate or date in these
small test events can contain them, so finding either number anywhere in
what another guest, a visitor or the booker receives would be a leak.
Names of party members follow the event's privacy mode like everyone else's.
"""

import json
import re
from typing import Any

import pytest
from fastapi.testclient import TestClient
from guest_helpers import open_link, outbox
from party_helpers import account_door, invited_event, link_door, party_body, person, seat_of
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, Organiser

MODES = ["full_name", "first_initial", "anonymous"]
# A number on its own: not part of a token, a public id or another number.
AGE_NUMBER = re.compile(r"(?<![A-Za-z0-9_\-.])11[37](?![A-Za-z0-9_\-.])")
SHOWN = {
    "full_name": {"Bea Silva", "Caio Silva"},
    "first_initial": {"Bea S.", "Caio S."},
    "anonymous": {"Guest"},
}


def _leaks_age(payload: Any) -> list[str]:
    text = json.dumps(payload)
    found = AGE_NUMBER.findall(text)
    for key in ('"age"', '"age_years"'):
        if key in text:
            found.append(key)
    return found


def _party_event(client: TestClient, organiser: Organiser, mode: str) -> Any:
    setup = invited_event(client, organiser, ["Ana Silva", "Bruno Costa"], privacy_mode=mode)
    s0, s1, s2 = setup.seats[0][:3]
    members = [person(s1, "Bea", "Silva", 113), person(s2, "Caio", "Silva", 117)]
    booked = link_door(setup, "Ana Silva").confirm(client, party_body(s0, members, age=113))
    assert booked.status_code == 200, booked.text
    # Bruno is an ordinary guest with no details saved, so the organiser seats
    # him (a guest choosing a seat now saves a name and an age first).
    placed = client.put(
        f"/api/events/{setup.eid}/assignments/{setup.guests['Bruno Costa']}",
        headers=setup.headers,
        json={"seat_id": setup.seats[1][0]},
    )
    assert placed.status_code == 200, placed.text
    return setup


@pytest.mark.parametrize("mode", MODES)
def test_age_never_in_attendee_visitor_people_or_recommendations(
    client: TestClient, organiser: Organiser, mode: str
) -> None:
    setup = _party_event(client, organiser, mode)
    bruno = link_door(setup, "Bruno Costa")
    share_token = open_link(client, setup)
    payloads = [
        bruno.get(client).json(),
        bruno.get(client, "/people").json(),
        bruno.get(client, "/people?q=s").json(),
        bruno.get(client, "/recommendations").json(),
        bruno.get(client, "/party").json(),
        client.get(f"/api/j/{share_token}").json(),
    ]
    for payload in payloads:
        assert _leaks_age(payload) == [], payload


@pytest.mark.parametrize("mode", MODES)
def test_member_names_follow_privacy_mode_for_others(
    client: TestClient, organiser: Organiser, mode: str
) -> None:
    setup = _party_event(client, organiser, mode)
    s1, s2 = setup.seats[0][1:3]
    page = link_door(setup, "Bruno Costa").page(client)
    assert {seat_of(page, s1)["occupant"], seat_of(page, s2)["occupant"]} == SHOWN[mode]
    assert seat_of(page, s1)["state"] == "taken" and "party_member_id" not in seat_of(page, s1)
    people = {p["name"] for p in page["people"] if p["seat_id"] in (s1, s2)}
    assert people == SHOWN[mode]
    visitor = client.get(f"/api/j/{open_link(client, setup)}").json()
    occupants = {seat["occupant"] for seat in visitor["map"]["seats"] if seat["id"] in (s1, s2)}
    assert occupants == SHOWN[mode]
    if mode != "full_name":
        assert "Silva" not in json.dumps(page["map"]) and "Caio Silva" not in json.dumps(visitor)


@pytest.mark.parametrize("mode", MODES)
def test_booker_sees_member_names_but_no_age_numbers(
    client: TestClient, organiser: Organiser, mode: str
) -> None:
    setup = _party_event(client, organiser, mode)
    ana = link_door(setup, "Ana Silva")
    page = ana.page(client)
    s1, s2 = setup.seats[0][1:3]
    assert {seat_of(page, s1)["occupant"], seat_of(page, s2)["occupant"]} == {
        "Bea Silva",
        "Caio Silva",
    }
    names = [(m["first_name"], m["last_name"]) for m in page["party"]["members"]]
    assert names == [("Bea", "Silva"), ("Caio", "Silva")]
    assert page["me"]["age_saved"] is True and page["party"]["me"]["age_saved"] is True
    for payload in (page, ana.get(client, "/party").json(), ana.get(client, "/people").json()):
        assert _leaks_age(payload) == []


def test_account_holder_never_gets_an_age_back(client: TestClient, organiser: Organiser) -> None:
    setup, kai, token = account_door(client, organiser)
    s0, s1 = setup.seats[0][:2]
    booked = kai.confirm(client, party_body(s0, [person(s1, "Bea", "Lobo", 113)], age=117))
    assert booked.status_code == 200, booked.text
    headers = {"Authorization": f"Bearer {token}"}
    for payload in (
        booked.json(),
        kai.page(client),
        client.get("/api/guest/me", headers=headers).json(),
    ):
        assert _leaks_age(payload) == [], payload


def test_age_not_in_audit_outbox_or_csv_export(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = _party_event(client, organiser, "full_name")
    ana = link_door(setup, "Ana Silva")
    member_id = ana.get(client, "/party").json()["members"][0]["id"]
    me = {"first_name": "Ana", "last_name": "S", "age": 117}
    for response in (
        ana.patch(client, f"/party/{member_id}", {"age": 117}),
        ana.post(client, "/party/me", me),
        ana.put(client, f"/party/{member_id}/seat", {"seat_id": setup.seats[0][3]}),
    ):
        assert response.status_code == 200, response.text
    session.expire_all()
    for entry in session.scalars(select(AuditLog)):
        # Field names ("age") may be listed; the values never are.
        detail = json.dumps(entry.detail)
        assert not AGE_NUMBER.search(detail), (entry.action, entry.detail)
        assert "Bea" not in detail and "Caio" not in detail
    for mail in outbox(session):
        text = f"{mail.subject} {mail.body_text} {mail.body_html} {mail.ics or ''}"
        assert not AGE_NUMBER.search(text), mail.kind
    csv = client.get(f"/api/events/{setup.eid}/export.csv", headers=setup.headers)
    assert csv.status_code == 200
    assert not AGE_NUMBER.search(csv.text) and "age" not in csv.text.splitlines()[0].lower()
    assert "Bea Silva" in csv.text


def test_organiser_guest_list_shows_age_and_booker(
    client: TestClient, organiser: Organiser
) -> None:
    setup = _party_event(client, organiser, "anonymous")
    guests = client.get(f"/api/events/{setup.eid}/guests", headers=setup.headers).json()
    by_name = {guest["name"]: guest for guest in guests}
    ana_id = setup.guests["Ana Silva"]
    assert by_name["Bea Silva"]["age"] == 113 and by_name["Caio Silva"]["age"] == 117
    for name in ("Bea Silva", "Caio Silva"):
        guest = by_name[name]
        assert guest["source"] == "companion" and guest["booked_by_guest_id"] == ana_id
        assert guest["has_account"] is False and guest["email"] is None
        assert guest["last_name"] == "Silva"
    assert by_name["Ana Silva"]["age"] == 113 and by_name["Ana Silva"]["booked_by_guest_id"] is None
    assert by_name["Bruno Costa"]["age"] is None and by_name["Bruno Costa"]["first_name"] is None
    page = client.get(f"/api/events/{setup.eid}", headers=setup.headers).json()
    occupants = {seat["occupant"] for seat in page["map"]["seats"] if seat["occupant"]}
    assert {"Bea Silva", "Caio Silva", "Ana Silva", "Bruno Costa"} == occupants


def test_organiser_edits_member_details(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = _party_event(client, organiser, "full_name")
    member_id = link_door(setup, "Ana Silva").get(client, "/party").json()["members"][0]["id"]
    url = f"/api/events/{setup.eid}/guests/{member_id}"
    edited = client.patch(
        url, headers=setup.headers, json={"first_name": "Beatriz", "age": 12, "dietary_note": "Veg"}
    )
    assert edited.status_code == 200, edited.text
    assert (edited.json()["name"], edited.json()["age"]) == ("Beatriz Silva", 12)
    assert edited.json()["dietary_note"] == "Veg"
    for bad in ({"name": "Someone Else"}, {"age": None}, {"first_name": " "}, {"age": 121}):
        refused = client.patch(url, headers=setup.headers, json=bad)
        assert refused.status_code == 422, (bad, refused.text)
    # An ordinary guest: the organiser may type or clear an age.
    bruno = setup.guests["Bruno Costa"]
    burl = f"/api/events/{setup.eid}/guests/{bruno}"
    typed = client.patch(burl, headers=setup.headers, json={"first_name": "Bruno", "age": 50})
    assert typed.json()["age"] == 50 and typed.json()["name"] == "Bruno Costa"
    cleared = client.patch(burl, headers=setup.headers, json={"age": None})
    assert cleared.status_code == 200 and cleared.json()["age"] is None
    renamed = client.patch(burl, headers=setup.headers, json={"name": "Bruno C. Costa"})
    assert renamed.json()["first_name"] is None and renamed.json()["name"] == "Bruno C. Costa"
