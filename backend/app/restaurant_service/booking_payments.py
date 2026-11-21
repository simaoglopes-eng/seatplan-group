"""A deposit's life: asked for, waiting, paid, expired, refunded.

A booking that needs a deposit is created as "pending". It already owns its
tables (table_slots), so nobody else can take them while the diner pays, but it
is not confirmed and no confirmation email has gone out. Three things can end
the wait, and all of them end up in the same few functions here:

  paid     -> the booking becomes "confirmed" and its confirmation email is released
  expired  -> after PENDING_MINUTES, or when the diner gives up: the tables go back,
              the waitlist is told, the unsent emails are dropped
  cancelled -> a paid booking cancelled later is refunded or kept, per the terms the
              diner accepted (a snapshot stored on the payment row)

Every state change is a conditional UPDATE ("only if still pending"), so two
clicks, a retried webhook, or the cron racing the diner can never do it twice:
the database lets exactly one of them win, the same idea as table_slots.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import ApiError
from app.models import Booking, BookingPayment, Venue, utc_now
from app.payments import money, providers
from app.payments.providers import CheckoutRequest, CheckoutResult, PaymentError
from app.restaurant_service import booking_rows, emails, waitlist
from app.restaurant_service.changes import record_change

logger = logging.getLogger("seatplan.payments")

# How long a pending booking keeps its table. Stripe will not make a payment
# page expire sooner than 30 minutes, so we use the same.
PENDING_MINUTES = 30
SWEEP_BATCH = 50


@dataclass(frozen=True)
class Deposit:
    """The terms the diner accepted, copied onto the payment."""

    per_person_cents: int
    cancel_hours: int
    text: str


def payment_of(session: Session, booking_id: int) -> BookingPayment | None:
    return session.scalar(select(BookingPayment).where(BookingPayment.booking_id == booking_id))


def payments_for(session: Session, booking_ids: list[int]) -> dict[int, BookingPayment]:
    """The payments of many bookings in one query, keyed by booking id."""
    if not booking_ids:
        return {}
    rows = session.scalars(select(BookingPayment).where(BookingPayment.booking_id.in_(booking_ids)))
    return {row.booking_id: row for row in rows}


def load_payment(session: Session, public_id: str) -> BookingPayment:
    payment = session.scalar(select(BookingPayment).where(BookingPayment.public_id == public_id))
    if payment is None:
        raise ApiError(404, "not_found", "Payment not found.")
    return payment


def _provider() -> providers.PaymentProvider:
    return providers.provider_from_settings(get_settings())


def _move(session: Session, payment: BookingPayment, was: str, **values: Any) -> bool:
    """Change the payment's status only if it still is `was`. True when we won the race."""
    result = session.execute(
        update(BookingPayment)
        .where(BookingPayment.id == payment.id, BookingPayment.status == was)
        .values(updated_at=utc_now(), **values)
    )
    session.refresh(payment)
    return result.rowcount == 1  # type: ignore[attr-defined]


# ----------------------------------------------------------------- starting


def create_pending(
    session: Session, venue: Venue, booking: Booking, deposit: Deposit
) -> BookingPayment:
    """Record the deposit and make the booking wait for it. Does not commit."""
    now = utc_now()
    booking.status = "pending"
    payment = BookingPayment(
        booking_id=booking.id,
        venue_id=venue.id,
        provider=_provider().name,
        status="pending",
        per_person_cents=deposit.per_person_cents,
        party_at_booking=booking.party_size,
        amount_cents=money.deposit_total(deposit.per_person_cents, booking.party_size),
        cancel_hours=deposit.cancel_hours,
        policy_text=deposit.text[:400],
        accepted_at=now,
        created_at=now,
        updated_at=now,
        expires_at=now + timedelta(minutes=PENDING_MINUTES),
    )
    session.add(payment)
    session.flush()
    return payment


