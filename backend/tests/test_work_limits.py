"""Work accounts: at most 3 restaurants, 3 event venues, 10 events not yet ended, 50 MB of photos.

Each limit lives in core/limits.py and is checked in core/work_limits.py
under the account's row lock. Creating also has an hourly rate limit.
Seeded demo venues and an event's own room setup copy are not counted.
"""

import base64
from datetime import UTC, datetime
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


def test_the_fourth_standalone_event_venue_is_refused(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """POST /venues keeps its limit of 3 event venues per account."""
    headers = auth_header(organiser)
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    for _ in range(3):
        assert client.post("/api/venues", headers=headers, json=hall).status_code == 201
    before = _venues(session, organiser)
    fourth = client.post("/api/venues", headers=headers, json=hall)
    assert fourth.status_code == 409 and fourth.json()["error"]["code"] == "limit_reached"
    assert "up to 3 event venues" in fourth.json()["error"]["message"]
    assert _venues(session, organiser) == before
    # An event on a venue it already has, or with a place of its own, is still fine.
    vid = client.get("/api/venues", headers=headers).json()[0]["public_id"]
    again = client.post("/api/events", headers=headers, json={**EVENT, "venue_id": vid})
    assert again.status_code == 201, again.text
    own = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert own.status_code == 201, own.text


def test_places_made_with_an_event_are_not_event_venues(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """The 4th dashboard event works, and the venue limit still leaves room for 3 halls."""
    headers = auth_header(organiser)
    for n in range(4):
        made = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
        assert made.status_code == 201, f"event {n + 1}: {made.text}"
    session.expire_all()
    marked = select(func.count()).where(
        (Venue.organiser_id == organiser.id) & Venue.made_with_event.is_(True)
    )
    assert session.scalar(marked) == 4
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    for _ in range(3):
        assert client.post("/api/venues", headers=headers, json=hall).status_code == 201
    assert client.post("/api/venues", headers=headers, json=hall).status_code == 409


def test_older_venues_without_the_mark_still_count_for_halls(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """made_with_event NULL (venues from before the column) counts; only True is left out."""
    for n in range(3):
        session.add(
            Venue(organiser_id=organiser.id, name=f"Old {n}", kind="event", width=1, height=1)
        )
    session.commit()
    headers = auth_header(organiser)
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    assert client.post("/api/venues", headers=headers, json=hall).status_code == 409
    # They never block an event with a place of its own.
    made = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert made.status_code == 201, made.text


def test_only_events_that_have_not_ended_count(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """The 11th upcoming event is refused; once events end, creating works again."""
    headers = auth_header(organiser)
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    hall_id = client.post("/api/venues", headers=headers, json=hall).json()["public_id"]
    made = []
    for n in range(limits.MAX_EVENTS_PER_ACCOUNT):
        created = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
        assert created.status_code == 201, f"event {n + 1}: {created.text}"
        made.append(created.json())
    eleventh = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert eleventh.status_code == 409, eleventh.text
    assert eleventh.json()["error"]["code"] == "limit_reached"
    assert "up to 10 events that have not ended yet" in eleventh.json()["error"]["message"]
    on_venue = {**EVENT, "venue_id": hall_id}
    refused = client.post("/api/events", headers=headers, json=on_venue)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "limit_reached"
    # Two events end: two places free up, on either route, and no more.
    for row in made[:2]:
        event = session.scalars(select(Event).where(Event.public_id == row["public_id"])).one()
        event.starts_at = datetime(2020, 5, 1, 18, tzinfo=UTC)
        event.ends_at = datetime(2020, 5, 1, 23, tzinfo=UTC)
    session.commit()
    again = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert again.status_code == 201, again.text
    assert client.post("/api/events", headers=headers, json=on_venue).status_code == 201
    full = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert full.status_code == 409, full.text


PAST = {"starts_at": "2020-05-01T18:00:00Z", "ends_at": "2020-05-01T23:00:00Z"}


def _end(session: Session, public_id: str) -> None:
    """Move one event into the past, as if it had happened."""
    event = session.scalars(select(Event).where(Event.public_id == public_id)).one()
    event.starts_at = datetime(2020, 5, 1, 18, tzinfo=UTC)
    event.ends_at = datetime(2020, 5, 1, 23, tzinfo=UTC)
    session.commit()


def _upcoming(session: Session, owner: Organiser) -> int:
    session.expire_all()
    query = (
        select(func.count())
        .select_from(Event)
        .where((Event.organiser_id == owner.id) & (Event.ends_at > datetime.now(UTC)))
    )
    return session.scalar(query) or 0


def test_an_event_that_has_already_ended_cannot_be_created(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """It would never count in the limit, so both routes refuse it."""
    headers = auth_header(organiser)
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    hall_id = client.post("/api/venues", headers=headers, json=hall).json()["public_id"]
    before = _venues(session, organiser)
    for path, body in (
        ("/api/events/create-with-venue", {**EVENT, **PAST}),
        ("/api/events", {**EVENT, **PAST, "venue_id": hall_id}),
    ):
        refused = client.post(path, headers=headers, json=body)
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["message"] == "The event must end in the future."
    session.expire_all()
    assert session.scalar(select(func.count()).select_from(Event)) == 0
    assert _venues(session, organiser) == before


def test_moving_an_ended_event_back_into_the_future_counts_again(
    client: TestClient, session: Session, organiser: Organiser, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ended, then moved forward: the 11th event not yet ended is refused."""
    monkeypatch.setattr(limits, "MAX_EVENTS_PER_ACCOUNT", 3)
    headers = auth_header(organiser)
    made = [
        client.post("/api/events/create-with-venue", headers=headers, json=EVENT).json()
        for _ in range(3)
    ]
    _end(session, made[0]["public_id"])
    third = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert third.status_code == 201, third.text
    assert _upcoming(session, organiser) == 3
    revive = {"starts_at": EVENT["starts_at"], "ends_at": EVENT["ends_at"]}
    url = f"/api/events/{made[0]['public_id']}"
    refused = client.patch(url, headers=headers, json=revive)
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"]["code"] == "limit_reached"
    assert _upcoming(session, organiser) == 3
    # Other changes to an ended event, and moving an event earlier, still work.
    assert client.patch(url, headers=headers, json={"name": "Renamed"}).status_code == 200
    earlier = client.patch(f"/api/events/{made[1]['public_id']}", headers=headers, json=PAST)
    assert earlier.status_code == 200, earlier.text
    # With room again (one of three ended), the ended event can come back.
    assert _upcoming(session, organiser) == 2
    again = client.patch(url, headers=headers, json=revive)
    assert again.status_code == 200, again.text
    assert _upcoming(session, organiser) == 3


def test_a_place_made_with_an_event_holds_only_that_event(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """It is not counted as an event venue, so POST /events cannot reuse it."""
    headers = auth_header(organiser)
    made = client.post("/api/events/create-with-venue", headers=headers, json=EVENT).json()
    reuse = client.post(
        "/api/events", headers=headers, json={**EVENT, "venue_id": made["venue_id"]}
    )
    assert reuse.status_code == 404, reuse.text
    session.expire_all()
    assert session.scalar(select(func.count()).select_from(Event)) == 1


def test_events_on_one_venue_are_capped_per_account(
    client: TestClient, session: Session, organiser: Organiser, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One venue cannot be used to make events (and room setup copies) without end."""
    monkeypatch.setattr(limits, "MAX_EVENTS_PER_ACCOUNT", 3)
    headers = auth_header(organiser)
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    vid = client.post("/api/venues", headers=headers, json=hall).json()["public_id"]
    first = client.post("/api/events", headers=headers, json={**EVENT, "venue_id": vid})
    assert first.status_code == 201, first.text
    for _ in range(2):
        again = client.post("/api/events", headers=headers, json={**EVENT, "venue_id": vid})
        assert again.status_code == 201, again.text
    events = select(func.count()).select_from(Event).where(Event.organiser_id == organiser.id)
    session.expire_all()
    before = session.scalar(events)
    fourth = client.post("/api/events", headers=headers, json={**EVENT, "venue_id": vid})
    assert fourth.status_code == 409, fourth.text
    assert fourth.json()["error"]["code"] == "limit_reached"
    assert "up to 3 events that have not ended" in fourth.json()["error"]["message"]
    other = client.post("/api/events/create-with-venue", headers=headers, json=EVENT)
    assert (
        other.status_code == 409
        and "up to 3 events that have not ended" in other.json()["error"]["message"]
    )
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
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    for _ in range(limits.MAX_EVENT_VENUES_PER_ACCOUNT):
        created = client.post("/api/venues", headers=headers, json=hall)
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
    hall = {"kind": "event", "name": "Hall", "width": 1000, "height": 500}
    for _ in range(2):  # the hall plus two more: three venues, the copy not counted
        created = client.post("/api/venues", headers=setup.headers, json=hall)
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
