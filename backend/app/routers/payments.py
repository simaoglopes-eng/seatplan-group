"""Deposit payments (/payments/...): status, the demo page, giving up, and the Stripe webhook.

A diner reaches these with the random payment id from their booking, never a
password. The id carries no data and is rate limited like every public route.
The Stripe webhook is the one route Stripe calls, so it proves itself with a
signature (payments/stripe_signature.py) instead of a login.
"""

import json
import time
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import db
from app.config import get_settings
from app.core.errors import ApiError
from app.models import Booking, BookingPayment, PaymentEvent, Venue, utc_now
from app.payments import providers, stripe_signature
from app.restaurant_service import booking_payments
from app.security import client_ip, rate_limit

router = APIRouter(tags=["payments"])

STATUS_LIMIT = 60
ACTION_LIMIT = 20
# A Stripe webhook is a few kilobytes. Anything bigger is not one.
MAX_WEBHOOK_BYTES = 64_000
# Webhooks that change a payment: Stripe re-reads the payment from its own API
# before believing them (see _stripe_event), so these are all it takes.
PAID_EVENTS = ("checkout.session.completed", "checkout.session.async_payment_succeeded")
CLOSED_EVENTS = ("checkout.session.expired", "checkout.session.async_payment_failed")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DemoOutcomeIn(Strict):
    outcome: Literal["ok", "decline"]


def _limit(session: Session, request: Request, name: str, limit: int) -> None:
    rate_limit(session, f"pay-{name}:{client_ip(request)}", limit=limit, window_s=60)


def _load(session: Session, payment_id: str) -> tuple[BookingPayment, Booking, Venue]:
    payment = booking_payments.load_payment(session, payment_id)
    booking = session.get(Booking, payment.booking_id)
    venue = session.get(Venue, payment.venue_id)
    if booking is None or venue is None:
        raise ApiError(404, "not_found", "Payment not found.")
    return payment, booking, venue


def _status(payment: BookingPayment, booking: Booking, venue: Venue) -> dict[str, Any]:
    return {
        "status": payment.status,
        "booking_status": booking.status,
        "amount_cents": payment.amount_cents,
        "expires_at": payment.expires_at.isoformat(),
        "restaurant": venue.name,
        "restaurant_slug": venue.slug,
        "mode": payment.provider,
    }


@router.get("/payments/{payment_id}")
def payment_status(payment_id: str, request: Request, session: db.SessionDep) -> dict[str, Any]:
    """Where a deposit stands. While it is pending it also asks the provider, so the
    diner's return page never has to wait for the webhook."""
    _limit(session, request, "status", STATUS_LIMIT)
    payment, booking, venue = _load(session, payment_id)
    booking_payments.refresh(session, venue, booking, payment)
    session.commit()
    return _status(payment, booking, venue)


@router.post("/payments/demo/{payment_id}")
def demo_pay(
    payment_id: str, body: DemoOutcomeIn, request: Request, session: db.SessionDep
) -> dict[str, Any]:
    """The pretend payment page's button. Exists only while the demo provider is on."""
    _limit(session, request, "demo", ACTION_LIMIT)
    if get_settings().payment_provider != "demo":
        raise ApiError(404, "not_found", "Not found.")
    payment, booking, venue = _load(session, payment_id)
    if payment.provider != "demo":
        raise ApiError(404, "not_found", "Not found.")
    declined = body.outcome == "decline"
    if not declined:
        paid = providers.CheckoutResult(
            status="complete",
            paid=True,
            payment_ref=f"demo_pi_{payment.public_id}",
            amount_cents=payment.amount_cents,
            payment_id=payment.public_id,
        )
        booking_payments.apply_result(session, venue, booking, payment, paid)
    session.commit()
    return {**_status(payment, booking, venue), "declined": declined}


@router.post("/payments/{payment_id}/retry")
def retry_payment(payment_id: str, request: Request, session: db.SessionDep) -> dict[str, Any]:
    """Open the payment page again (the diner closed it) while the wait lasts."""
    _limit(session, request, "action", ACTION_LIMIT)
    payment, booking, venue = _load(session, payment_id)
    if payment.status != "pending" or payment.expires_at <= utc_now():
        raise ApiError(409, "conflict", "This payment can no longer be completed.")
    return {"next_url": booking_payments.begin_checkout(session, venue, booking, payment)}


@router.post("/payments/{payment_id}/abandon")
def abandon_payment(payment_id: str, request: Request, session: db.SessionDep) -> dict[str, Any]:
    """The diner gave up: free the table at once instead of after the wait."""
    _limit(session, request, "action", ACTION_LIMIT)
    payment, booking, venue = _load(session, payment_id)
    booking_payments.expire_one(session, venue, booking, payment, "abandoned")
    session.commit()
    return _status(payment, booking, venue)


# ---------------------------------------------------------------- Stripe webhook


@router.post("/payments/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    session: db.SessionDep,
    stripe_signature_header: Annotated[str | None, Header(alias="Stripe-Signature")] = None,
) -> dict[str, bool]:
    body = await request.body()
    # The database work is synchronous, so it runs off the event loop.
    await run_in_threadpool(_stripe_event, session, request, body, stripe_signature_header)
    return {"received": True}


def _stripe_event(session: Session, request: Request, body: bytes, header: str | None) -> None:
    settings = get_settings()
    if settings.payment_provider != "stripe":
        raise ApiError(404, "not_found", "Not found.")
    _limit(session, request, "webhook", 300)
    if len(body) > MAX_WEBHOOK_BYTES:
        raise ApiError(400, "bad_request", "Webhook too large.")
    if not stripe_signature.verify(
        header or "", body, [settings.stripe_webhook_secret], int(time.time())
    ):
        raise ApiError(400, "bad_signature", "The webhook signature is not valid.")
    try:
        event = json.loads(body)
        event_id, kind = str(event["id"])[:255], str(event["type"])[:60]
        checkout_id = event["data"]["object"]["id"]
    except (ValueError, KeyError, TypeError):
        raise ApiError(400, "bad_request", "Unreadable webhook.") from None
    # Remember the event before acting on it. A repeat (Stripe retries until it
    # hears 200) hits the unique key and does nothing. If the work below fails the
    # whole transaction is undone, the key with it, so the retry is handled for real.
    session.add(PaymentEvent(provider="stripe", event_id=event_id, type=kind))
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        return
    if kind in PAID_EVENTS + CLOSED_EVENTS and isinstance(checkout_id, str):
        payment = session.scalar(
            select(BookingPayment).where(BookingPayment.checkout_id == checkout_id)
        )
        if payment is not None:
            booking = session.get(Booking, payment.booking_id)
            venue = session.get(Venue, payment.venue_id)
            if booking is not None and venue is not None:
                # Never believe the amounts or the status in the webhook body: ask
                # Stripe, with our own key, what really happened to this payment.
                result = providers.provider_from_settings(settings).read_checkout(checkout_id)
                booking_payments.apply_result(session, venue, booking, payment, result)
    session.commit()
