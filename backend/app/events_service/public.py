"""The public events pages: upcoming listed events and the event venues that host them.

An event is public only when ALL of these hold (public_rows below):
- the organiser listed it (events.listed) and its shared link is on and current;
- it starts in the future;
- its venue is an event venue, published, with a slug.
Anything else, for example an event whose link is on but which is not listed,
never appears, so sharing a link privately stays private.

Each public event carries its join path (/j/<token>, the existing visitor
flow: an account is needed to hold a seat) and its places left.
"""

from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, aliased

from app.core.errors import ApiError
from app.events_service import share
from app.events_service.event_types import EVENT_TYPES, VENUE_TYPES, event_type_label
from app.models import Event, Seat, Venue, VenuePhoto, VenueTable, utc_now
from app.restaurant_service.discovery import maps_url


def _public_venues() -> Select[tuple[Venue]]:
    return select(Venue).where(
        Venue.kind == "event", Venue.status == "published", Venue.slug.is_not(None)
    )


def public_rows(
    session: Session, event_type: str | None = None, venue_id: int | None = None
) -> list[tuple[Event, Venue]]:
    """Every public event (see the module docstring), soonest first."""
    # An event on its own setup copy (core/parent_venue.py) shows its parent.
    room = aliased(Venue)
    query = (
        select(Event, Venue)
        .join(room, room.id == Event.venue_id)
        .join(Venue, Venue.id == func.coalesce(room.parent_venue_id, room.id))
        .where(
            Event.listed.is_(True),
            Event.share_enabled.is_(True),
            Event.starts_at > utc_now(),
            Venue.kind == "event",
            Venue.status == "published",
            Venue.slug.is_not(None),
        )
        .order_by(Event.starts_at, Event.id)
    )
    if event_type is not None:
        query = query.where(Event.event_type == event_type)
    if venue_id is not None:
        query = query.where(Venue.id == venue_id)
    rows = session.execute(query).tuples().all()
    # A link that must be made again (SECRET_KEY changed) has no path to give.
    return [(event, venue) for event, venue in rows if share.share_path(event) is not None]


def _covers(session: Session, venue_ids: list[int]) -> dict[int, VenuePhoto]:
    """Each venue's cover (the photo marked cover, else its first gallery photo)."""
    if not venue_ids:
        return {}
    rows = session.scalars(
        select(VenuePhoto)
        .where(VenuePhoto.venue_id.in_(venue_ids), VenuePhoto.kind == "gallery")
        .order_by(VenuePhoto.venue_id, VenuePhoto.position, VenuePhoto.id)
    )
    found: dict[int, VenuePhoto] = {}
    for photo in rows:
        best = found.get(photo.venue_id)
        if best is None or (photo.is_cover and not best.is_cover):
            found[photo.venue_id] = photo
    return found


def _photo_url(photo: VenuePhoto | None) -> str | None:
    return f"/api/photos/{photo.public_id}" if photo is not None else None


def event_item(
    session: Session, event: Event, venue: Venue, cover: VenuePhoto | None
) -> dict[str, Any]:
    return {
        "public_id": event.public_id,
        "name": event.name,
        "event_type": event.event_type,
        "event_type_label": event_type_label(event.event_type),
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
        "venue": {
            "name": venue.name,
            "slug": venue.slug,
            "venue_type": venue.venue_type,
            "address": venue.address,
            "cover_url": _photo_url(cover),
        },
        "places_left": share.places_left(session, event),
        "join_path": share.share_path(event),
    }


def public_events(
    session: Session, event_type: str | None, venue_slug: str | None, limit: int, offset: int
) -> dict[str, Any]:
    venue_id = None
    if venue_slug is not None:
        venue = session.scalars(_public_venues().where(Venue.slug == venue_slug)).first()
        if venue is None:
            return {"items": [], "total": 0}
        venue_id = venue.id
    rows = public_rows(session, event_type, venue_id)
    page = rows[offset : offset + limit]
    covers = _covers(session, sorted({venue.id for _event, venue in page}))
    items = [event_item(session, e, v, covers.get(v.id)) for e, v in page]
    return {"items": items, "total": len(rows)}


def _capacity(session: Session, venue: Venue) -> int:
    """Seats a guest could sit on: every seat that is not blocked."""
    count = session.scalar(
        select(func.count())
        .select_from(Seat)
        .where(Seat.venue_id == venue.id, Seat.is_blocked.is_(False))
    )
    return int(count or 0)


def _types_in_order(events: list[Event]) -> list[str]:
    present = {event.event_type for event in events}
    return [key for key in EVENT_TYPES if key in present]


def event_venues(session: Session, venue_type: str | None) -> dict[str, Any]:
    query = _public_venues().order_by(Venue.name, Venue.id)
    if venue_type is not None:
        query = query.where(Venue.venue_type == venue_type)
    venues = list(session.scalars(query))
    covers = _covers(session, [venue.id for venue in venues])
    upcoming: dict[int, list[Event]] = {}
    for event, venue in public_rows(session):
        upcoming.setdefault(venue.id, []).append(event)
    items = []
    for venue in venues:
        events = upcoming.get(venue.id, [])
        cover = covers.get(venue.id)
        items.append(
            {
                "slug": venue.slug,
                "name": venue.name,
                "venue_type": venue.venue_type,
                "venue_type_label": VENUE_TYPES.get(venue.venue_type or ""),
                "description": venue.description,
                "address": venue.address,
                "lat": venue.lat,
                "lng": venue.lng,
                "cover_url": _photo_url(cover),
                "cover_alt": cover.alt_text if cover is not None else None,
                "capacity": _capacity(session, venue),
                "event_types": _types_in_order(events),
                "upcoming_count": len(events),
            }
        )
    return {"items": items}


def venue_page(session: Session, slug: str) -> dict[str, Any]:
    venue = session.scalars(_public_venues().where(Venue.slug == slug)).first()
    if venue is None:
        raise ApiError(404, "not_found", "Venue not found.")
    rows = public_rows(session, venue_id=venue.id)
    gallery = list(
        session.scalars(
            select(VenuePhoto)
            .where(VenuePhoto.venue_id == venue.id, VenuePhoto.kind == "gallery")
            .order_by(VenuePhoto.position, VenuePhoto.id)
        )
    )
    cover = _covers(session, [venue.id]).get(venue.id)
    tables = session.scalar(
        select(func.count()).select_from(VenueTable).where(VenueTable.venue_id == venue.id)
    )
    return {
        "slug": venue.slug,
        "name": venue.name,
        "venue_type": venue.venue_type,
        "venue_type_label": VENUE_TYPES.get(venue.venue_type or ""),
        "description": venue.description,
        "address": venue.address,
        "lat": venue.lat,
        "lng": venue.lng,
        "phone": venue.phone,
        "website": venue.website,
        "instagram": venue.instagram,
        "maps_url": maps_url(venue),
        "timezone": venue.timezone,
        "photos": [
            {"url": _photo_url(p), "alt": p.alt_text, "is_cover": p.is_cover} for p in gallery
        ],
        "capacity": _capacity(session, venue),
        "tables": int(tables or 0),
        "event_types": [
            {"key": key, "label": EVENT_TYPES[key]}
            for key in _types_in_order([event for event, _venue in rows])
        ],
        "upcoming": [event_item(session, e, v, cover) for e, v in rows],
    }
