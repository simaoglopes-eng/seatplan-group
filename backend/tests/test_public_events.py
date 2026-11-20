"""The public events pages: only listed events with the link on, at published event venues.

An event appears publicly only when ALL hold: listed, shared link on, starts
in the future, at an event venue that is published and has a slug. A
share-enabled but unlisted event never appears, on any of the three routes.
"""

from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from guest_helpers import shared_event
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_events_setup import EventSetup

from app.models import Event, Organiser, Venue, utc_now
from app.seed import demo_photos


def _public_venue(
    session: Session, setup: EventSetup, slug: str, venue_type: str = "quinta"
) -> Venue:
    event = session.scalars(select(Event).where(Event.public_id == setup.eid)).one()
    venue = session.get(Venue, event.venue_id)
    assert venue is not None
    venue.slug = slug
    venue.status = "published"
    venue.venue_type = venue_type
    venue.address = "Rua Inventada 1, Sintra"
    session.commit()
    return venue


def _set(session: Session, setup: EventSetup, **fields: Any) -> None:
    event = session.scalars(select(Event).where(Event.public_id == setup.eid)).one()
    for name, value in fields.items():
        setattr(event, name, value)
    session.commit()


def _listed_event(
    client: TestClient, session: Session, owner: Organiser, slug: str, **fields: Any
) -> tuple[EventSetup, str]:
    setup, token = shared_event(client, owner, [{"name": "Ana Silva"}])
    _public_venue(session, setup, slug)
    _set(session, setup, **{"listed": True, "event_type": "wedding", **fields})
    return setup, token


def _ids(client: TestClient, **params: Any) -> list[str]:
    answer = client.get("/api/public-events", params=params)
    assert answer.status_code == 200, answer.text
    return [item["public_id"] for item in answer.json()["items"]]


def test_event_types_are_listed_with_labels(client: TestClient) -> None:
    answer = client.get("/api/event-types")
    assert answer.status_code == 200
    assert answer.json()[:2] == [
        {"key": "wedding", "label": "Wedding"},
        {"key": "conference", "label": "Conference"},
    ]
    assert len(answer.json()) == 6


