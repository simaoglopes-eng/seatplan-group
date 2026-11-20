"""Deposits end to end: terms, the pending booking, paying, expiring, refunding, Stripe.

Most tests use the demo provider (the default: no network, no money). The Stripe
tests swap in a StripeProvider whose HTTP calls go to a fake Stripe built here,
so nothing leaves the machine and every request we send can be inspected.
"""

import hashlib
import hmac
import json
import time as clock
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
from conftest import auth_header
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_restaurant_helpers import Place, book, future_day, hold, make_restaurant

from app.config import get_settings, load_settings
from app.models import (
    AuditLog,
    Booking,
    BookingPayment,
    BookingPolicy,
    EmailOutbox,
    Organiser,
    PaymentEvent,
    TableSlot,
    Venue,
)
from app.payments import providers
from app.restaurant_service import booking_payments, policies

WEBHOOK_SECRET = "whsec_test_secret"
PER_PERSON = 2000  # €20


def _set_policy(
    session: Session, place: Place, per_person: int = PER_PERSON, hours: int = 24, **extra: Any
) -> None:
    venue = session.get(Venue, place.venue_id)
    item = {
        "service_name": "",
        "per_person_cents": per_person,
        "cancel_hours": hours,
        "min_party": 1,
        **extra,
    }
    policies.replace_policies(session, venue, [item])
    session.commit()


def _book_with_deposit(
    client: TestClient, place: Place, day: Any = None, at: str = "19:00", party: int = 2
) -> dict[str, Any]:
    held = hold(client, place, day or future_day(), at, party)
    assert held.status_code == 201, held.text
    booked = book(client, place, held.json()["hold_id"], party, accept_policy=True)
    assert booked.status_code == 201, booked.text
    return booked.json()


def _booking(session: Session) -> Booking:
    session.expire_all()
    return session.scalars(select(Booking)).one()


def _payment(session: Session) -> BookingPayment:
    session.expire_all()
    return session.scalars(select(BookingPayment)).one()


def _confirmation(session: Session) -> EmailOutbox | None:
    session.expire_all()
    return session.scalar(select(EmailOutbox).where(EmailOutbox.kind == "booking_confirmed"))


def _demo_pay(client: TestClient, payment_id: str, outcome: str = "ok") -> httpx.Response:
    return client.post(f"/api/payments/demo/{payment_id}", json={"outcome": outcome})


# ------------------------------------------------------------------ terms


