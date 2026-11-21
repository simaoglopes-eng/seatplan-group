"""The checks behind core/limits.py for work accounts: venues, restaurants, photos.

Each create path calls security.rate_limit first (it commits), then one
check below, then writes. The check takes the account's row lock first, so
two requests from one account at the same moment count one after the other
and cannot both slip under the limit. The count and sum queries themselves
take no lock (Postgres refuses FOR UPDATE with an aggregate).

Demo venues (is_demo) and an event's own room setup copy (parent_venue_id
set) are never counted: the seed makes the first, and applying a layout
preset makes the second without the organiser asking for a new venue.
"""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core import limits
from app.core.errors import ApiError
from app.models import Event, Organiser, Venue, VenuePhoto


def lock_account(session: Session, user: Organiser) -> None:
    """Hold this work account's row until the commit. Changes nothing."""
    session.execute(
        update(Organiser)
        .where(Organiser.id == user.id)
        .values(session_version=Organiser.session_version)
    )


def _own_venues(session: Session, user: Organiser, kind: str) -> int:
    query = select(func.count()).where(
        (Venue.organiser_id == user.id)
        & (Venue.kind == kind)
        & Venue.parent_venue_id.is_(None)
        & Venue.is_demo.is_(False)
    )
    return session.scalar(query) or 0


def _plural(count: int, word: str) -> str:
    return f"1 {word}" if count == 1 else f"{count} {word}s"


def require_room_for_venue(session: Session, user: Organiser, kind: str) -> None:
    """409 limit_reached when this account already has its share of `kind` venues."""
    lock_account(session, user)
    if kind == "restaurant":
        limit, word = limits.MAX_RESTAURANTS_PER_ACCOUNT, "restaurant"
    else:
        limit, word = limits.MAX_EVENT_VENUES_PER_ACCOUNT, "event venue"
    if _own_venues(session, user, kind) >= limit:
        raise ApiError(
            409,
            "limit_reached",
            f"One account can have up to {_plural(limit, word)}, and you have reached that. "
            "Contact us if you need more.",
            details={"limit": limit},
        )


def require_room_for_event(session: Session, user: Organiser) -> None:
    """409 limit_reached when this account already has its share of events.

    Counts every event of the account whose venue is not a demo one (a demo
    event's setup copy is a demo venue too). There is no route that deletes
    an event, so the count only grows.
    """
    lock_account(session, user)
    limit = limits.MAX_EVENTS_PER_ACCOUNT
    query = (
        select(func.count())
        .select_from(Event)
        .join(Venue, Venue.id == Event.venue_id)
        .where((Event.organiser_id == user.id) & Venue.is_demo.is_(False))
    )
    if (session.scalar(query) or 0) >= limit:
        raise ApiError(
            409,
            "limit_reached",
            f"One account can have up to {_plural(limit, 'event')}, and you have reached that. "
            "Contact us if you need more.",
            details={"limit": limit},
        )


def photo_bytes(session: Session, user: Organiser) -> int:
    """Bytes of every photo stored for this account's venues."""
    query = (
        select(func.coalesce(func.sum(func.length(VenuePhoto.data)), 0))
        .join(Venue, Venue.id == VenuePhoto.venue_id)
        .where(Venue.organiser_id == user.id)
    )
    return int(session.scalar(query) or 0)


def require_photo_room(session: Session, user: Organiser, adding: int) -> None:
    """409 storage_full when `adding` more bytes would pass the account's photo storage."""
    lock_account(session, user)
    if photo_bytes(session, user) + adding > limits.PHOTO_BYTES_PER_ACCOUNT:
        megabytes = limits.PHOTO_BYTES_PER_ACCOUNT // (1024 * 1024)
        raise ApiError(
            409,
            "storage_full",
            f"Your photos have used all {megabytes} MB of storage for this account. "
            "Delete a photo you no longer need, then try again.",
            details={"limit_bytes": limits.PHOTO_BYTES_PER_ACCOUNT},
        )
