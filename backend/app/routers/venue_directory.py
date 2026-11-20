"""Public directory of real venues in Portugal, Belgium and Italy (OpenStreetMap).

Anyone may call these; they share the public read limit (routers/public_events.py).
"""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request

from app import db
from app.events_service import directory
from app.routers.restaurants import READ_LIMIT
from app.security import client_ip, rate_limit

router = APIRouter(tags=["venue directory"])

Country = Literal["PT", "BE", "IT"]
Kind = Literal["estate", "hall", "conference"]


def _read_limit(session: db.SessionDep, request: Request) -> None:
    rate_limit(session, f"e-read:{client_ip(request)}", limit=READ_LIMIT, window_s=60)


@router.get("/venue-directory")
def venue_directory(
    request: Request,
    session: db.SessionDep,
    country: Country | None = None,
    kind: Kind | None = None,
    q: Annotated[str | None, Query(max_length=60)] = None,
    limit: Annotated[int, Query(ge=1, le=48)] = 24,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> dict[str, Any]:
    _read_limit(session, request)
    return directory.listings(session, country, kind, q, limit, offset)


@router.get("/venue-directory/counts")
def venue_directory_counts(request: Request, session: db.SessionDep) -> dict[str, Any]:
    _read_limit(session, request)
    return directory.counts(session)


@router.get("/venue-directory/{ref}")
def venue_directory_item(ref: str, request: Request, session: db.SessionDep) -> dict[str, Any]:
    _read_limit(session, request)
    return directory.listing(session, ref)
