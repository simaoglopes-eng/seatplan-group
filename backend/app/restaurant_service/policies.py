"""What a restaurant asks up front: the deposit terms per service.

A restaurant with no row here takes bookings exactly as before. When a row
applies to a booking, the diner sees the terms before confirming and the
booking waits for its deposit (booking_payments.py).

Deposits are only switched on where no real money can move by mistake: the
demo provider (the default) only serves demo restaurants, or any restaurant
when the server runs in DEMO_MODE. A real restaurant needs the Stripe provider
to be connected first.
"""

from datetime import date, datetime, time
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import ApiError
from app.models import BookingPolicy, ServicePeriod, Venue, utc_now
from app.payments import money, providers
from app.restaurant_service import schedule
from app.restaurant_service.clock import local_datetime, when_text

MAX_POLICIES = 20


def payments_mode() -> str:
    """ "demo" (no money moves), "test" (Stripe test keys) or "live"."""
    return providers.provider_from_settings(get_settings()).mode


def payments_enabled(venue: Venue) -> bool:
    """True when deposits may be asked of this restaurant's diners."""
    settings = get_settings()
    return settings.payment_provider != "demo" or venue.is_demo or settings.demo_mode


def minimum_cents() -> int:
    return money.STRIPE_MIN_CHARGE_CENTS if get_settings().payment_provider == "stripe" else 1


def service_names(session: Session, venue: Venue) -> list[str]:
    """The restaurant's service names ("Lunch", "Dinner"), for the owner's form."""
    names = session.scalars(
        select(ServicePeriod.name).where(ServicePeriod.venue_id == venue.id).distinct()
    )
    return sorted(set(names))


def read_policies(session: Session, venue: Venue) -> list[dict[str, Any]]:
    rows = session.scalars(
        select(BookingPolicy)
        .where(BookingPolicy.venue_id == venue.id)
        .order_by(BookingPolicy.service_name)
    )
    return [
        {
            "service_name": row.service_name,
            "per_person_cents": row.per_person_cents,
            "cancel_hours": row.cancel_hours,
            "min_party": row.min_party,
        }
        for row in rows
    ]


def replace_policies(session: Session, venue: Venue, items: list[dict[str, Any]]) -> None:
    """Save the whole set at once. An empty list switches deposits off. Does not commit."""
    if len(items) > MAX_POLICIES:
        raise ApiError(422, "validation", f"At most {MAX_POLICIES} deposit rules are allowed.")
    if items and not payments_enabled(venue):
        raise ApiError(
            422,
            "payments_not_ready",
            "Online payments are not connected yet, so deposits cannot be switched on.",
        )
    seen: set[str] = set()
    for item in items:
        name = item["service_name"]
        if name in seen:
            raise ApiError(422, "validation", "Each service can have only one deposit rule.")
        seen.add(name)
        problem = money.policy_problem(
            item["per_person_cents"], item["cancel_hours"], item["min_party"], minimum_cents()
        )
        if problem:
            raise ApiError(422, "validation", problem)
    session.execute(delete(BookingPolicy).where(BookingPolicy.venue_id == venue.id))
    now = utc_now()
    for item in items:
        session.add(
            BookingPolicy(
                venue_id=venue.id,
                service_name=item["service_name"],
                mode="deposit",
                per_person_cents=item["per_person_cents"],
                cancel_hours=item["cancel_hours"],
                min_party=item["min_party"],
                updated_at=now,
            )
        )
    session.flush()


def policy_for(
    session: Session, venue: Venue, service_name: str, party: int
) -> BookingPolicy | None:
    """The deposit rule that applies to this service and party size, if any.

    The rule for the exact service name wins over the restaurant-wide one
    (service_name ""), and a rule only applies from its smallest party up.
    """
    if not payments_enabled(venue):
        return None
    rows = {
        row.service_name: row
        for row in session.scalars(select(BookingPolicy).where(BookingPolicy.venue_id == venue.id))
    }
    row = rows.get(service_name) or rows.get("")
    if row is None or row.mode != "deposit" or party < row.min_party:
        return None
    return row


def terms_for(
    session: Session, venue: Venue, day: date, at: time, party: int
) -> dict[str, Any] | None:
    """What the diner is told before confirming, or None when no deposit applies."""
    period = schedule.check_bookable(session, venue, day, at)
    policy = policy_for(session, venue, period.name, party)
    if policy is None:
        return None
    return describe_terms(venue, policy, local_datetime(venue, day, at), party)


def describe_terms(
    venue: Venue, policy: BookingPolicy, start: datetime, party: int
) -> dict[str, Any]:
    deadline = money.cancel_deadline(start, policy.cancel_hours)
    text, accept_text = money.policy_sentence(
        policy.per_person_cents, party, when_text(venue, deadline)
    )
    return {
        "mode": "deposit",
        "per_person_cents": policy.per_person_cents,
        "total_cents": money.deposit_total(policy.per_person_cents, party),
        "cancel_hours": policy.cancel_hours,
        "cancel_deadline": deadline.isoformat(),
        "text": text,
        "accept_text": accept_text,
        "payments_mode": payments_mode(),
    }