def test_a_listed_shared_event_appears_with_a_working_join_path(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup, token = _listed_event(client, session, organiser, "quinta-inventada")
    answer = client.get("/api/public-events").json()
    assert answer["total"] == 1
    item = answer["items"][0]
    assert item["public_id"] == setup.eid
    assert item["event_type"] == "wedding" and item["event_type_label"] == "Wedding"
    assert item["join_path"] == f"/j/{token}"
    assert item["venue"] == {
        "name": "Hall",
        "slug": "quinta-inventada",
        "venue_type": "quinta",
        "address": "Rua Inventada 1, Sintra",
        "cover_url": None,
    }
    share = client.get(f"/api/events/{setup.eid}/share", headers=setup.headers).json()
    assert item["places_left"] == share["places_left"] == 7
    page = client.get(f"/api/{item['join_path'].lstrip('/')}")
    assert page.status_code == 200 and page.json()["join"]["open"] is True


def test_an_unlisted_shared_event_never_appears_anywhere(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup, _token = _listed_event(client, session, organiser, "quinta-inventada")
    _set(session, setup, listed=False)
    assert _ids(client) == []
    assert _ids(client, type="wedding") == []
    assert _ids(client, venue="quinta-inventada") == []
    venues = client.get("/api/event-venues").json()["items"]
    assert [v["slug"] for v in venues] == ["quinta-inventada"]
    assert venues[0]["event_types"] == [] and venues[0]["upcoming_count"] == 0
    page = client.get("/api/event-venues/quinta-inventada").json()
    assert page["upcoming"] == [] and page["event_types"] == []
    assert setup.eid not in str(page) + str(venues)


def test_only_upcoming_shared_events_at_published_venues_with_a_slug(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    shown, _ = _listed_event(client, session, organiser, "shown-venue")
    link_off, _ = _listed_event(client, session, organiser, "link-off")
    _set(session, link_off, share_enabled=False)
    past, _ = _listed_event(client, session, organiser, "past-venue")
    _set(
        session,
        past,
        starts_at=utc_now() - timedelta(days=2),
        ends_at=utc_now() - timedelta(days=1),
    )
    draft, _ = _listed_event(client, session, organiser, "draft-venue")
    _public_venue(session, draft, "draft-venue").status = "draft"
    session.commit()
    no_slug, _ = _listed_event(client, session, organiser, "no-slug")
    _public_venue(session, no_slug, "no-slug").slug = None
    session.commit()
    assert _ids(client) == [shown.eid]
    slugs = [v["slug"] for v in client.get("/api/event-venues").json()["items"]]
    assert sorted(slugs) == ["link-off", "past-venue", "shown-venue"]
    assert client.get("/api/event-venues/draft-venue").status_code == 404


def test_filters_by_type_and_venue_and_refuses_unknown_types(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    wedding, _ = _listed_event(client, session, organiser, "quinta-a")
    gala, _ = _listed_event(client, session, organiser, "hall-b", event_type="gala_dinner")
    hall = session.scalars(select(Venue).where(Venue.slug == "hall-b")).one()
    hall.venue_type = "hall"
    session.commit()
    assert _ids(client, type="wedding") == [wedding.eid]
    assert _ids(client, type="gala_dinner") == [gala.eid]
    assert _ids(client, venue="hall-b") == [gala.eid]
    assert client.get("/api/public-events", params={"type": "funeral"}).status_code == 422
    halls = client.get("/api/event-venues", params={"type": "hall"}).json()["items"]
    assert [v["slug"] for v in halls] == ["hall-b"]
    assert halls[0]["event_types"] == ["gala_dinner"] and halls[0]["capacity"] == 8
    assert client.get("/api/event-venues", params={"type": "barn"}).status_code == 422


def test_the_venue_page_has_profile_photos_capacity_and_upcoming_events(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    _setup, token = _listed_event(client, session, organiser, "quinta-inventada")
    venue = session.scalars(select(Venue).where(Venue.slug == "quinta-inventada")).one()
    demo_photos.add_photos(
        session, venue, (("orange_patio", "An illustration of a garden with tables"),)
    )
    session.commit()
    page = client.get("/api/event-venues/quinta-inventada")
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["name"] == "Hall" and body["venue_type"] == "quinta"
    assert body["venue_type_label"] == "Quinta"
    assert body["capacity"] == 8 and body["tables"] == 2
    assert body["event_types"] == [{"key": "wedding", "label": "Wedding"}]
    assert [e["join_path"] for e in body["upcoming"]] == [f"/j/{token}"]
    photo_url = body["photos"][0]["url"]
    assert body["photos"][0]["is_cover"] is True
    picture = client.get(photo_url)
    assert picture.status_code == 200 and picture.content[:4] == b"\x89PNG"
    listed = client.get("/api/public-events").json()["items"][0]
    assert listed["venue"]["cover_url"] == photo_url

    # The same picture is private again once the venue has no slug.
    venue.slug = None
    session.commit()
    assert client.get(photo_url).status_code == 404
    assert client.get("/api/event-venues/quinta-inventada").status_code == 404


def test_restaurant_slugs_are_not_event_venues(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    restaurant = Venue(
        organiser_id=organiser.id,
        kind="restaurant",
        name="R",
        width=1,
        height=1,
        slug="a-restaurant",
        status="published",
    )
    session.add(restaurant)
    session.commit()
    assert client.get("/api/event-venues/a-restaurant").status_code == 404
    assert client.get("/api/event-venues").json()["items"] == []


def test_the_organiser_list_shows_type_and_venue_name(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup, _ = _listed_event(client, session, organiser, "quinta-inventada")
    rows = client.get("/api/events", headers=setup.headers).json()
    assert rows[0]["event_type"] == "wedding"
    assert rows[0]["event_type_label"] == "Wedding"
    assert rows[0]["venue_name"] == "Hall"
    assert rows[0]["listed"] is True and rows[0]["role"] == "organiser"
