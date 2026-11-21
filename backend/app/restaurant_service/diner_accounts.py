"""Private restaurant history. Email proof is required to claim legacy bookings."""

from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Booking, GuestAccount, Venue, utc_now
from app.restaurant_service import booking_rows


def claim_bookings(session: Session, account: GuestAccount) -> None:
    if account.email_proven:
        session.execute(
            update(Booking)
            .where(
                Booking.account_id.is_(None),
                func.lower(func.trim(Booking.email)) == account.email.strip().lower(),
                Booking.venue_id.in_(select(Venue.id).where(Venue.kind == "restaurant")),
            )
            .values(account_id=account.id)
        )


def owned_booking(session: Session, account: GuestAccount, public_id: str) -> Booking:
    claim_bookings(session, account)
    row = session.scalar(
        select(Booking).where(Booking.public_id == public_id, Booking.account_id == account.id)
    )
    if row is None:
        raise ApiError(404, "not_found", "Booking not found.")
    return row


def describe(session: Session, venue: Venue, booking: Booking) -> dict[str, Any]:
    result = booking_rows.describe(session, venue, booking)
    result["restaurant"]["slug"] = venue.slug if venue.status == "published" else None
    result["can_cancel"] = booking.status == "confirmed" and booking.start_at > utc_now()
    return result
