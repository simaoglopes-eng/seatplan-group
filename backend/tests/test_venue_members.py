"""Venue members: an owner lets an address work at one venue, and only that venue.

Security first: a member of A never reaches B, never opens an owner-only page,
loses access the moment the owner removes them, and the owner never learns
whether an account exists for the address they typed.
"""

import base64
from typing import Any

from conftest import auth_header, make_user
from fastapi.testclient import TestClient
from guest_helpers import account_headers, make_account
from sqlalchemy.orm import Session
from test_events_setup import make_event

from app.events_service import accounts
from app.models import Organiser, Venue
from app.seed import demo_photos


def _restaurant(session: Session, owner: Organiser, name: str) -> str:
    venue = Venue(
        organiser_id=owner.id, kind="restaurant", name=name, width=100, height=100, status="draft"
    )
    session.add(venue)
    session.commit()
    return venue.public_id


def _members(vid: str) -> str:
    return f"/api/owner/venues/{vid}/members"


def _add(client: TestClient, owner: Organiser, vid: str, email: str) -> Any:
    return client.post(_members(vid), headers=auth_header(owner), json={"email": email})


def test_a_member_of_one_restaurant_works_there_and_nowhere_else(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    other_owner = make_user(session, "other.owner@example.com")
    a = _restaurant(session, organiser, "A")
    b = _restaurant(session, other_owner, "B")
    member = make_user(session, "mia.member@example.com")
    headers = auth_header(member)
    assert client.get(f"/api/staff/{a}/schedule", headers=headers).status_code == 404

    added = _add(client, organiser, a, " Mia.Member@Example.com ")
    assert added.status_code == 201, added.text
    assert added.json()["email"] == "mia.member@example.com"
    assert added.json()["role"] == "staff"
    assert client.get(f"/api/staff/{a}/schedule", headers=headers).status_code == 200
    assert client.get(f"/api/staff/{b}/schedule", headers=headers).status_code == 404

    # Owner-only pages stay with the owner. Each write gets a valid body, so a
    # 404 here is the access check, not body validation. (PUT .../rooms uses
    # the same owner loader as GET .../rooms.)
    picture = base64.b64encode(demo_photos.scene("tasca")).decode()
    photo = {"kind": "gallery", "content_type": "image/png", "data_base64": picture}
    for method, path, body in (
        ("GET", f"/api/owner/restaurants/{a}/profile", None),
        ("PATCH", f"/api/owner/restaurants/{a}/profile", {"name": "Taken over"}),
        ("GET", f"/api/owner/restaurants/{a}/photos", None),
        ("POST", f"/api/owner/restaurants/{a}/photos", photo),
        ("POST", f"/api/owner/restaurants/{a}/publish", None),
        ("POST", f"/api/owner/restaurants/{a}/unpublish", None),
        ("GET", f"/api/owner/restaurants/{a}/publish-check", None),
        ("GET", f"/api/owner/restaurants/{a}/payments", None),
        ("GET", f"/api/owner/restaurants/{a}/rooms", None),
        ("GET", f"/api/owner/restaurants/{a}/ambience-preview", None),
        ("GET", f"/api/owner/restaurants/{a}/menu", None),
        ("PUT", f"/api/owner/restaurants/{a}/menu", {"version": 0, "items": []}),
        ("GET", f"/api/owner/venues/{a}/members", None),
        ("POST", f"/api/owner/venues/{a}/members", {"email": "x@example.com"}),
    ):
        answer = client.request(method, path, headers=headers, json=body)
        assert answer.status_code == 404, (method, path, answer.text)
        if body is not None:  # the same body works for the owner
            owner_answer = client.request(method, path, headers=auth_header(organiser), json=body)
            assert owner_answer.status_code < 300, (method, path, owner_answer.text)

    member_id = added.json()["id"]
    removed = client.delete(f"{_members(a)}/{member_id}", headers=auth_header(organiser))
    assert removed.status_code == 200 and removed.json() == {"removed": True}
    assert client.get(f"/api/staff/{a}/schedule", headers=headers).status_code == 404


def test_a_member_of_an_event_venue_runs_its_events_but_not_the_floor_plan(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    mine = make_event(client, organiser, [{"name": "Ana Silva"}])
    other_owner = make_user(session, "other.owner@example.com")
    theirs = make_event(client, other_owner, [{"name": "Bea Costa"}])
    member = make_user(session, "eve.member@example.com")
    headers = auth_header(member)
    venue_id = client.get(f"/api/events/{mine.eid}", headers=mine.headers).json()["venue"][
        "public_id"
    ]
    assert client.get(f"/api/events/{mine.eid}", headers=headers).status_code == 404

    added = _add(client, organiser, venue_id, "eve.member@example.com")
    assert added.status_code == 201, added.text
    assert client.get(f"/api/events/{mine.eid}", headers=headers).status_code == 200
    assert client.get(f"/api/events/{mine.eid}/guests", headers=headers).status_code == 200
    assert client.get(f"/api/events/{theirs.eid}", headers=headers).status_code == 404
    listed = client.get("/api/events", headers=headers).json()
    assert [event["public_id"] for event in listed] == [mine.eid]
    assert listed[0]["role"] == "staff"
    assert client.get(f"/api/venues/{venue_id}", headers=headers).status_code == 200

    # Creating events and editing the floor plan stay with the owner.
    new_event = {
        "venue_id": venue_id,
        "name": "Not mine to make",
        "starts_at": "2030-05-01T18:00:00Z",
        "ends_at": "2030-05-01T23:00:00Z",
    }
    assert client.post("/api/events", headers=headers, json=new_event).status_code == 404
    layout = {"zones": [], "tables": [], "seats": []}
    assert (
        client.put(f"/api/venues/{venue_id}/layout", headers=headers, json=layout).status_code
        == 404
    )

    member_id = added.json()["id"]
    client.delete(f"/api/owner/venues/{venue_id}/members/{member_id}", headers=mine.headers)
    assert client.get(f"/api/events/{mine.eid}", headers=headers).status_code == 404
    assert client.get("/api/events", headers=headers).json() == []


def test_only_the_owner_manages_the_list_and_it_reveals_no_accounts(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    a = _restaurant(session, organiser, "A")
    stranger = make_user(session, "stranger@example.com")
    assert _add(client, stranger, a, "x@example.com").status_code == 404
    assert client.get(_members(a), headers=auth_header(stranger)).status_code == 404

    yourself = _add(client, organiser, a, organiser.email.upper())
    assert yourself.status_code == 422

    make_user(session, "has.account@example.com")
    with_account = _add(client, organiser, a, "has.account@example.com").json()
    without_account = _add(client, organiser, a, "no.account@example.com").json()
    assert sorted(with_account) == sorted(without_account) == ["created_at", "email", "id", "role"]
    again = _add(client, organiser, a, "has.account@example.com")
    assert again.status_code == 201 and again.json()["id"] == with_account["id"]
    listing = client.get(_members(a), headers=auth_header(organiser)).json()
    assert [row["email"] for row in listing["items"]] == [
        "has.account@example.com",
        "no.account@example.com",
    ]
    gone = client.delete(f"{_members(a)}/999999", headers=auth_header(organiser))
    assert gone.status_code == 404


def test_a_guest_token_never_opens_a_work_route_and_the_reverse(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    a = _restaurant(session, organiser, "A")
    account = make_account(session, organiser.email)
    guest = account_headers(account)
    assert client.get("/api/account/work", headers=guest).status_code == 401
    assert client.get(f"/api/owner/venues/{a}/members", headers=guest).status_code == 401
    assert client.get("/api/guest/me", headers=auth_header(organiser)).status_code == 401
    assert client.get("/api/diner/bookings", headers=auth_header(organiser)).status_code == 401


def test_a_member_address_never_gets_its_code_on_screen(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    a = _restaurant(session, organiser, "A")
    assert accounts.may_show_code(session, "future.staff@example.com") is True
    _add(client, organiser, a, "future.staff@example.com")
    assert accounts.may_show_code(session, "future.staff@example.com") is False
