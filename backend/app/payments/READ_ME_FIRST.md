# payments: read me first

## Purpose

Deposits for restaurant bookings. A restaurant can ask each guest for a deposit that comes off the bill;
the guest accepts the terms, pays on a payment page, and only then is the booking confirmed. This folder
holds the parts that never touch the database: the money rules, the webhook signature check, and the
payment providers. The database side lives in `restaurant_service/booking_payments.py` and `policies.py`.

Nothing here needs an account to run. **The default provider is a demo one that moves no money**, so the
whole flow works and is tested today. Real payments are switched on with environment variables only.

## Files, in reading order

| File | One job |
|---|---|
| `money.py` | Cents and euros, the free-cancellation deadline, how much is refunded, what a rule may be (pure) |
| `stripe_signature.py` | Checks that a webhook really comes from Stripe: HMAC-SHA256 over `timestamp.body`, a 5-minute window (pure) |
| `providers.py` | `DemoProvider` (no network) and `StripeProvider` (plain HTTPS with `httpx`, no vendor library), and `provider_from_settings` |

## Turning real payments on (when the account exists)

Set these in the Vercel project, then redeploy. Nothing in the code changes.

| Variable | Value |
|---|---|
| `PAYMENT_PROVIDER` | `stripe` (anything else, or unset, is the demo provider) |
| `STRIPE_SECRET_KEY` | `sk_test_...` first; `sk_live_...` only when you are sure |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from the webhook endpoint you create in Stripe |
| `STRIPE_ACCOUNT_ID` | Optional. Empty charges your own Stripe account; `acct_...` charges that connected account |
| `STRIPE_API_VERSION` | Optional. Empty uses the account's own API version |

In Stripe, add a webhook endpoint at `https://<your site>/api/payments/webhooks/stripe` for the events
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and
`checkout.session.async_payment_failed`. The app refuses to start with `PAYMENT_PROVIDER=stripe` and no
keys, and with a live key on a non-https `PUBLIC_BASE_URL`. A live key is also refused any deposit below
what Stripe accepts (50 cents); the demo provider accepts one cent, so the flow can be tried cheaply.

## Likely walkthrough questions

**Why is the booking "pending" while the guest pays?**
A pending booking already owns its tables (`table_slots`), so nobody else can take them meanwhile, and it
is not confirmed: no confirmation email goes out. It lasts 30 minutes (Stripe will not make a payment page
expire sooner). Paying confirms it. Giving up, or letting the time run out, hands the tables back and tells
the waitlist. The cron that sends emails also expires old pending bookings (`routers/emails.py`).

**What stops a guest being charged twice, or a booking confirmed twice?**
Every change of a payment's state is a conditional `UPDATE` ("only if it is still pending"), so exactly one
of two simultaneous attempts wins, the same idea as the `table_slots` primary key. Stripe webhooks are
remembered in `payment_events`, so a retry does nothing. Refunds and Checkout sessions carry an
`Idempotency-Key`.

**Can a forged webhook confirm a booking?**
No. The signature must verify, and even a valid one is only a hint: the app asks Stripe, with its own key,
what happened to that payment, and acts on Stripe's answer.

**What if the guest pays just after the table was given back?**
The money is refunded in full and the booking stays cancelled. If the refund call fails, the payment waits
as `refund_due` and the cron retries it.

**Why can a card number never reach SeatPlan?**
The guest pays on Stripe's own page (hosted Checkout). We only store Stripe's ids and the amount. That
also keeps the site's Content-Security-Policy as strict as it was.

**Who gets the money?**
Not decided yet. With `STRIPE_ACCOUNT_ID` empty it goes to the Stripe account of the keys you set. The
terms say the deposit comes off the guest's bill, so the restaurant is expected to settle it with them.
Splitting it per restaurant (Stripe Connect) is a later step and needs each restaurant to be verified.
