"""Payment providers: the demo one (default) and Stripe (only when its keys are set).

The rest of the app talks to a `PaymentProvider` and never knows which one it
has, so connecting Stripe later is a matter of environment variables, not code:

    PAYMENT_PROVIDER=stripe  STRIPE_SECRET_KEY=sk_...  STRIPE_WEBHOOK_SECRET=whsec_...

Stripe is called with httpx over plain HTTPS (no vendor library), with a short
timeout, an `Idempotency-Key` on every write, and a `__repr__` that hides the
key. The diner pays on Stripe's own page (Checkout), so a card number never
reaches SeatPlan and the page's strict Content-Security-Policy stays as it is.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

import httpx

from app.config import APP_VERSION, Settings

STRIPE_URL = "https://api.stripe.com"
# Stripe will not let a Checkout page live shorter than 30 minutes.
STRIPE_MIN_SESSION_S = 30 * 60


class PaymentError(Exception):
    """A provider call failed. The message is safe to store and show: it never holds a key."""


@dataclass(frozen=True)
class CheckoutRequest:
    payment_id: str  # our random id; also what we send to Stripe as client_reference_id
    amount_cents: int
    description: str
    customer_email: str
    success_url: str
    cancel_url: str
    expires_at: datetime
    idempotency_key: str


@dataclass(frozen=True)
class CheckoutStart:
    checkout_id: str
    url: str  # where to send the diner: a path on this site (demo) or Stripe's page


@dataclass(frozen=True)
class CheckoutResult:
    status: Literal["open", "complete", "expired"]
    paid: bool
    payment_ref: str | None = None  # Stripe's payment_intent id, needed to refund
    amount_cents: int = 0
    payment_id: str | None = None  # our id, as we sent it


@dataclass(frozen=True)
class RefundResult:
    refund_id: str
    status: str


class PaymentProvider(Protocol):
    name: str
    mode: str  # "demo", "test" or "live"

    def start_checkout(self, request: CheckoutRequest) -> CheckoutStart: ...

    def read_checkout(self, checkout_id: str) -> CheckoutResult: ...

    def expire_checkout(self, checkout_id: str) -> None: ...

    def refund(self, payment_ref: str, amount_cents: int, idempotency_key: str) -> RefundResult: ...


class DemoProvider:
    """No network, no money. The diner "pays" on a clearly labelled page of ours."""

    name = "demo"
    mode = "demo"

    def start_checkout(self, request: CheckoutRequest) -> CheckoutStart:
        return CheckoutStart(f"demo_cs_{request.payment_id}", f"/pay/demo/{request.payment_id}")

    def read_checkout(self, checkout_id: str) -> CheckoutResult:
        # The demo page tells us the outcome itself (routers/payments.py), so there
        # is nothing to pull: a demo checkout is "open" until that happens.
        return CheckoutResult(status="open", paid=False)

    def expire_checkout(self, checkout_id: str) -> None:
        return None

    def refund(self, payment_ref: str, amount_cents: int, idempotency_key: str) -> RefundResult:
        return RefundResult(f"demo_re_{idempotency_key}", "succeeded")


class StripeProvider:
    name = "stripe"

    def __init__(
        self,
        secret_key: str,
        account_id: str = "",
        api_version: str = "",
        timeout_s: float = 10.0,
        client: httpx.Client | None = None,
    ) -> None:
        if not secret_key:
            raise ValueError("STRIPE_SECRET_KEY is empty")
        self._key = secret_key
        self._account = account_id
        self._version = api_version
        self.mode = "live" if secret_key.startswith(("sk_live_", "rk_live_")) else "test"
        # A timeout matters on serverless: a hanging provider must not use up the
        # whole function run. Tests pass a client with a fake transport.
        self._client = client or httpx.Client(timeout=timeout_s)

    def __repr__(self) -> str:
        return f"StripeProvider(mode={self.mode}, key=***)"

    def _headers(self, idempotency_key: str | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._key}",
            "User-Agent": f"seatplan/{APP_VERSION}",
        }
        if self._account:
            headers["Stripe-Account"] = self._account
        if self._version:
            headers["Stripe-Version"] = self._version
        if idempotency_key:
            # Retrying after a lost answer reuses the key, so Stripe does it once.
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _call(
        self,
        method: str,
        path: str,
        *,
        data: dict[str, str] | None = None,
        params: list[tuple[str, str]] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        try:
            response = self._client.request(
                method,
                f"{STRIPE_URL}{path}",
                data=data,
                params=params,
                headers=self._headers(idempotency_key),
            )
        except httpx.HTTPError as error:
            # Only the error type: some httpx messages repeat request details.
            raise PaymentError(f"Stripe unreachable: {type(error).__name__}") from None
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code >= 300:
            problem = body.get("error", {}) if isinstance(body, dict) else {}
            # Type and code only: never the message, which can echo request details.
            raise PaymentError(
                f"Stripe answered HTTP {response.status_code} "
                f"({problem.get('type', 'error')}/{problem.get('code', 'unknown')})"
            )
        if not isinstance(body, dict):
            raise PaymentError("Stripe answered with something unexpected")
        return body

    def start_checkout(self, request: CheckoutRequest) -> CheckoutStart:
        expires = max(int(request.expires_at.timestamp()), 0)
        data = {
            "mode": "payment",
            "client_reference_id": request.payment_id,
            "customer_email": request.customer_email,
            "success_url": request.success_url,
            "cancel_url": request.cancel_url,
            "expires_at": str(expires),
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": "eur",
            "line_items[0][price_data][unit_amount]": str(request.amount_cents),
            "line_items[0][price_data][product_data][name]": request.description[:120],
            "metadata[payment_id]": request.payment_id,
            "payment_intent_data[metadata][payment_id]": request.payment_id,
        }
        body = self._call(
            "POST", "/v1/checkout/sessions", data=data, idempotency_key=request.idempotency_key
        )
        checkout_id, url = body.get("id"), body.get("url")
        if not isinstance(checkout_id, str) or not isinstance(url, str):
            raise PaymentError("Stripe answered without a checkout page")
        return CheckoutStart(checkout_id, url)

    def read_checkout(self, checkout_id: str) -> CheckoutResult:
        body = self._call(
            "GET",
            f"/v1/checkout/sessions/{checkout_id}",
            params=[("expand[]", "payment_intent")],
        )
        status = body.get("status")
        intent = body.get("payment_intent")
        ref = intent.get("id") if isinstance(intent, dict) else intent
        return CheckoutResult(
            status=status if status in ("open", "complete", "expired") else "open",
            paid=body.get("payment_status") == "paid",
            payment_ref=ref if isinstance(ref, str) else None,
            amount_cents=int(body.get("amount_total") or 0),
            payment_id=body.get("client_reference_id"),
        )

    def expire_checkout(self, checkout_id: str) -> None:
        self._call("POST", f"/v1/checkout/sessions/{checkout_id}/expire")

    def refund(self, payment_ref: str, amount_cents: int, idempotency_key: str) -> RefundResult:
        body = self._call(
            "POST",
            "/v1/refunds",
            data={"payment_intent": payment_ref, "amount": str(amount_cents)},
            idempotency_key=idempotency_key,
        )
        return RefundResult(str(body.get("id", "")), str(body.get("status", "")))


def provider_from_settings(settings: Settings) -> PaymentProvider:
    """PAYMENT_PROVIDER=stripe uses Stripe; anything else is the harmless demo provider."""
    if settings.payment_provider == "stripe":
        return StripeProvider(
            settings.stripe_secret_key, settings.stripe_account_id, settings.stripe_api_version
        )
    return DemoProvider()


def session_expiry(created: datetime) -> datetime:
    """When to let a Checkout page expire: just over Stripe's 30-minute minimum."""
    return created.astimezone(UTC).replace(microsecond=0) + timedelta(
        seconds=STRIPE_MIN_SESSION_S + 60
    )