def begin_checkout(
    session: Session, venue: Venue, booking: Booking, payment: BookingPayment
) -> str:
    """Open the payment page and return where to send the diner. Commits.

    Called after the booking itself is saved, so no database transaction is held
    open while we wait for the provider. If the provider cannot be reached the
    booking is undone at once: the diner never ends up holding a table for
    a payment that cannot happen.
    """
    base = get_settings().public_base_url
    page = f"{base}/pay/return/{payment.public_id}"
    request = CheckoutRequest(
        payment_id=payment.public_id,
        amount_cents=payment.amount_cents,
        description=f"Deposit for {venue.name}"[:120],
        customer_email=booking.email,
        success_url=page,
        cancel_url=page,
        expires_at=providers.session_expiry(payment.created_at),
        idempotency_key=f"checkout-{payment.public_id}",
    )
    try:
        started = _provider().start_checkout(request)
    except PaymentError as error:
        logger.warning("checkout not started: %s", error)
        expire_one(session, venue, booking, payment, "provider_error")
        session.commit()
        raise ApiError(
            502,
            "payment_unavailable",
            "We could not start the payment, so your table was not kept. Please try again.",
        ) from None
    payment.checkout_id = started.checkout_id
    session.commit()
    return started.url


# ----------------------------------------------------------------- outcomes


def apply_result(
    session: Session,
    venue: Venue,
    booking: Booking,
    payment: BookingPayment,
    result: CheckoutResult,
) -> None:
    """Act on what the provider says about a payment. Safe to call any number of times."""
    now = utc_now()
    if result.paid:
        if payment.status == "pending":
            if _move(
                session,
                payment,
                "pending",
                status="paid",
                payment_ref=result.payment_ref or payment.payment_ref,
            ):
                booking.status = "confirmed"
                emails.release_confirmation(session, booking)
                record_change(
                    session,
                    venue,
                    [booking.date],
                    actor="diner",
                    action="booking.deposit_paid",
                    entity="booking",
                    entity_id=booking.public_id,
                    detail={"amount_cents": payment.amount_cents},
                )
        elif payment.status == "expired":
            # The money arrived after we had already handed the table back.
            payment.payment_ref = result.payment_ref or payment.payment_ref
            _refund(session, payment, payment.amount_cents, now)
        return
    if result.status == "expired" and payment.status == "pending":
        expire_one(session, venue, booking, payment, "provider_expired")


def refresh(session: Session, venue: Venue, booking: Booking, payment: BookingPayment) -> None:
    """Ask the provider where a pending payment stands (the diner came back from its page).

    We never depend on the webhook arriving first, so the return page pulls the
    answer itself. A provider hiccup just leaves the payment pending.
    """
    if payment.status != "pending" or not payment.checkout_id:
        return
    try:
        result = _provider().read_checkout(payment.checkout_id)
    except PaymentError as error:
        logger.warning("checkout not read: %s", error)
        return
    apply_result(session, venue, booking, payment, result)


def expire_one(
    session: Session, venue: Venue, booking: Booking, payment: BookingPayment, reason: str
) -> None:
    """The wait is over without a payment: give the tables back. Does not commit."""
    if not _move(session, payment, "pending", status="expired"):
        return  # someone else already settled it
    if booking.status == "pending":
        emails.drop_unsent_booking_emails(session, booking)
        freed = booking_rows.release_slots(session, booking)
        booking.status = "cancelled"
        session.flush()  # the freed slots must be gone before we look for free tables
        waitlist.offer_freed_tables(session, venue, booking, freed)
        record_change(
            session,
            venue,
            [booking.date],
            actor="system",
            action="booking.payment_expired",
            entity="booking",
            entity_id=booking.public_id,
            detail={"reason": reason},
        )
    if payment.checkout_id:
        try:
            _provider().expire_checkout(payment.checkout_id)
        except PaymentError as error:
            # Already paid or already closed: the webhook or the next pull sorts it out.
            logger.info("checkout not closed: %s", error)


