"""Staff-only visit history, matched by email within one restaurant."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Booking, Venue, utc_now
from app.restaurant_service.clock import hhmm, venue_zone


def describe(session: Session, venue: Venue, booking: Booking) -> dict[str, Any]:
    email = booking.email.strip().lower()
    if not email:
        return {"completed_visits": 0, "returning_customer": False, "visits": []}
    criteria = (
        Booking.venue_id == venue.id,
        Booking.id != booking.id,
        func.lower(func.trim(Booking.email)) == email,
        Booking.status == "completed",
        Booking.start_at < booking.start_at,
        Booking.end_at <= utc_now(),
    )
    total = session.scalar(select(func.count()).select_from(Booking).where(*criteria)) or 0
    rows = session.scalars(
        select(Booking)
        .where(*criteria)
        .order_by(Booking.start_at.desc(), Booking.id.desc())
        .limit(10)
    )
    zone = venue_zone(venue)
    return {
        "completed_visits": total,
        "returning_customer": total > 0,
        "visits": [
            {
                "date": row.date.isoformat(),
                "time": hhmm(row.start_at.astimezone(zone).time()),
                "party_size": row.party_size,
                "notes": row.notes,
                "occasion": row.occasion,
            }
            for row in rows
        ],
    }
