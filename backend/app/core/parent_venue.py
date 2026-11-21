"""An event's own copy of a room points at the hall or quinta it copies.

When an event gets its own setup (events_service/layouts.py) it moves to a
private child venue that holds only that event's tables and seats
(`venues.parent_venue_id`). Everything people see about the place, its name,
address, photos and public page, and everything about who works there, the
venue team, stays with the parent. These two helpers make that one rule.
"""

from sqlalchemy.orm import Session

from app.models import Venue


def shown_venue(session: Session, venue: Venue | None) -> Venue | None:
    """The venue to name and show: the parent of a setup copy, else the venue itself."""
    if venue is None or venue.parent_venue_id is None:
        return venue
    return session.get(Venue, venue.parent_venue_id) or venue


def shown_venue_of(session: Session, venue_id: int) -> Venue | None:
    return shown_venue(session, session.get(Venue, venue_id))
