"""An event's type: a closed list, optional on create and patch, cleared with null."""

import pytest
from conftest import auth_header
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.events_service.event_types import EVENT_TYPES, VENUE_TYPES, event_type_label
from app.models import Event, Organiser, Venue, VenueMember


def _venue(client: TestClient, organiser: Organiser) -> str:
    answer = client.post(
        "/api/venues",
        headers=auth_header(organiser),
        json={"kind": "event", "name": "Hall", "width": 1000, "height": 500},
    )
    assert answer.status_code == 201, answer.text
    return answer.json()["public_id"]


def _body(vid: str, **extra: object) -> dict[str, object]:
    return {
        "venue_id": vid,
        "name": "Typed party",
        "starts_at": "2030-05-01T18:00:00Z",
        "ends_at": "2030-05-01T23:00:00Z",
        **extra,
    }


def test_the_six_event_types_have_english_labels() -> None:
    assert EVENT_TYPES == {
        "wedding": "Wedding",
        "conference": "Conference",
        "birthday": "Birthday",
        "gala_dinner": "Gala dinner",
        "corporate_dinner": "Corporate dinner",
        "christening": "Christening",
    }
    assert set(VENUE_TYPES) == {"hall", "quinta"}
    assert event_type_label("gala_dinner") == "Gala dinner"
    assert event_type_label(None) is None


def test_event_type_is_optional_checked_and_can_be_cleared(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    headers = auth_header(organiser)
    vid = _venue(client, organiser)
    plain = client.post("/api/events", headers=headers, json=_body(vid))
    assert plain.status_code == 201, plain.text
    wrong = client.post("/api/events", headers=headers, json=_body(vid, event_type="funeral"))
    assert wrong.status_code == 422
    typed = client.post("/api/events", headers=headers, json=_body(vid, event_type="wedding"))
    assert typed.status_code == 201, typed.text
    eid = typed.json()["public_id"]

    def stored() -> Event:
        session.expire_all()
        return session.scalars(select(Event).where(Event.public_id == eid)).one()

    assert stored().event_type == "wedding"
    assert stored().listed is False
    bad = client.patch(f"/api/events/{eid}", headers=headers, json={"event_type": "party"})
    assert bad.status_code == 422
    changed = client.patch(f"/api/events/{eid}", headers=headers, json={"event_type": "birthday"})
    assert changed.status_code == 200, changed.text
    assert stored().event_type == "birthday"
    cleared = client.patch(f"/api/events/{eid}", headers=headers, json={"event_type": None})
    assert cleared.status_code == 200, cleared.text
    assert stored().event_type is None
    # Listing stays off: there is no write route for it in this release.
    assert (
        client.patch(f"/api/events/{eid}", headers=headers, json={"listed": True}).status_code
        == 422
    )


def test_venue_members_are_unique_per_venue_and_address(
    session: Session, organiser: Organiser
) -> None:
    venue = Venue(organiser_id=organiser.id, kind="event", name="Hall", width=10, height=10)
    session.add(venue)
    session.flush()
    session.add(VenueMember(venue_id=venue.id, email="a@example.com", added_by=organiser.id))
    session.commit()
    session.add(VenueMember(venue_id=venue.id, email="a@example.com", added_by=organiser.id))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()
    assert venue.venue_type is None
