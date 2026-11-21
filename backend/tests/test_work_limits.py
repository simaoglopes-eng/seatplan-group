"""Self-serve work accounts: at most 3 restaurants, 3 event venues, 10 events, 50 MB of photos.

Each limit lives in core/limits.py and is checked in core/work_limits.py
under the account's row lock. Creating also has an hourly rate limit.
Seeded demo venues and an event's own room setup copy are not counted.
"""

import base64
from typing import Any

import pytest
from conftest import auth_header, make_user
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_events_setup import make_event

from app.core import limits
from app.models import Event, Organiser, Venue, VenuePhoto

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7m0AAAAASUVORK5CYII="
)
EVENT = {
    "name": "Dinner",
    "starts_at": "2030-05-01T18:00:00Z",
    "ends_at": "2030-05-01T23:00:00Z",
}


def _venues(session: Session, owner: Organiser) -> int:
    session.expire_all()
    query = select(func.count()).select_from(Venue).where(Venue.organiser_id == owner.id)
    return session.scalar(query) or 0


def _restaurant(client: TestClient, owner: Organiser, name: str) -> Any:
    return client.post("/api/owner/restaurants", json={"name": name}, headers=auth_header(owner))


def test_the_fourth_restaurant_is_refused(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    for n in range(3):
        assert _restaurant(client, organiser, f"Place {n}").status_code == 201
    before = _venues(session, organiser)
    fourth = _restaurant(client, organiser, "Place 4")
    assert fourth.status_code == 409, fourth.text
    error = fourth.json()["error"]
    assert error["code"] == "limit_reached"
    assert error["message"] == (
        "One account can have up to 3 restaurants, and you have reached that. "
        "Contact us if you need more."
    )
    assert _venues(session, organiser) == before
    # The venues route cannot be used to get round it.
    sneak = client.post(
        "/api/venues",
        headers=auth_header(organiser),
        json={"kind": "restaurant", "name": "Sneaky", "width": 800, "height": 600},
    )
    assert sneak.status_code == 409 and sneak.json()["error"]["code"] == "limit_reached"


def test_demo_restaurants_do_not_count(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    for n in range(3):
        session.add(
            Venue(
                organiser_id=organiser.id,
                name=f"Demo {n}",
                kind="restaurant",
                is_demo=True,
                width=800,
                height=600,
            )
        )
    session.commit()
    assert _restaurant(client, organiser, "Mine").status_code == 201


def test_the_fourth_event_venue_is_refused_on_both_routes(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    headers = auth_header(organiser)
    first = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert first.status_code == 201, first.text
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    assert client.post("/api/venues", headers=headers, json=hall).status_code == 201
    third = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert third.status_code == 201, third.text
    before = _venues(session, organiser)
    fourth = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert fourth.status_code == 409 and fourth.json()["error"]["code"] == "limit_reached"
    assert "up to 3 event venues" in fourth.json()["error"]["message"]
    assert client.post("/api/venues", headers=headers, json=hall).status_code == 409
    assert _venues(session, organiser) == before
    # An event at a venue the organiser already has is still fine.
    vid = third.json()["venue_id"]
    again = client.post("/api/events", headers=headers, json={**EVENT, "venue_id": vid})
    assert again.status_code == 201, again.text


def test_events_on_one_venue_are_capped_per_account(
    client: TestClient, session: Session, organiser: Organiser, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One venue cannot be used to make events (and room setup copies) without end."""
    monkeypatch.setattr(limits, "MAX_EVENTS_PER_ACCOUNT", 3)
    headers = auth_header(organiser)
    first = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert first.status_code == 201, first.text
    vid = first.json()["venue_id"]
    for _ in range(2):
        again = client.post("/api/events", headers=headers, json={**EVENT, "venue_id": vid})
        assert again.status_code == 201, again.text
    events = select(func.count()).select_from(Event).where(Event.organiser_id == organiser.id)
    session.expire_all()
    before = session.scalar(events)
    fourth = client.post("/api/events", headers=headers, json={**EVENT, "venue_id": vid})
    assert fourth.status_code == 409, fourth.text
    assert fourth.json()["error"]["code"] == "limit_reached"
    assert "up to 3 events" in fourth.json()["error"]["message"]
    other = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert other.status_code == 409 and "up to 3 events" in other.json()["error"]["message"]
    session.expire_all()
    assert session.scalar(events) == before


def test_seeded_demo_events_do_not_count(client: TestClient, session: Session) -> None:
    """The demo organiser starts with its whole share of new events and venues."""
    from app.seed import demo_events

    organiser = make_user(session, demo_events.DEMO_ORGANISER_EMAIL)
    demo_events.seed(session)
    session.commit()
    halls = session.scalars(
        select(Venue).where((Venue.organiser_id == organiser.id) & Venue.parent_venue_id.is_(None))
    ).all()
    assert len(halls) == 2 and all(hall.is_demo for hall in halls)
    headers = auth_header(organiser)
    for _ in range(limits.MAX_EVENT_VENUES_PER_ACCOUNT):
        created = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
        assert created.status_code == 201, created.text


def test_a_room_setup_copy_does_not_count(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, [{"name": "Ana Silva"}], tables=4, per_table=8)
    applied = client.post(
        f"/api/events/{setup.eid}/layout", headers=setup.headers, json={"preset": "banquet"}
    )
    assert applied.status_code == 200, applied.text
    copies = select(func.count()).where(
        (Venue.organiser_id == organiser.id) & Venue.parent_venue_id.is_not(None)
    )
    assert session.scalar(copies) == 1
    for _ in range(2):  # the hall plus two more: three venues, the copy not counted
        created = client.post("/api/events/create-with-venue", headers=setup.headers, json=EVENT)
        assert created.status_code == 201, created.text


def test_creating_is_rate_limited(
    client: TestClient, organiser: Organiser, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limits, "RESTAURANT_CREATES_PER_HOUR", 1)
    monkeypatch.setattr(limits, "EVENT_CREATES_PER_HOUR", 1)
    assert _restaurant(client, organiser, "One").status_code == 201
    assert _restaurant(client, organiser, "Two").status_code == 429
    headers = auth_header(organiser)
    assert (
        client.post("/api/events/create-with-venue", headers=headers, json=EVENT).status_code == 201
    )
    assert (
        client.post("/api/events/create-with-venue", headers=headers, json=EVENT).status_code == 429
    )


def _upload(client: TestClient, vid: str, owner: Organiser) -> Any:
    body = {
        "kind": "gallery",
        "content_type": "image/png",
        "data_base64": base64.b64encode(PNG).decode(),
        "alt_text": "Room",
    }
    return client.post(
        f"/api/owner/restaurants/{vid}/photos", json=body, headers=auth_header(owner)
    )


def test_photo_storage_is_capped_per_account_across_restaurants(
    client: TestClient, session: Session, organiser: Organiser, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limits, "PHOTO_BYTES_PER_ACCOUNT", 2 * len(PNG))
    a = _restaurant(client, organiser, "A").json()["public_id"]
    b = _restaurant(client, organiser, "B").json()["public_id"]
    assert _upload(client, a, organiser).status_code == 201
    assert _upload(client, b, organiser).status_code == 201
    full = _upload(client, b, organiser)
    assert full.status_code == 409, full.text
    assert full.json()["error"]["code"] == "storage_full"
    assert "Delete a photo" in full.json()["error"]["message"]
    session.expire_all()
    assert session.scalar(select(func.count()).select_from(VenuePhoto)) == 2
    # Deleting a photo makes room again.
    photo_id = client.get(
        f"/api/owner/restaurants/{a}/photos", headers=auth_header(organiser)
    ).json()[0]["id"]
    deleted = client.delete(
        f"/api/owner/restaurants/{a}/photos/{photo_id}", headers=auth_header(organiser)
    )
    assert deleted.status_code == 204
    assert _upload(client, a, organiser).status_code == 201


def test_the_default_limits(organiser: Organiser) -> None:
    assert limits.MAX_RESTAURANTS_PER_ACCOUNT == 3
    assert limits.MAX_EVENT_VENUES_PER_ACCOUNT == 3
    assert limits.MAX_EVENTS_PER_ACCOUNT == 10
    assert limits.PHOTO_BYTES_PER_ACCOUNT == 50 * 1024 * 1024