def _refund(session: Session, payment: BookingPayment, cents: int, now: datetime) -> None:
    """Give money back. A failure is not lost: the payment waits as "refund_due"."""
    try:
        _provider().refund(payment.payment_ref or "", cents, f"refund-{payment.public_id}")
    except PaymentError as error:
        logger.warning("refund will be retried: %s", error)
        payment.status = "refund_due"
        payment.updated_at = now
        return
    payment.status = "refunded"
    payment.refunded_cents = cents
    payment.updated_at = now


def on_cancel(
    session: Session, venue: Venue, booking: Booking, by_diner: bool, now: datetime
) -> None:
    """A booking is being cancelled: settle its deposit. Does not commit.

    Inside the free-cancellation window, or when the restaurant cancels, the
    diner gets everything back. Otherwise the restaurant keeps it.
    """
    payment = payment_of(session, booking.id)
    if payment is None:
        return
    if payment.status == "pending":
        _move(session, payment, "pending", status="expired")
        if payment.checkout_id:
            try:
                _provider().expire_checkout(payment.checkout_id)
            except PaymentError as error:
                logger.info("checkout not closed: %s", error)
        return
    if payment.status != "paid":
        return
    deadline = money.cancel_deadline(booking.start_at, payment.cancel_hours)
    due = money.refund_due(payment.amount_cents, now, deadline, by_restaurant=not by_diner)
    if due == 0:
        payment.status = "kept"
        payment.updated_at = now
        return
    _refund(session, payment, due, now)


# ----------------------------------------------------------------- sweeping


def expire_due(session: Session, now: datetime, venue: Venue | None = None) -> int:
    """Expire pending payments whose wait is over, for one restaurant or all. Does not commit."""
    query = select(BookingPayment).where(
        BookingPayment.status == "pending", BookingPayment.expires_at <= now
    )
    if venue is not None:
        query = query.where(BookingPayment.venue_id == venue.id)
    count = 0
    for payment in list(session.scalars(query.limit(SWEEP_BATCH))):
        booking = session.get(Booking, payment.booking_id)
        owner = venue or session.get(Venue, payment.venue_id)
        if booking is None or owner is None:
            continue
        expire_one(session, owner, booking, payment, "timeout")
        count += 1
    return count


def retry_refunds(session: Session, now: datetime) -> int:
    count = 0
    query = select(BookingPayment).where(BookingPayment.status == "refund_due").limit(SWEEP_BATCH)
    for payment in list(session.scalars(query)):
        due = payment.amount_cents - payment.refunded_cents
        _refund(session, payment, due, now)
        count += 1
    return count


def sweep(session: Session, now: datetime) -> dict[str, int]:
    """The cron's job: expire waits that ran out and retry refunds that failed. Commits."""
    expired = expire_due(session, now)
    retried = retry_refunds(session, now)
    session.commit()
    return {"expired": expired, "refunds_retried": retried}


# ----------------------------------------------------------------- what screens show


def summary(
    payment: BookingPayment, booking: Booking, now: datetime | None = None
) -> dict[str, Any]:
    """The payment as the diner and the staff see it. No provider ids."""
    deadline = money.cancel_deadline(booking.start_at, payment.cancel_hours)
    outcome = "none"
    if payment.status == "paid":
        outcome = "refund" if (now or utc_now()) <= deadline else "keep"
    return {
        "kind": payment.kind,
        "status": payment.status,
        "amount_cents": payment.amount_cents,
        "per_person_cents": payment.per_person_cents,
        "party": payment.party_at_booking,
        "refunded_cents": payment.refunded_cents,
        "cancel_hours": payment.cancel_hours,
        "cancel_deadline": deadline.isoformat(),
        "cancel_outcome": outcome,
        "expires_at": payment.expires_at.isoformat(),
        "policy_text": payment.policy_text,
        "mode": payment.provider,
    }