def test_without_a_policy_nothing_changes(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    held = hold(client, place, future_day(), "19:00", 2).json()
    booked = book(client, place, held["hold_id"], 2).json()
    assert booked["booking"]["status"] == "confirmed"
    assert "payment" not in booked
    asked = client.get(
        f"/api/r/{place.public_id}/policy",
        params={"date": future_day().isoformat(), "time": "19:00", "party": 2},
    )
    assert asked.json() == {"mode": "none"}


def test_the_terms_are_shown_before_booking(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    terms = client.get(
        f"/api/r/{place.public_id}/policy",
        params={"date": future_day().isoformat(), "time": "19:00", "party": 2},
    ).json()
    assert terms["mode"] == "deposit"
    assert terms["per_person_cents"] == PER_PERSON and terms["total_cents"] == 2 * PER_PERSON
    assert "€20 per person" in terms["text"] and "keeps the deposit" in terms["text"]
    assert terms["payments_mode"] == "demo"


def test_a_rule_only_applies_from_its_smallest_party(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place, min_party=4)
    params = {"date": future_day().isoformat(), "time": "19:00"}
    small = client.get(f"/api/r/{place.public_id}/policy", params={**params, "party": 2}).json()
    big = client.get(f"/api/r/{place.public_id}/policy", params={**params, "party": 4}).json()
    assert small == {"mode": "none"} and big["mode"] == "deposit"


def test_a_rule_for_one_service_beats_the_default(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    venue = session.get(Venue, place.venue_id)
    base = {"cancel_hours": 24, "min_party": 1}
    policies.replace_policies(
        session,
        venue,
        [
            {"service_name": "", "per_person_cents": 500, **base},
            {"service_name": "Dinner", "per_person_cents": 3000, **base},
        ],
    )
    session.commit()
    day = future_day().isoformat()
    lunch = client.get(
        f"/api/r/{place.public_id}/policy", params={"date": day, "time": "12:30", "party": 2}
    ).json()
    dinner = client.get(
        f"/api/r/{place.public_id}/policy", params={"date": day, "time": "19:00", "party": 2}
    ).json()
    assert lunch["per_person_cents"] == 500 and dinner["per_person_cents"] == 3000


# ------------------------------------------------------------------ the pending booking


def test_the_terms_must_be_accepted_and_the_hold_survives_a_refusal(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    held = hold(client, place, future_day(), "19:00", 2).json()
    refused = book(client, place, held["hold_id"], 2)
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "policy_not_accepted"
    # Nothing was booked and the diner can still tick the box with the same hold.
    assert session.scalar(select(func.count()).select_from(Booking)) == 0
    assert book(client, place, held["hold_id"], 2, accept_policy=True).status_code == 201


def test_a_deposit_booking_waits_as_pending_and_keeps_its_table(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    answer = _book_with_deposit(client, place)
    assert answer["booking"]["status"] == "pending"
    payment = answer["payment"]
    assert payment["required"] is True and payment["amount_cents"] == 2 * PER_PERSON
    assert payment["next_url"] == f"/pay/demo/{payment['payment_id']}"
    # It already owns its table, so nobody else can take it meanwhile.
    assert session.scalar(select(func.count()).select_from(TableSlot)) > 0
    again = hold(client, place, future_day(), "19:00", 2, table_id=place.table["T1"])
    assert again.status_code == 409
    # And no confirmation has gone out: it is parked days ahead until the deposit is paid.
    parked = _confirmation(session)
    assert parked is not None
    assert parked.next_attempt_at > datetime.now(UTC) + timedelta(days=2)


def test_paying_confirms_the_booking_and_releases_the_email(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    answer = _book_with_deposit(client, place)
    paid = _demo_pay(client, answer["payment"]["payment_id"])
    assert paid.status_code == 200
    assert paid.json()["status"] == "paid" and paid.json()["booking_status"] == "confirmed"
    assert _booking(session).status == "confirmed"
    sent = _confirmation(session)
    assert sent is not None and sent.next_attempt_at <= datetime.now(UTC)
    assert "Deposit: €40" in sent.body_text and "Free cancellation until" in sent.body_text
    # The manage page shows what was paid and what cancelling would do.
    manage = client.get(answer["manage_path"].replace("/b/", "/api/b/")).json()
    assert manage["status"] == "confirmed"
    assert manage["payment"]["status"] == "paid"
    assert manage["payment"]["cancel_outcome"] == "refund"


def test_paying_twice_does_the_work_once(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    payment_id = _book_with_deposit(client, place)["payment"]["payment_id"]
    assert _demo_pay(client, payment_id).status_code == 200
    assert _demo_pay(client, payment_id).status_code == 200
    paid_rows = session.scalars(
        select(AuditLog).where(AuditLog.action == "booking.deposit_paid")
    ).all()
    assert len(paid_rows) == 1


def test_a_declined_demo_payment_leaves_the_booking_waiting(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    payment_id = _book_with_deposit(client, place)["payment"]["payment_id"]
    declined = _demo_pay(client, payment_id, "decline").json()
    assert declined["declined"] is True and declined["status"] == "pending"
    assert _booking(session).status == "pending"
    # The diner can still pay afterwards, within the wait.
    assert _demo_pay(client, payment_id).json()["status"] == "paid"


def test_giving_up_frees_the_table_at_once(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    payment_id = _book_with_deposit(client, place)["payment"]["payment_id"]
    gone = client.post(f"/api/payments/{payment_id}/abandon").json()
    assert gone["status"] == "expired" and gone["booking_status"] == "cancelled"
    assert session.scalar(select(func.count()).select_from(TableSlot)) == 0
    assert _confirmation(session).status == "skipped"  # type: ignore[union-attr]
    # Paying a payment that already expired cannot revive it (the demo refunds it).
    late = _demo_pay(client, payment_id).json()
    assert late["booking_status"] == "cancelled"
    assert late["status"] == "refunded"


def test_the_wait_ends_by_itself_and_the_cron_does_it(
    client: TestClient, session: Session, organiser: Organiser, monkeypatch: pytest.MonkeyPatch
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    _book_with_deposit(client, place)
    payment = _payment(session)
    payment.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    session.commit()
    monkeypatch.setenv("CRON_SECRET", "a-cron-secret-for-tests")
    get_settings.cache_clear()
    done = client.post(
        "/api/internal/email/process", headers={"X-Cron-Secret": "a-cron-secret-for-tests"}
    )
    assert done.status_code == 200
    assert _payment(session).status == "expired"
    assert _booking(session).status == "cancelled"
    assert session.scalar(select(func.count()).select_from(TableSlot)) == 0


def test_a_payment_that_is_still_in_time_is_left_alone_by_the_sweep(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    _book_with_deposit(client, place)
    assert booking_payments.sweep(session, datetime.now(UTC)) == {
        "expired": 0,
        "refunds_retried": 0,
    }
    assert _booking(session).status == "pending"


# ------------------------------------------------------------------ cancelling


def test_cancelling_inside_the_free_window_refunds_everything(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place, hours=24)
    answer = _book_with_deposit(client, place, day=future_day(7))
    _demo_pay(client, answer["payment"]["payment_id"])
    cancelled = client.delete(answer["manage_path"].replace("/b/", "/api/b/")).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["payment"]["status"] == "refunded"
    assert cancelled["payment"]["refunded_cents"] == 2 * PER_PERSON


def test_cancelling_after_the_deadline_keeps_the_deposit(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place, hours=72)
    # Tomorrow is inside the 72-hour window, so the free period is already over.
    answer = _book_with_deposit(client, place, day=future_day(1))
    _demo_pay(client, answer["payment"]["payment_id"])
    manage = client.get(answer["manage_path"].replace("/b/", "/api/b/")).json()
    assert manage["payment"]["cancel_outcome"] == "keep"
    cancelled = client.delete(answer["manage_path"].replace("/b/", "/api/b/")).json()
    assert cancelled["payment"]["status"] == "kept" and cancelled["payment"]["refunded_cents"] == 0


def test_the_restaurant_cancelling_always_refunds_in_full(
    client: TestClient, session: Session, organiser: Organiser, staff: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place, hours=72)
    answer = _book_with_deposit(client, place, day=future_day(1))
    _demo_pay(client, answer["payment"]["payment_id"])
    booking_id = answer["booking"]["id"]
    done = client.post(
        f"/api/staff/{place.public_id}/bookings/{booking_id}/status",
        json={"status": "cancelled"},
        headers=auth_header(staff),
    )
    assert done.status_code == 200, done.text
    assert _payment(session).status == "refunded"
    assert _payment(session).refunded_cents == 2 * PER_PERSON


# ------------------------------------------------------------------ the staff floor


def test_staff_see_the_deposit_and_cannot_seat_an_unpaid_booking(
    client: TestClient, session: Session, organiser: Organiser, staff: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    day = future_day()
    answer = _book_with_deposit(client, place, day=day)
    floor = client.get(
        f"/api/staff/{place.public_id}/floor",
        params={"date": day.isoformat(), "time": "19:00"},
        headers=auth_header(staff),
    )
    assert floor.status_code == 200, floor.text
    row = floor.json()["bookings"][0]
    assert row["status"] == "pending" and row["payment"]["status"] == "pending"
    assert {t["status"] for t in floor.json()["tables"]} >= {"reserved"}
    seat = client.post(
        f"/api/staff/{place.public_id}/bookings/{answer['booking']['id']}/status",
        json={"status": "seated"},
        headers=auth_header(staff),
    )
    assert seat.status_code == 409
    _demo_pay(client, answer["payment"]["payment_id"])
    floor = client.get(
        f"/api/staff/{place.public_id}/floor",
        params={"date": day.isoformat(), "time": "19:00"},
        headers=auth_header(staff),
    ).json()
    assert floor["bookings"][0]["payment"]["status"] == "paid"


# ------------------------------------------------------------------ the owner's settings


def test_the_owner_sets_and_clears_deposit_rules(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    url = f"/api/owner/restaurants/{place.public_id}/payments"
    start = client.get(url, headers=auth_header(organiser)).json()
    assert start["payments_mode"] == "demo" and start["available"] is True
    assert start["services"] == ["Dinner", "Lunch"] and start["policies"] == []
    rule = {"service_name": "Dinner", "per_person_cents": 1, "cancel_hours": 24, "min_party": 2}
    saved = client.put(url, json={"policies": [rule]}, headers=auth_header(organiser))
    assert saved.status_code == 200, saved.text  # one cent is fine for testing the demo
    assert saved.json()["policies"] == [rule]
    cleared = client.put(url, json={"policies": []}, headers=auth_header(organiser)).json()
    assert cleared["policies"] == []


@pytest.mark.parametrize(
    "rule",
    [
        {"per_person_cents": 0, "cancel_hours": 24},
        {"per_person_cents": 15001, "cancel_hours": 24},
        {"per_person_cents": 2000, "cancel_hours": 5},
        {"per_person_cents": 2000, "cancel_hours": 24, "min_party": 0},
        {"per_person_cents": 20.5, "cancel_hours": 24},
        {"per_person_cents": 2000, "cancel_hours": 24, "surprise": True},
    ],
)
def test_bad_deposit_rules_are_refused(
    client: TestClient, session: Session, organiser: Organiser, rule: dict[str, Any]
) -> None:
    place = make_restaurant(session, organiser)
    done = client.put(
        f"/api/owner/restaurants/{place.public_id}/payments",
        json={"policies": [{"service_name": "", **rule}]},
        headers=auth_header(organiser),
    )
    assert done.status_code == 422


def test_only_the_owner_can_change_the_rules(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    from conftest import make_user

    place = make_restaurant(session, organiser)
    other = make_user(session, "someone.else@example.com")
    url = f"/api/owner/restaurants/{place.public_id}/payments"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=auth_header(other)).status_code == 404
    assert client.put(url, json={"policies": []}, headers=auth_header(other)).status_code == 404


def test_a_real_restaurant_cannot_take_demo_deposits(
    client: TestClient, session: Session, organiser: Organiser, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Without Stripe connected, a restaurant that is not a demo one must not ask for
    "payments" that move no money."""
    place = make_restaurant(session, organiser)
    venue = session.get(Venue, place.venue_id)
    venue.is_demo = False
    session.commit()
    monkeypatch.setenv("DEMO_MODE", "0")
    get_settings.cache_clear()
    url = f"/api/owner/restaurants/{place.public_id}/payments"
    assert client.get(url, headers=auth_header(organiser)).json()["available"] is False
    rule = {"service_name": "", "per_person_cents": 2000, "cancel_hours": 24, "min_party": 1}
    refused = client.put(url, json={"policies": [rule]}, headers=auth_header(organiser))
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "payments_not_ready"
    # Even a rule saved earlier is ignored while payments are not connected.
    session.add(
        BookingPolicy(
            venue_id=venue.id, service_name="", per_person_cents=2000, cancel_hours=24, min_party=1
        )
    )
    session.commit()
    held = hold(client, place, future_day(), "19:00", 2).json()
    booked = book(client, place, held["hold_id"], 2).json()
    assert booked["booking"]["status"] == "confirmed" and "payment" not in booked


# ------------------------------------------------------------------ settings


def test_stripe_needs_its_keys_to_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite:///x.db")
    monkeypatch.setenv("PAYMENT_PROVIDER", "stripe")
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="STRIPE_SECRET_KEY"):
        load_settings()
    monkeypatch.setenv("PAYMENT_PROVIDER", "paypal")
    with pytest.raises(RuntimeError, match="demo' or 'stripe"):
        load_settings()


def test_a_live_key_needs_https(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite:///x.db")
    monkeypatch.setenv("PAYMENT_PROVIDER", "stripe")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_abc")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_x")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://example.test")
    with pytest.raises(RuntimeError, match="https"):
        load_settings()
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://example.test")
    assert load_settings().payment_provider == "stripe"


def test_the_keys_never_show_in_a_log_line(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite:///x.db")
    monkeypatch.setenv("PAYMENT_PROVIDER", "stripe")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_supersecret")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_supersecret")
    settings = load_settings()
    assert "supersecret" not in repr(settings)
    assert "supersecret" not in repr(providers.provider_from_settings(settings))


# ------------------------------------------------------------------ Stripe (a fake one)


class FakeStripe:
    """Answers the few Stripe calls we make, and remembers each request."""

    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self.paid = True
        self.down = False
        self.expire_fails = False

    def form(self, request: httpx.Request) -> dict[str, str]:
        return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self.down:
            raise httpx.ConnectError("no route to Stripe")
        path = request.url.path
        if request.method == "POST" and path == "/v1/checkout/sessions":
            return httpx.Response(
                200, json={"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"}
            )
        if request.method == "GET" and path == "/v1/checkout/sessions/cs_test_1":
            ours = self.form(self.calls[0])["client_reference_id"]
            return httpx.Response(
                200,
                json={
                    "id": "cs_test_1",
                    "status": "complete" if self.paid else "open",
                    "payment_status": "paid" if self.paid else "unpaid",
                    "payment_intent": {"id": "pi_test_1"},
                    "amount_total": 4000,
                    "client_reference_id": ours,
                },
            )
        if path.endswith("/expire"):
            if self.expire_fails:
                return httpx.Response(400, json={"error": {"type": "invalid_request_error"}})
            return httpx.Response(200, json={"id": "cs_test_1", "status": "expired"})
        if path == "/v1/refunds":
            return httpx.Response(200, json={"id": "re_test_1", "status": "succeeded"})
        return httpx.Response(404, json={"error": {"type": "invalid_request_error"}})

    def requests(self, path: str) -> list[httpx.Request]:
        return [call for call in self.calls if call.url.path == path]


@pytest.fixture
def stripe(monkeypatch: pytest.MonkeyPatch, database_url: str) -> FakeStripe:
    fake = FakeStripe()
    monkeypatch.setenv("PAYMENT_PROVIDER", "stripe")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_not_a_real_key")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    get_settings.cache_clear()
    real = providers.provider_from_settings

    def with_fake_network(settings: Any) -> Any:
        provider = real(settings)
        if isinstance(provider, providers.StripeProvider):
            provider._client = httpx.Client(transport=httpx.MockTransport(fake.handle))
        return provider

    monkeypatch.setattr(providers, "provider_from_settings", with_fake_network)
    return fake


def _signed(body: bytes, secret: str = WEBHOOK_SECRET, at: int | None = None) -> dict[str, str]:
    stamp = int(clock.time()) if at is None else at
    digest = hmac.new(secret.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()
    return {"Stripe-Signature": f"t={stamp},v1={digest}", "Content-Type": "application/json"}


def _event(kind: str = "checkout.session.completed", event_id: str = "evt_1") -> bytes:
    return json.dumps(
        {"id": event_id, "type": kind, "data": {"object": {"id": "cs_test_1"}}}
    ).encode()


def test_stripe_checkout_asks_for_the_right_amount_and_no_card_data(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    answer = _book_with_deposit(client, place)
    assert answer["payment"]["next_url"] == "https://checkout.stripe.com/c/pay/cs_test_1"
    created = stripe.requests("/v1/checkout/sessions")[0]
    form = stripe.form(created)
    assert form["mode"] == "payment"
    assert form["line_items[0][price_data][unit_amount]"] == "4000"
    assert form["line_items[0][price_data][currency]"] == "eur"
    assert form["client_reference_id"] == answer["payment"]["payment_id"]
    # Stripe will not make a page expire sooner than 30 minutes.
    assert int(form["expires_at"]) >= int(clock.time()) + 30 * 60
    assert created.headers["Authorization"] == "Bearer sk_test_not_a_real_key"
    assert created.headers["Idempotency-Key"].startswith("checkout-")
    assert "card" not in created.content.decode().replace("customer", "").lower()
    assert _payment(session).checkout_id == "cs_test_1"


def test_a_webhook_with_a_bad_signature_does_nothing(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    _book_with_deposit(client, place)
    body = _event()
    wrong = client.post(
        "/api/payments/webhooks/stripe", content=body, headers=_signed(body, "whsec_wrong")
    )
    assert wrong.status_code == 400 and wrong.json()["error"]["code"] == "bad_signature"
    old = client.post(
        "/api/payments/webhooks/stripe",
        content=body,
        headers=_signed(body, at=int(clock.time()) - 3600),
    )
    assert old.status_code == 400
    missing = client.post("/api/payments/webhooks/stripe", content=body)
    assert missing.status_code == 400
    assert _payment(session).status == "pending"
    assert session.scalar(select(func.count()).select_from(PaymentEvent)) == 0


def test_a_good_webhook_confirms_the_booking_once(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    _book_with_deposit(client, place)
    body = _event()
    first = client.post("/api/payments/webhooks/stripe", content=body, headers=_signed(body))
    assert first.status_code == 200, first.text
    assert _payment(session).status == "paid" and _payment(session).payment_ref == "pi_test_1"
    assert _booking(session).status == "confirmed"
    # Stripe retries until it hears back: the same event again changes nothing.
    second = client.post("/api/payments/webhooks/stripe", content=body, headers=_signed(body))
    assert second.status_code == 200
    assert session.scalar(select(func.count()).select_from(PaymentEvent)) == 1
    paid_rows = session.scalars(select(AuditLog).where(AuditLog.action == "booking.deposit_paid"))
    assert len(paid_rows.all()) == 1


def test_a_webhook_that_lies_is_not_believed(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    """A validly signed message says "completed", but Stripe itself says it is unpaid.
    We always ask Stripe, so the booking must stay pending."""
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    _book_with_deposit(client, place)
    stripe.paid = False
    body = _event()
    done = client.post("/api/payments/webhooks/stripe", content=body, headers=_signed(body))
    assert done.status_code == 200
    assert _payment(session).status == "pending"
    assert _booking(session).status == "pending"


def test_the_return_page_does_not_wait_for_the_webhook(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    payment_id = _book_with_deposit(client, place)["payment"]["payment_id"]
    status = client.get(f"/api/payments/{payment_id}").json()
    assert status["status"] == "paid" and status["booking_status"] == "confirmed"


def test_the_demo_page_does_not_exist_when_stripe_is_on(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    payment_id = _book_with_deposit(client, place)["payment"]["payment_id"]
    assert _demo_pay(client, payment_id).status_code == 404
    assert _payment(session).status == "pending"


def test_the_webhook_route_is_closed_when_stripe_is_off(
    client: TestClient, database_url: str
) -> None:
    body = _event()
    assert client.post("/api/payments/webhooks/stripe", content=body).status_code == 404


def test_a_cancellation_refunds_through_stripe_with_an_idempotency_key(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    answer = _book_with_deposit(client, place, day=future_day(7))
    client.get(f"/api/payments/{answer['payment']['payment_id']}")  # pulls "paid" from Stripe
    cancelled = client.delete(answer["manage_path"].replace("/b/", "/api/b/")).json()
    assert cancelled["payment"]["status"] == "refunded"
    refund = stripe.requests("/v1/refunds")[0]
    form = stripe.form(refund)
    assert form["payment_intent"] == "pi_test_1" and form["amount"] == "4000"
    assert refund.headers["Idempotency-Key"].startswith("refund-")


def test_a_failed_refund_is_kept_and_retried_by_the_cron(
    client: TestClient,
    session: Session,
    organiser: Organiser,
    stripe: FakeStripe,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    answer = _book_with_deposit(client, place, day=future_day(7))
    client.get(f"/api/payments/{answer['payment']['payment_id']}")
    original = stripe.handle

    def refund_fails(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/refunds":
            stripe.calls.append(request)
            return httpx.Response(500, json={"error": {"type": "api_error"}})
        return original(request)

    monkeypatch.setattr(stripe, "handle", refund_fails)
    client.delete(answer["manage_path"].replace("/b/", "/api/b/"))
    assert _payment(session).status == "refund_due"  # not lost, not claimed as refunded
    monkeypatch.setattr(stripe, "handle", original)
    assert booking_payments.sweep(session, datetime.now(UTC))["refunds_retried"] == 1
    assert _payment(session).status == "refunded"


def test_if_stripe_is_down_no_table_stays_blocked(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    stripe.down = True
    held = hold(client, place, future_day(), "19:00", 2).json()
    answer = book(client, place, held["hold_id"], 2, accept_policy=True)
    assert answer.status_code == 502
    assert answer.json()["error"]["code"] == "payment_unavailable"
    assert _booking(session).status == "cancelled"
    assert session.scalar(select(func.count()).select_from(TableSlot)) == 0
    # The same table can be booked straight away.
    stripe.down = False
    assert hold(client, place, future_day(), "19:00", 2).status_code == 201


def test_money_that_arrives_after_the_table_was_released_is_refunded(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    _set_policy(session, place)
    payment_id = _book_with_deposit(client, place)["payment"]["payment_id"]
    stripe.expire_fails = True  # Stripe could not close the page: the diner paid just then
    client.post(f"/api/payments/{payment_id}/abandon")
    assert _booking(session).status == "cancelled"
    body = _event()
    client.post("/api/payments/webhooks/stripe", content=body, headers=_signed(body))
    assert _payment(session).status == "refunded"
    assert _booking(session).status == "cancelled"
    assert len(stripe.requests("/v1/refunds")) == 1


def test_real_stripe_refuses_deposits_below_its_minimum(
    client: TestClient, session: Session, organiser: Organiser, stripe: FakeStripe
) -> None:
    place = make_restaurant(session, organiser)
    url = f"/api/owner/restaurants/{place.public_id}/payments"
    rule = {"service_name": "", "cancel_hours": 24, "min_party": 1}
    low = client.put(
        url, json={"policies": [{**rule, "per_person_cents": 49}]}, headers=auth_header(organiser)
    )
    assert low.status_code == 422
    ok = client.put(
        url, json={"policies": [{**rule, "per_person_cents": 50}]}, headers=auth_header(organiser)
    )
    assert ok.status_code == 200 and ok.json()["payments_mode"] == "test"
