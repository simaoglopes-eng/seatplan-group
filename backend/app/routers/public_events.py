"""Public events pages: event types, upcoming listed events, event venues.

Anyone may call these; they share one read limit per address, like the
restaurant search (routers/discovery.py). What counts as public is decided in
events_service/public.py.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request

from app import db
from app.events_service import public
from app.events_service.event_types import EVENT_TYPES, EventType, VenueType
from app.routers.restaurants import READ_LIMIT
from app.security import client_ip, rate_limit

router = APIRouter(tags=["public events"])


def _read_limit(session: db.SessionDep, request: Request) -> None:
    rate_limit(session, f"e-read:{client_ip(request)}", limit=READ_LIMIT, window_s=60)


@router.get("/event-types")
def event_types(request: Request, session: db.SessionDep) -> list[dict[str, str]]:
    _read_limit(session, request)
    return [{"key": key, "label": label} for key, label in EVENT_TYPES.items()]


@router.get("/public-events")
def public_events(
    request: Request,
    session: db.SessionDep,
    type: EventType | None = None,
    venue: Annotated[str | None, Query(min_length=1, max_length=60)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> dict[str, Any]:
    _read_limit(session, request)
    return public.public_events(session, type, venue, limit, offset)


@router.get("/event-venues")
def event_venues(
    request: Request,
    session: db.SessionDep,
    type: VenueType | None = None,
) -> dict[str, Any]:
    _read_limit(session, request)
    return public.event_venues(session, type)


@router.get("/event-venues/{slug}")
def event_venue(slug: str, request: Request, session: db.SessionDep) -> dict[str, Any]:
    _read_limit(session, request)
    return public.venue_page(session, slug)
