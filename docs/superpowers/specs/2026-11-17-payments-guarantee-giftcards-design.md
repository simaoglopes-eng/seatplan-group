# Payments: card guarantee, deposits, no-show fees and gift cards

Date: 2026-11-17. Status: design only, nothing implemented. Branch it was written on: `codex/restaurantes-ux`.
Mockup: `features/payments-guarantee-giftcards.html` in the session scratchpad (desktop + 390 px phone side by side).

This spec covers the restaurant vertical only. The events vertical does not change: no file under
`frontend/src/pages/{events,editor,join,account}/`, `backend/app/events_service/`, `routers/events.py`,
`attendee.py`, `guest_*.py` or `visitor.py` is edited. `scripts/check_forbidden_paths.py` must stay green.
`frontend/src/pages/room-editor/` (Sergio) is not touched.

---

## 0. What the code does today (checked on 2026-11-17)

| Fact | Where |
|---|---|
| A diner holds tables for 5 minutes, then `POST /r/{vid}/bookings` turns the hold into a `Booking` with status `confirmed`, writes `table_slots` and queues the confirmation in one commit | `restaurant_service/diner_flow.py` `take_table_hold`, `confirm_booking`; `routers/restaurants.py` `book` |
| `Booking.status` is `String(12)`: confirmed, seated, finishing, completed, no_show, cancelled. `ACTIVE_STATUSES = ("confirmed","seated","finishing")` own their `table_slots` | `models.py` line 495, `restaurant_service/occupancy.py` line 18 |
| Staff mark no-shows through `set_status` (no money involved); the dashboard computes a no-show rate | `restaurant_service/staff_floor.py` `set_status`, `CLOSING_STATUSES`; `dashboard.py` `no_show_counts` |
| The diner cancels with `DELETE /b/{token}` -> `manage_flow.cancel_booking` (frees slots, cancellation email, waitlist offer) | `routers/bookings.py`, `restaurant_service/manage_flow.py` |
| Services are `ServicePeriod` rows (name, weekday, times, covers cap). `replace_schedule` deletes and re-inserts them on every save, so their ids are not stable; their **names** ("Lunch", "Dinner") are | `restaurant_service/schedule_edit.py` |
| `schedule.check_bookable(session, venue, day, at)` returns the `ServicePeriod` for a seating time | `restaurant_service/schedule.py` |
| Email: `mail/outbox.enqueue(..., send_after=...)` writes a row; the GitHub Actions cron calls `POST /api/internal/email/process` every 15 min with `X-Cron-Secret` (`routers/emails.py` `_check_cron_secret`) | `mail/outbox.py`, `.github/workflows/email-cron.yml` |
| Provider pattern to copy: `Provider` protocol, `ConsoleProvider` (default), `ResendProvider` over httpx with a timeout, `Idempotency-Key`, a `__repr__` that hides the key, `provider_from_settings` | `mail/providers.py` |
| Every env var is read in `config.py` `load_settings()` | `config.py` |
| Secrets: `new_token()`, `hash_token()` (SHA-256), `keyed_hash()` (HMAC with `SECRET_KEY`), `tokens_match()` (constant time), DB-backed `rate_limit`, `limit_reached`, `client_ip`, `mailbox` | `security.py` |
| Bookings are capped per mailbox (4 upcoming) and per address (10/day) | `restaurant_service/booking_caps.py` |
| Access rules: `load_published` (diners), `load_for_staff` (owner: own venues; demo staff: `is_demo` venues only; else 404) | `restaurant_service/venue_access.py` |
| `record_change` bumps the live scope and writes the audit log | `restaurant_service/changes.py` |
| New columns on existing tables go in `NEW_COLUMNS` (same order as models.py); new tables come from `create_all`; restaurant indexes in `RESTAURANT_INDEXES` | `seed/migrate.py` |
| CSP: `script-src 'self'`, `connect-src 'self' https://tiles.openfreemap.org`, `form-action 'self'`, `frame-ancestors 'none'`; one Python function, 30 s max | `vercel.json` |
| Frontend: one route table `App.tsx`; typed calls in `src/api/*.ts`; restaurant theme `design/restaurant-theme.css` (white/lavender, purple `#4F3F8F`, pink CTA `#B0347A`) | `frontend/src` |

---

## 1. Goal and user stories

**Goal.** Restaurants lose money on no-shows and want a simple, honest way to (a) hold a card or take a deposit
for chosen services, (b) charge a fee when a guest does not come, and (c) sell gift cards. Diners must see the
rule before they confirm, in plain words, and SeatPlan must never see a card number. Everything works end to end
with a **demo payment provider** (no real money, clearly labelled) until Martim sets Stripe keys.

### Diner
- D1. As a diner booking Dinner at Casa Lumen, I see "Card guarantee: €20 per person if you do not come or cancel
  after Fri 20 Nov, 19:30" **before** I press the button, and I tick a box to accept it.
- D2. I add my card on a secure page (Stripe Checkout, or the demo page), and come back to my confirmation.
- D3. For a deposit service, I pay the deposit now and see that it comes off my bill.
- D4. On my manage link I see the policy, the card used (brand and last 4 only) and, before cancelling, exactly
  what will happen to my money.
- D5. I can buy a gift card (an amount, or the "Dinner at the window table" experience) for someone, with a
  message and a delivery date; they get an email with the code.
- D6. I can type a gift card code while booking: it pays the deposit, or it is noted for the restaurant.

### Staff
- S1. On the floor, each booking shows its payment line ("Card held · Visa •• 4242", "Deposit paid €60",
  "Gift card •• 4HPA · €80 left", "Awaiting card until 20:14").
- S2. When I mark a no-show, the dialog offers "Charge €80 now", a smaller amount, or "Do not charge". It is
  only possible from 15 minutes after the booking time, once per booking.
- S3. In a "Gift cards" tab, I find a card by code and take an amount off, or mark an experience as used,
  with undo for 10 minutes.

### Owner
- O1. In "Payments and gift cards" I choose, per service name, None / Card guarantee / Deposit, the amount per
  person, the free-cancellation window, and from which party size it applies.
- O2. I connect my own Stripe account (I am the merchant; money goes to my bank). In demo mode I see a clear
  "Demo mode: no money moves" panel instead.
- O3. I switch gift cards on, choose the validity, preset amounts and define experiences.
- O4. I see what was sold, what is left to redeem, and fees and deposits per day, and can refund.

---

## 2. Non-goals (v1)

- No card fields on SeatPlan pages (no Stripe.js, no Elements, no iframes). Hosted Stripe Checkout only. This
  keeps PCI scope at SAQ A and keeps `vercel.json` CSP unchanged.
- No invoices (faturas). SeatPlan sends payment confirmations marked "This is not an invoice". The restaurant
  issues invoices in its certified invoicing software.
- No platform-wide gift cards (a code works at one restaurant only). Cross-merchant vouchers raise e-money /
  PSD2 limited-network questions.
- No gift cards or payment policies on the 20 Lisbon catalogue restaurants (they are real businesses; selling
  even a demo voucher in their name could mislead). Only invented demo restaurants.
- No partial-party deposits, no tipping, no pre-ordering menus, no paying the bill in the app.
- No currencies other than EUR. Amounts are integer cents everywhere.
- No automatic no-show charging by a timer. A person decides.
- No payment-method choice beyond cards (Apple Pay / Google Pay come for free inside Stripe Checkout when the
  restaurant enables them in Stripe; MB WAY / Multibanco are a later decision because they cannot be used
  off-session for a guarantee).
- No events-vertical changes; no diner account features beyond what exists (listing gift cards in
  `/restaurants/account` is a later step).

---

## 3. Key design choices

1. **Merchant of record = the restaurant** through **Stripe Connect (Express accounts, direct charges)**. SeatPlan
   never holds diners' money, so it does not need a payment-institution licence. Every Stripe call for a
   restaurant carries `Stripe-Account: acct_...`. Optional platform fee via `application_fee_amount`
   (default 0).
2. **Hosted Stripe Checkout** for all three money moments: `mode=setup` (card guarantee, creates a SetupIntent
   with SCA and an off-session mandate), `mode=payment` (deposit and gift card purchase, a PaymentIntent with
   SCA). The no-show fee is a merchant-initiated PaymentIntent (`off_session=true, confirm=true`) on the saved
   card. The browser only navigates (`window.location.assign(url)`); top-level navigation is not restricted by
   CSP, so `vercel.json` does not change.
3. **A booking that needs money is created as `pending`** (7 characters, fits `String(12)`) and owns its tables
   (added to `ACTIVE_STATUSES`) for **30 minutes** (Stripe's minimum Checkout lifetime). It becomes `confirmed`
   only when the card is secured / the deposit paid. The 5-minute hold is consumed exactly as today.
   A pending booking ends by one of three paths, all calling the same idempotent function:
   webhook `checkout.session.expired`, the cron sweep, or an opportunistic sweep at the start of
   `POST /r/{vid}/hold` for that venue and day.
4. **One code path for demo and Stripe.** The demo page and the Stripe webhook both end in
   `booking_payments.apply_checkout(session, payment, CheckoutResult)`. The return page also *pulls* the result
   (`read_checkout`) so we never depend on webhook timing.
5. **Policy per service name**, not per `ServicePeriod` id (ids change on every schedule save). Row with
   `service_name = ""` is the default for every service. The booking stores a **snapshot** of the policy it
   accepted, so later owner edits never change an existing booking.
6. **Gift codes are bearer secrets**: 12 characters from a 31-symbol alphabet (about 59 bits), stored only as
   `keyed_hash()` plus the last 4 characters. Balances move by an **atomic conditional UPDATE**
   (`balance_cents >= :amount`), the same "let the database refuse" principle as `table_slots`.

---

## 4. UX flow per screen, with exact copy

All restaurant pages use `data-surface="restaurants"`: white and lavender, purple structure, one pink main
button. Words, not colour alone, carry every state.

### 4.1 Diner: Time step (`StepTime.tsx`, small addition)
Under the list of times, when the chosen time's service has a policy for this party size, one line:
- Guarantee: **"Dinner needs a card to hold your table. Nothing is charged if you cancel by 24 hours before."**
- Deposit: **"Dinner asks for a €15 deposit per person, taken off your bill."**
Nothing is shown when the policy is None or the party is below `min_party`.

### 4.2 Diner: Details step and side panel (`StepDetails.tsx` + new `PolicyCard.tsx`, `GiftCodeField.tsx`)
Placed between the contact fields and the submit button.

**Card guarantee card**
- Title: **"Card guarantee"**
- Text: **"Casa Lumen asks for a card to hold this table. Nothing is charged today."**
- Row 1: **"Free cancellation until Fri 20 Nov, 19:30"**
- Row 2: **"If you do not come, or cancel later: €20 per person (€80 for 4)"**
- Checkbox (required): **"I accept this policy and authorise Casa Lumen to charge my card up to €80 if I do not
  come or cancel after Fri 20 Nov, 19:30."**
- Error if not ticked: **"Please accept the cancellation policy to continue."**
- Button (pink): **"Continue to add a card"**
- Small print: **"You add your card on Stripe's secure page. SeatPlan never sees your card number."**

**Deposit card**
- Title: **"Deposit"**
- Text: **"€15 per person, paid now: €60 for 4. It is taken off your bill."**
- Row 1: **"Full refund if you cancel by Fri 20 Nov, 19:30"**
- Row 2: **"Cancel later or do not come: Casa Lumen keeps the deposit"**
- Checkbox: **"I accept this cancellation policy."**
- Button: **"Pay €60 deposit"**

**Demo label** (both cards, when `provider_mode = "demo"`): a lavender badge above the title
**"Demo payments · no real card, no real money"**. With Stripe test keys (`sk_test_`):
**"Test payments · use card 4242 4242 4242 4242"**.

**Gift card field** (a `<details>` like "Add a phone number..."):
- Summary: **"Have a gift card for Casa Lumen?"**
- Field: label **"Gift card code"**, hint **"12 letters and numbers, for example 7KQ2-M9XD-4HPA"**, button **"Apply"**
- With a deposit: **"Gift card applied: €80 left. It pays the €60 deposit, so no card is needed."**
  (if smaller: **"Gift card applied: it pays €40. You pay the other €20 by card."**)
- With a guarantee: **"Gift card added. You still add a card for the guarantee. Show the code at the
  restaurant: €80 left, valid until 17 Nov 2028."**
- With no policy: **"Gift card added. Show it at the restaurant: €80 left, valid until 17 Nov 2028."**
- Experience card: **"Dinner at the window table for 2 is added. We will ask for a window table."**
- Unknown, other restaurant, or void (one message, so nothing leaks): **"We do not recognise this code. Check it,
  or show it at the restaurant."**
- Expired: **"This gift card expired on 17 Nov 2026."**
- Used up: **"This gift card has no balance left."**
- Too many tries: **"Too many attempts. Please wait a moment, or show the code at the restaurant."**

Hold countdown keeps running; after "Continue to add a card" the hold becomes a 30-minute pending booking, so
the countdown is replaced by **"Your table is kept for 30 minutes while you add your card."**

### 4.3 Diner: Demo checkout page (`/pay/demo/:paymentId`, new `pages/pay/DemoCheckoutPage.tsx`)
Only reachable when the backend provider is `demo`; otherwise **"This page is only used in the demo."**
- Full-width banner: **"Demo payment · No real card, no real money moves."**
- Heading: **"Add a card for Casa Lumen"** (deposit: **"Pay the deposit for Casa Lumen"**)
- Summary: **"Fri 20 Nov · 19:30 · 4 people · Table 12"**, **"Card guarantee: up to €80 if you do not come"**
- Radio group **"How should this demo card behave?"**
  - **"Card works"** (default)
  - **"Bank asks the guest to confirm later charges"**
  - **"Card is declined when the fee is charged"**
  - **"Card is declined now"**
- Main button: **"Save demo card"** (deposit: **"Pay €60 (demo)"**). Secondary: **"Cancel and go back"**.

### 4.4 Diner: Return page (`/pay/return/:paymentId`, new `pages/pay/PaymentReturnPage.tsx`)
- Loading: **"Checking with your bank…"** (polls `GET /api/payments/{id}` every 2 s, at most 30 s)
- Secured: shows the normal `Confirmation` (manage token from `sessionStorage`) with a new line.
  Opened on another device (no token): **"Your table is booked. The confirmation is in your inbox."**
- Declined / cancelled: **"Your card was not added. Your table is still kept until 20:14."** Buttons
  **"Try again"** (pink) and **"Cancel this booking"**.
- Expired: **"We could not keep your table: the card step was not finished within 30 minutes."** Button
  **"Book again"**.

### 4.5 Diner: Confirmation and manage page (`Confirmation.tsx`, `BookingSummary.tsx`, `ManageBookingPage.tsx`)
New summary row:
- Guarantee: **"Card guarantee · Visa •• 4242 · No charge unless you do not come or cancel after Fri 20 Nov, 19:30."**
- Deposit: **"Deposit paid · €60 · taken off your bill."**
- Gift card: **"Gift card •• 4HPA · €80 left"**
- After a fee: **"No-show fee charged · €80 on Visa •• 4242 on 20 Nov."**
- Refunded: **"Deposit refunded · €60 · it can take 5 to 10 days to reach your card."**
- Pending (manage link opened early): **"Waiting for your card. Your table is kept until 20:14."** + **"Add card"**.

Cancel dialog text (computed by the server, shown before the diner confirms):
- Before the deadline, deposit: **"Your €60 deposit will be refunded to your card."**
- Before the deadline, guarantee: **"Nothing will be charged."**
- After the deadline, deposit: **"It is less than 24 hours before your booking. Casa Lumen keeps your €60 deposit."**
- After the deadline, guarantee: **"It is less than 24 hours before your booking. Casa Lumen may charge up to €80
  to your card."**
Party size changes on a deposit booking: **"To change the number of people on a booking with a deposit, please
call Casa Lumen."** Date/time changes are allowed while still before the deadline; the deadline then moves with
the booking (the policy snapshot is kept).

### 4.6 Diner: Gift card purchase (`/restaurants/:slug/gift-card`, new `pages/gift/GiftCardPage.tsx`)
Reached from a secondary button on the public page: **"Give a gift card"** (only when the owner enabled it).
- Heading: **"Give Casa Lumen"**; lead: **"A gift card for food and drink at Casa Lumen, sent by email."**
- Step 1 **"Choose a gift"**: amount chips **"€25" "€50" "€100" "Other amount"** (field: **"Amount in euros"**,
  hint **"From €10 to €500"**). Experiences as cards: **"Dinner at the window table"** ·
  **"A three-course dinner for 2 at one of our window tables, with a glass of wine each."** · **"€120 · for 2"**.
- Step 2 **"Who is it for?"**: **"Recipient's name"**, **"Recipient's email"**, **"Message (optional)"** (counter,
  300), **"Send on"** (date, today to +90 days, hint **"We email the gift card that morning at 9:00."**).
  Checkbox **"Send it to me instead, I will give it myself"** (hides recipient email).
- Step 3 **"Your details"**: **"Your name"**, **"Your email"** (hint **"We send your receipt here."**).
- Summary box: **"€50 gift card for Ana · sent Tue 24 Nov · valid until 24 Nov 2028"**.
- Terms checkbox: **"I accept the gift card terms: valid for 24 months, for food and drink at Casa Lumen,
  refundable within 14 days if unused."** (link **"Read the terms"** opens a dialog with the full text).
- Button (pink): **"Pay €50"**; demo badge as in 4.2.
- Return page `/gift/return/:purchaseId`: **"Gift card on its way. We will email Ana on Tue 24 Nov 2026. Your
  receipt is in your inbox."** Failure: **"The payment did not go through. Nothing was charged."** + **"Try again"**.

Recipient email (subject **"Ana, you have a gift card for Casa Lumen"**): who it is from, the message, the
amount or experience, the code in large monospace (**"7KQ2-M9XD-4HPA"**), **"Valid until 24 Nov 2028"**,
**"Book a table"** link to the public page, **"Or show this code when you pay."**, and the footer
**"You get this email because Maria bought you a gift card. We do not use your address for anything else."**
Buyer receipt (subject **"Your gift card for Casa Lumen"**): amount, recipient name, send date, last 4 of the
code only, **"This is a payment confirmation, not an invoice. Casa Lumen issues the invoice when the card is used."**

### 4.7 Staff: floor booking panel (`BookingActions.tsx`, `FloorLists.tsx`)
Payment line under the booking name (badge + words):
- **"Card held · Visa •• 4242 · fee up to €80"**
- **"Deposit paid · €60 · take it off the bill"**
- **"Gift card •• 4HPA · €80 left"** / **"Gift: Dinner at the window table"**
- **"Awaiting card · until 20:14"** (pending; action **"Confirm without card"** for the owner)
- **"Fee charged · €80"**, **"Fee waived"**, **"Fee needs guest confirmation"**

### 4.8 Staff: no-show dialog (new `NoShowDialog.tsx`, opened from "More actions" → "No-show")
- Title: **"Mark Rui Matos as a no-show?"**
- Text: **"Booked for 19:30, 4 people, Table 12. The policy allows a fee of up to €80 (€20 per person)."**
- Radio: **"Charge €80 now"** (default) · **"Charge a smaller amount"** (field **"Amount in euros"**) ·
  **"Do not charge"**
- Before the grace time, the charge options are disabled with: **"You can charge the fee from 19:45, 15 minutes
  after the booking time."**
- Buttons: **"Mark no-show"** (pink) · **"Keep the booking"**
- Toasts: success **"Rui Matos is marked as a no-show. €80 was charged to Visa •• 4242."**; declined
  **"The bank declined the charge. Rui Matos is still marked as a no-show. You can try again from the booking."**;
  needs action **"The bank asked the guest to confirm. We emailed Rui Matos a link to pay €80."**; demo
  **"(Demo: no real money moved.)"** appended.
- Deposit bookings: no charge choice; text **"Casa Lumen keeps the €60 deposit."**
- Late cancellation (diner cancelled after the deadline, guarantee): the closed booking shows
  **"Late cancellation · fee up to €80"** with **"Charge fee"** / **"Waive fee"**, same dialog.

### 4.9 Staff: Gift cards tab (new `StaffGiftCards.tsx`, fifth tab in `StaffPage.tsx`)
- Heading **"Gift cards"**; field **"Gift card code"**, button **"Find"**.
- Found (amount): **"€80 left of €100 · valid until 17 Nov 2028 · for Ana"**; field **"Amount to take off"**;
  optional **"Booking"** select (today's bookings); button **"Take off €45"**; toast **"€45 taken off. €35 left."**
  with **"Undo"** (10 minutes).
- Found (experience): **"Dinner at the window table for 2 · not used yet"**, button **"Mark as used"**.
- Not found: **"No gift card with this code at Casa Lumen."** Expired: **"Expired on 17 Nov 2026. Talk to the
  owner if you want to accept it anyway."**
- Today list: **"Used today: 3 cards · €185"**.

### 4.10 Owner: Payments and gift cards (`/owner/:venueId/payments`, new `pages/owner/PaymentsPage.tsx`)
New item in the `OwnerShell` menu: **"Payments and gift cards"** (not part of the publish checklist).
- Section **"Payment account"**
  - Demo: **"Demo mode. Diners see a demo payment page and no money moves. Real payments need a Stripe account,
    set up by SeatPlan."**
  - Not connected: **"Connect your Stripe account to take card guarantees, deposits and gift card payments.
    Money goes straight to your bank account. Stripe charges its fees to you."** Button **"Connect with Stripe"**.
  - In progress: **"Stripe needs a few more details."** Button **"Continue on Stripe"**.
  - Ready: **"Stripe account ready. Payments and payouts are on."** Link **"Open your Stripe dashboard"**.
- Section **"Booking policy"**, one row per service name from the schedule plus **"All other services"**:
  columns **"Service"**, **"Policy"** (None / Card guarantee / Deposit), **"Per person"** (€), **"Free cancellation
  until"** (2, 6, 12, 24, 48, 72 hours before), **"From party size"** (1 to 20). Under each row the sentence
  diners will read, e.g. **"Diners read: Card guarantee. €20 per person if they do not come or cancel less than
  24 hours before. Parties of 1 or more."** Button **"Save policies"**. Errors: **"Enter an amount from €5 to
  €150."** (guarantee), **"Enter an amount from €5 to €100."** (deposit), **"Connect a payment account first."**
- Notice: **"SeatPlan does not issue invoices. Issue invoices for deposits, fees and gift card use in your
  certified invoicing software."**
- Section **"Gift cards"**: switch **"Sell gift cards on your public page"**; **"Valid for"** (12, 24, 36 months;
  default 24); **"Amounts to offer"** (three amounts) and **"Let buyers choose an amount"**; list **"Experiences"**
  with **"Add an experience"** (**"Title"**, **"Description"**, **"Price"**, **"For how many people"**, **"Seat them
  at"**: Any table / Window / Terrace / Quiet). Summary: **"12 sold · €1,140 sold · €420 still to use"**, link
  **"See all gift cards"** (table with masked emails, status, balance, **"Refund"** within 14 days if unused).

---

## 5. Data model

### 5.1 New tables (created by `create_all`, so no `NEW_COLUMNS` entries)

`venue_payment_settings` (one row per restaurant)
| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| venue_id | FK venues, UNIQUE | |
| provider | String(10) | `demo` or `stripe` |
| account_id | String(64) null | Stripe `acct_...` |
| account_status | String(12) | `none`, `pending`, `ready`, `restricted` |
| gift_cards_enabled | bool default false | |
| gift_validity_months | int default 24 | 12, 24, 36 |
| gift_presets_cents | JSON default `[2500,5000,10000]` | |
| gift_custom_amounts | bool default true | |
| gift_min_cents / gift_max_cents | int default 1000 / 50000 | |
| updated_at | UtcDateTime | |

`booking_policies`
| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| venue_id | FK venues, index | |
| service_name | String(40) | `""` = every other service. UNIQUE(venue_id, service_name) |
| mode | String(10) | `none`, `guarantee`, `deposit` |
| amount_cents | int | per person; CHECK 0..15000 |
| cancel_hours | int | one of 2, 6, 12, 24, 48, 72 |
| min_party | int default 1 | 1..20 |
| updated_at | UtcDateTime | |

`booking_payments` (one per booking that needed money; the accepted snapshot)
| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| public_id | String(32) UNIQUE | used in `/pay/...` URLs; random, carries no data |
| booking_id | FK bookings, UNIQUE | |
| venue_id | FK venues, index | |
| provider | String(10) | `demo` / `stripe` |
| kind | String(10) | `guarantee` / `deposit` |
| status | String(14) | `pending`, `secured`, `paid`, `declined`, `expired`, `refunded`, `kept`, `fee_charged`, `fee_failed`, `fee_action`, `fee_waived` |
| per_person_cents | int | snapshot |
| party_at_booking | int | snapshot |
| cancel_hours | int | snapshot |
| policy_text | String(400) | the exact sentence the diner accepted |
| accepted_at | UtcDateTime | |
| expires_at | UtcDateTime | end of the 30-minute pending window |
| checkout_id | String(255) null | `cs_...` or demo id |
| customer_id / payment_method_id | String(64) null | Stripe ids only |
| card_brand / card_last4 / card_exp | String(20) / String(4) / String(7) null | display only, never the number |
| gift_card_id | FK gift_cards null | when a gift card paid (part of) the deposit |
| gift_cents | int default 0 | |
| created_at / updated_at | UtcDateTime | |

`payment_transactions` (the money ledger; no names or emails)
| Column | Type | Notes |
|---|---|---|
| id | int PK | |
| venue_id | FK venues, index | |
| booking_payment_id | FK null | |
| gift_card_id | FK null | |
| kind | String(16) | `deposit`, `no_show_fee`, `late_cancel_fee`, `refund`, `gift_sale`, `gift_refund` |
| amount_cents | int | positive = money in to the restaurant, negative = out |
| status | String(12) | `succeeded`, `pending`, `failed`, `needs_action` |
| provider_ref | String(64) null | `pi_...`, `re_...` |
| idempotency_key | String(100) UNIQUE | e.g. `fee-<booking public id>`: a second fee row is refused by the database |
| actor | String(120) | staff email, `diner`, `system` |
| at | UtcDateTime | |

`payment_events` (webhook de-duplication; no payload stored)
| id | provider String(10) | event_id String(255) | type String(60) | received_at | UNIQUE(provider, event_id) |

`gift_experiences`
| id | public_id | venue_id FK index | title String(80) | description String(300) | price_cents | party_size 1..12 | zone_kind String(20) null (`window`,`terrace`,`quiet`) | is_active bool | position int |

`gift_cards`
| Column | Type | Notes |
|---|---|---|
| id, public_id | | |
| venue_id | FK index | |
| kind | String(10) | `amount` / `experience` |
| experience_id | FK null | |
| experience_title | String(80) null | snapshot |
| experience_party | int null | snapshot |
| code_hash | String(64) UNIQUE null | `keyed_hash(normalised code)`; null until paid |
| code_last4 | String(4) null | |
| initial_cents / balance_cents | int | CHECK balance_cents >= 0 |
| status | String(10) | `pending`, `active`, `used`, `expired`, `refunded`, `void`, `failed` |
| buyer_name / buyer_email | String(120) / String(254) | |
| recipient_name / recipient_email | String(120) / String(254) | |
| message | String(300) | blanked 30 days after delivery |
| deliver_on | Date | |
| checkout_id | String(255) null | |
| issued_at / expires_at | UtcDateTime null | |
| created_at | UtcDateTime | |

`gift_card_entries` (balance history)
| id | gift_card_id FK index | kind String(16) (`issue`,`redeem`,`deposit`,`deposit_back`,`undo`,`refund`,`expire`,`void`) | amount_cents (signed) | booking_id FK null | actor String(120) | at | note String(120) |

### 5.2 Changes to existing tables (`seed/migrate.py`)
Append to `models.py` `Booking` (last) and in the same order to `NEW_COLUMNS`:
```python
("bookings", "gift_card_id", "INTEGER REFERENCES gift_cards (id)"),
```
Append to `RESTAURANT_INDEXES`:
```python
("ix_bookings_gift_card_id", "CREATE INDEX IF NOT EXISTS ix_bookings_gift_card_id ON bookings (gift_card_id)"),
("ix_booking_payments_status_expires", "CREATE INDEX IF NOT EXISTS ix_booking_payments_status_expires ON booking_payments (status, expires_at)"),
```
(`create_all` runs before `upgrade_schema`, so `gift_cards` exists when the FK column is added.) A new frozen
fixture `tests/fixtures/schema_2026_11_17.{sqlite,postgres}.sql` proves the upgrade from today's schema.

Status values: `Booking.status` gains `pending` (fits `String(12)`). `occupancy.ACTIVE_STATUSES` becomes
`("pending", "confirmed", "seated", "finishing")`; `staff_floor.FLOOR_STATUS` maps `pending` to `reserved`;
`dashboard.EXPECTED_STATUSES` is unchanged (pending is not counted as expected); `booking_caps` counts pending
automatically (it uses `ACTIVE_STATUSES`).

---

## 6. API endpoints

All bodies use `extra="forbid"`; errors are `{"error": {"code","message"}}`. Money is integer cents.

### 6.1 Diner (public, rate limited per `client_ip`)
| Method, path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/r/{vid}` (existing, additive) | none | | adds `"policies": [{service_name, mode, per_person_cents, cancel_hours, min_party}]`, `"payments_mode": "demo"\|"test"\|"live"\|null`, `"gift_cards": bool` |
| `GET /api/r/{vid}/policy?date&time&party` (new) | none, READ_LIMIT | | `{mode, per_person_cents, total_cents, cancel_hours, cancel_deadline: "2026-11-20T19:30", text, accept_text, payments_mode}` (`mode:"none"` when nothing applies) |
| `POST /api/r/{vid}/bookings` (existing, additive) | none, BOOK_LIMIT + caps | adds `accept_policy: bool = false`, `gift_code: str \| null (max 20)` | adds `"payment": {"required": bool, "payment_id", "next_url", "expires_at"}`; booking `status` is `pending` when required. 422 `policy_not_accepted` when a policy applies and `accept_policy` is false. 409 `policy_changed` if the policy differs from what `GET .../policy` returned less than the hold (client re-reads) |
| `POST /api/r/{vid}/gift-cards/check` (new) | none; 10/min and 30 failures/day per address; 200 failures/hour per venue | `{code}` | `{kind, balance_cents, experience_title, experience_party, expires_on}` or 404 `not_found` (one message for unknown / other venue / void), 410 `expired`, 409 `used_up` |
| `GET /api/payments/{payment_id}` (new) | none (random id), 60/min | | `{status, kind, booking_status, amount_cents, expires_at, venue_name}`; while `pending` and provider is Stripe, pulls the Checkout Session once per 5 s per payment and applies it |
| `POST /api/payments/{payment_id}/retry` (new) | none, 10/min | | `{next_url, expires_at}`; 409 when not pending or expired |
| `POST /api/payments/{payment_id}/abandon` (new) | none, 10/min | | `{booking_status: "cancelled"}`: frees the tables at once |
| `POST /api/payments/demo/{payment_id}` (new) | none; **404 unless provider is demo** | `{outcome: "ok"\|"sca_later"\|"decline_later"\|"decline_now"}` | same as GET status |
| `GET /api/b/{token}` (existing, additive) | manage link | | adds `"payment": {kind, status, card: "Visa •• 4242", per_person_cents, deposit_cents, fee_cap_cents, cancel_deadline, gift: {...}}` and `"cancel_outcome": "free"\|"refund"\|"keep"\|"fee_may_apply"\|"none"`, `"can_change_party": bool` |
| `DELETE /api/b/{token}` (existing, additive) | manage link | | adds `"payment_outcome"` (same values); refund is attempted synchronously; on provider error it is recorded `pending` and the sweep retries |
| `PATCH /api/b/{token}` (existing) | manage link | | 409 `deposit_party_change` when `party_size` changes on a deposit booking |
| `GET /api/gift/{slug}` (new) | none, READ_LIMIT | | `{venue_name, presets_cents, custom: bool, min_cents, max_cents, validity_months, experiences: [{id, title, description, price_cents, party_size}], payments_mode, terms_text}`; 404 when disabled or unpublished |
| `POST /api/gift/{slug}/purchase` (new) | none; 5/hour per address; 3 pending per buyer mailbox; €2,000/day per venue unless owner raises | `{kind, amount_cents?, experience_id?, recipient_name, recipient_email?, send_to_me: bool, message, deliver_on, buyer_name, buyer_email, accept_terms: true}` | `{purchase_id, next_url, expires_at}` |
| `GET /api/gift/purchases/{purchase_id}` (new) | none, 60/min | | `{status, deliver_on, recipient_first_name}` (pulls Stripe once if pending) |
| `POST /api/gift/purchases/demo/{purchase_id}` (new) | 404 unless demo | `{outcome: "ok"\|"decline_now"}` | status |

### 6.2 Webhook and cron
| Method, path | Auth | Notes |
|---|---|---|
| `POST /api/payments/webhooks/stripe` | `Stripe-Signature` checked against `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` (either may match); body ≤ 64 KB; 300 s tolerance | Handles `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `account.updated`. Inserts `payment_events` first (duplicate = 200, nothing done). **Re-fetches the object from Stripe** (never trusts the payload's amounts/status). Unknown types: 200. Bad signature: 400 `bad_signature`, nothing written |
| `POST /api/internal/payments/sweep` | `X-Cron-Secret` (reuse `_check_cron_secret` logic via a small shared helper or a copy), 30/min per address | Expires pending bookings and purchases, retries pending refunds, expires gift cards, detaches cards, retention scrubs (section 8). Returns counts |

### 6.3 Staff (`CurrentUser` + `load_for_staff`; 404 for other venues)
| Method, path | Request | Response |
|---|---|---|
| `GET /api/staff/{vid}/floor` (existing, additive) | | each booking adds `"payment": {label, tone, kind, status, fee_cap_cents, can_charge_from, gift}` |
| `POST /api/staff/{vid}/bookings/{bid}/no-show` (new; marks no-show and optionally charges in one request) | `{charge: "full"\|"amount"\|"none", amount_cents?}` | `{status, charged_cents, outcome: "charged"\|"declined"\|"needs_action"\|"waived"\|"kept_deposit", message}`. 409 `too_early` before start + 15 min; 409 `already_charged`; 422 when amount > cap |
| `POST /api/staff/{vid}/bookings/{bid}/fee` (new; for late cancellations and retries) | `{action: "charge"\|"waive", amount_cents?}` | same |
| `POST /api/staff/{vid}/bookings/{bid}/confirm-without-card` (new; owner only, `role != staff`) | | booking `confirmed`, payment `waived`; confirmation email sent |
| `GET /api/staff/{vid}/gift-cards/lookup?code=` (new; 30/min per user) | | `{public_id, kind, status, balance_cents, initial_cents, experience_title, expires_on, recipient_first_name}` |
| `POST /api/staff/{vid}/gift-cards/{gid}/redeem` (new) | `{amount_cents, booking_id?: str, note?: str}` | `{balance_cents, entry_id, undo_until}`; 409 `insufficient_balance` |
| `POST /api/staff/{vid}/gift-cards/{gid}/undo/{entry_id}` (new) | | `{balance_cents}`; only within 10 min and by the same user |
| `GET /api/staff/{vid}/payments?date=` (new) | | day totals: deposits, fees, refunds, gift sales, gift redemptions; list of transactions (no emails) |

### 6.4 Owner (`CurrentOrganiser`, owner of the venue, same 404 rule as `profiles.py`)
| Method, path | Request | Response |
|---|---|---|
| `GET /api/owner/restaurants/{vid}/payments` | | `{payments_mode, account: {status, dashboard_url?}, services: ["Lunch","Dinner"], policies: [...], gift: {...settings}, experiences: [...], gift_summary: {sold, sold_cents, open_cents}}` |
| `PUT /api/owner/restaurants/{vid}/policies` | `{policies: [{service_name, mode, per_person_cents, cancel_hours, min_party}] (max 20)}` | replaced set; 422 `payments_not_ready` when any mode ≠ none and the account is not ready (demo: allowed only when `DEMO_MODE=1` or `venue.is_demo`) |
| `POST /api/owner/restaurants/{vid}/payments/connect` | | `{url}`: Stripe Account Link (`type=account_onboarding`); demo: marks ready and returns `/owner/{vid}/payments?connected=demo` |
| `POST /api/owner/restaurants/{vid}/payments/refresh` | | re-reads `GET /v1/accounts/{id}` and updates status |
| `PUT /api/owner/restaurants/{vid}/gift-settings` | `{enabled, validity_months, presets_cents[3], custom, min_cents, max_cents}` | settings |
| `PUT /api/owner/restaurants/{vid}/gift-experiences` | `{experiences: [{id?, title, description, price_cents, party_size, zone_kind, is_active}] (max 10)}` | list; an experience with sold cards is deactivated, never deleted |
| `GET /api/owner/restaurants/{vid}/gift-cards?status=&offset=` | | page of 50: `{public_id, kind, status, initial_cents, balance_cents, buyer: mask_email, recipient: mask_email, issued_at, expires_at, refundable}` |
| `POST /api/owner/restaurants/{vid}/gift-cards/{gid}/refund` | | refund when unused and ≤ 14 days since purchase (owner may override up to full unused balance with `{"reason"}`) |
| `POST /api/owner/restaurants/{vid}/gift-cards/{gid}/void` | `{reason}` | void (lost code re-issue: void + new card, same balance) |
| `POST /api/owner/restaurants/{vid}/bookings/{bid}/refund` | `{amount_cents, reason}` | refund deposit or fee, ≤ net paid |

---

## 7. Backend modules and pure functions

### 7.1 New package `backend/app/payments/` (pure or provider-only; no database)
- `READ_ME_FIRST.md` (purpose, provider rules, SCA/PCI notes, the three walkthrough questions).
- `money.py` (pure, tests first):
  `format_eur(cents) -> str` ("€20", "€12.50"); `deposit_total(per_person, party) -> int`;
  `fee_cap(per_person, party_at_booking, party_now) -> int` (min of the two parties);
  `cancel_deadline(start_at_utc, hours) -> datetime`;
  `cancel_outcome(kind, now, deadline, status) -> Literal["free","refund","keep","fee_may_apply","none"]`;
  `can_charge_from(start_at, grace_min=15) -> datetime`; `check_policy_bounds(mode, cents, hours, min_party)`;
  `policy_sentence(venue_name, mode, per_person, party, deadline_local) -> (text, accept_text)`.
- `giftcodes.py` (pure, tests first): `ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"`,
  `new_code(rng=secrets) -> str` ("7KQ2-M9XD-4HPA"), `normalise(raw) -> str | None` (upper, strip spaces and
  hyphens, exactly 12 symbols of the alphabet), `last4(code)`, `code_hash(code)` (calls `security.keyed_hash`).
- `stripe_signature.py` (pure, tests first): `verify(header: str, payload: bytes, secrets: list[str], now: int,
  tolerance=300) -> bool` — parses `t=` and every `v1=`, HMAC-SHA256 of `f"{t}.".encode() + payload`,
  `hmac.compare_digest`, rejects old or future timestamps.
- `providers.py`: dataclasses `CheckoutRequest(mode, account, amount_cents?, currency, customer_email,
  description, metadata, success_url, cancel_url, expires_at, idempotency_key)`, `CheckoutStart(id, url,
  expires_at)`, `CheckoutResult(status, payment_status, customer_id, payment_method_id, intent_id, card_brand,
  card_last4, card_exp, amount_cents)`, `ChargeResult(status: succeeded|needs_action|declined, intent_id,
  decline_code)`, `RefundResult`, `AccountStatus`; `PaymentProvider` Protocol (`name`, `mode`
  ("demo"/"test"/"live"), `start_checkout`, `read_checkout`, `charge_saved_card`, `refund`, `detach_card`,
  `onboarding_link`, `read_account`); `DemoProvider` (no network, deterministic ids `demo_cs_<payment id>`,
  card "Demo •• 0000", behaviour from the demo outcome stored as `payment_method_id` `demo_ok` / `demo_sca` /
  `demo_decline`); `StripeProvider` over httpx (`https://api.stripe.com/v1/...`, form-encoded, `Authorization:
  Bearer`, pinned `Stripe-Version` constant, `Stripe-Account` header, `Idempotency-Key` on every POST, 10 s
  timeout, `__repr__` hides the key, errors carry only type/code, never the key or card data);
  `provider_from_settings(settings)`.
  Stripe calls used: `POST /v1/customers`; `POST /v1/checkout/sessions` (`mode=setup` with `customer`,
  `currency=eur`, `payment_method_types[]=card`; `mode=payment` with `line_items`, `payment_intent_data
  [application_fee_amount]`, `customer_creation=if_required`); `GET /v1/checkout/sessions/{id}?expand[]=
  setup_intent.payment_method&expand[]=payment_intent.payment_method`; `POST /v1/payment_intents`
  (`off_session=true`, `confirm=true`, `customer`, `payment_method`); `POST /v1/refunds`;
  `POST /v1/payment_methods/{id}/detach`; `POST /v1/accounts` (`type=express`, `country=PT`,
  `capabilities[card_payments][requested]=true`, `capabilities[transfers][requested]=true`);
  `POST /v1/account_links`; `GET /v1/accounts/{id}`; `POST /v1/accounts/{id}/login_links`.
  A 402 with `code=authentication_required` maps to `needs_action`; other card errors to `declined`.

### 7.2 New service modules in `backend/app/restaurant_service/`
- `policies.py`: `policy_for(session, venue, period_name, party) -> Policy | None` (exact name, else `""`,
  then `min_party`), `read_policies`, `replace_policies` (validates via `money.check_policy_bounds`; refuses
  when the account is not ready), `policies_payload` (for `GET /r/{vid}`).
- `payment_settings.py`: `settings_for(session, venue)` (creates a default row lazily on write only),
  `payments_ready(settings_row, app_settings, venue) -> bool`, `connect_link`, `refresh_account`.
- `booking_payments.py`:
  `start(session, venue, booking, policy, gift, provider) -> BookingPayment | None` (called by
  `diner_flow.confirm_booking` when a policy applies: sets booking `pending`, inserts the snapshot, applies the
  gift card first, starts Checkout only for what is left);
  `apply_checkout(session, payment, result)` (idempotent; `pending -> secured/paid`, booking `pending ->
  confirmed`, then `emails.queue_confirmation` with the payment line; `declined` keeps pending);
  `expire_pending(session, now, venue=None, day=None)` (release slots via `booking_rows.release_slots`, booking
  `cancelled`, payment `expired`, `waitlist.offer_freed_tables`, `record_change` action `booking.payment_expired`,
  short email "We did not keep your table" — see decision 9);
  `cancel_outcome_for(venue, booking, payment, now)`; `on_cancel(session, venue, booking, by_diner, now)`
  (refund or keep or mark fee-possible; called from `manage_flow.cancel_booking`);
  `charge_fee(session, venue, booking, amount, actor, provider)` (status checks, grace, cap, inserts the ledger
  row with `idempotency_key=f"fee-{booking.public_id}"` **before** calling the provider, so two staff
  clicking at once cannot both charge; updates the row with the result; `needs_action` queues an email with a
  Checkout link in `mode=payment`);
  `waive_fee`, `refund(session, venue, payment, amount, actor)`, `payment_summary(payment)` (floor/manage
  payload), `retention_pass(session, now)`.
- `gift_cards.py`: `offer(session, venue)`, `start_purchase(...)`, `apply_purchase(session, card, result)`
  (issues the code: `giftcodes.new_code`, stores hash and last 4, queues the recipient email with
  `send_after = deliver_on 09:00 Europe/Lisbon` and the buyer receipt; the raw code exists only in the
  recipient email), `check(session, venue, raw_code)`, `redeem(session, venue, card, amount, actor, booking)`
  (`UPDATE gift_cards SET balance_cents = balance_cents - :a WHERE id = :id AND balance_cents >= :a AND status =
  'active'`, rowcount 0 -> 409), `undo(...)`, `apply_to_deposit(...)`, `return_from_deposit(...)`,
  `expire_due(session, now)`, `refund(...)`, `void(...)`, `scrub_messages(session, now)`.
- `payment_events.py`: `handle_stripe_event(session, provider, event_id, type, object_id, account)` dispatch
  table; inserts `payment_events` with `insert_ignoring_duplicates` (from `db.py`) first.
- `payment_emails.py`: queues every payment email through `mail/outbox.enqueue` with idempotency keys
  `booking-fee-<pid>`, `booking-refund-<pid>`, `booking-fee-action-<pid>`, `booking-payment-expired-<pid>`,
  `gift-recipient-<gid>`, `gift-receipt-<gid>`.

### 7.3 New mail templates `backend/app/mail/payment_templates.py`
Pure `EmailParts` builders: `gift_card_email`, `gift_receipt_email`, `fee_charged_email`,
`fee_needs_action_email`, `deposit_refunded_email`, `payment_expired_email`. Every one ends with "This is a
payment confirmation, not an invoice." where money moved. `restaurant_templates.booking_email` gains an optional
`payment_line` in `RestaurantBooking` (default `None`, so current emails are byte-identical).

### 7.4 Changes to existing restaurant modules
- `diner_flow.confirm_booking`: after `write_slots`, call `booking_payments.start`; if it returns a pending
  payment, skip `emails.queue_confirmation` (sent later by `apply_checkout`). `take_table_hold`: first call
  `booking_payments.expire_pending(session, now, venue, day)`.
- `manage_flow.cancel_booking` -> `booking_payments.on_cancel`; `change_booking` -> refuse party change on
  deposit bookings; `check_changeable` unchanged (pending is not changeable).
- `staff_floor`: `FLOOR_STATUS["pending"] = "reserved"`; booking payload adds `payment_summary`.
- `occupancy.ACTIVE_STATUSES` adds `pending`.
- `discovery.restaurant_page` adds `gift_cards: bool`.
- `mail/outbox._forget_links`: also replace gift codes matching `\b[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-
  [2-9A-HJKMNP-Z]{4}\b` with `[code removed]` once a row is finished (shared module; events emails contain no
  such pattern; a test proves event emails are unchanged).

### 7.5 New routers
- `routers/payments.py`: status, retry, abandon, demo completion, Stripe webhook, internal sweep.
- `routers/gifts.py`: `/gift/{slug}`, purchase, purchase status, demo purchase, `/r/{vid}/gift-cards/check`.
- `routers/staff_payments.py`: no-show, fee, confirm-without-card, gift lookup/redeem/undo, day payments.
- `routers/owner_payments.py`: everything in 6.4.
Registered in `main.py` next to the restaurant routers. `routers/restaurants.py` and `routers/bookings.py` get
only the additive fields above.

### 7.6 Config (`config.py`)
`payment_provider` (`PAYMENT_PROVIDER`, default `demo`), `stripe_secret_key`, `stripe_webhook_secret`,
`stripe_connect_webhook_secret`, `stripe_application_fee_bps` (default 0). `load_settings` refuses to start
when `PAYMENT_PROVIDER=stripe` without a key and webhook secret, or with an `sk_live_` key and a
`PUBLIC_BASE_URL` that is not `https://`. Settings `__repr__` must not print the keys (it is a frozen dataclass:
mark the fields `repr=False`).

---

## 8. Security, privacy and abuse limits

### 8.1 Card data and PCI
- Card numbers, CVC and expiry are typed only on Stripe's page. SeatPlan stores Stripe ids, brand, last 4 and
  expiry month/year (non-sensitive under PCI DSS). Target: SAQ A (Martim completes it once a year in Stripe).
- No webhook payload is stored or logged. Logs show event type and id only.
- `success_url`/`cancel_url` contain the random `payment_id` only, never the manage token (Stripe would keep it).
  The frontend keeps the manage token in `sessionStorage` (`seatplan.pendingManage.<payment_id>`) across the
  redirect, and removes it after the confirmation is shown.

### 8.2 Integrity
- Money state changes only through `apply_checkout` / `charge_fee` / `refund` / `redeem`, each idempotent:
  UNIQUE `payment_transactions.idempotency_key`, UNIQUE `payment_events(provider, event_id)`, conditional
  UPDATEs for balances and status (`WHERE status = 'pending'`). A webhook and a return-page pull arriving
  together apply once (test with two threads).
- Amounts are recomputed on the server from the snapshot; the client never sends a price except the gift
  card amount, which is validated against the owner's bounds.
- The webhook trusts nothing in the payload except the object id; it reads the object back from Stripe with
  the restaurant's account header, and checks `metadata.seatplan_payment` matches the row.
- Staff of another restaurant get 404 (`load_for_staff`). Demo staff may charge only on `is_demo` venues, and
  there only the demo provider can ever be used.
- Every money action writes `record_change` (audit) with amounts and actor, never card data or emails.

### 8.3 GDPR
- **Lawful basis**: performance of the booking / gift contract (Art. 6(1)(b)). No marketing consent is asked or
  implied. The policy checkbox records acceptance of a contract term (stored as `policy_text` + `accepted_at`),
  which also serves as the off-session mandate evidence and as dispute evidence.
- **Minimisation**: no IP, no full card data, no payload storage; `payment_transactions` has no name or email;
  staff see masked emails; the gift check endpoint returns no buyer or recipient data.
- **Recipient of a gift card**: their email is given by the buyer; it is used once for delivery (plus a
  reminder 30 days before expiry, if decision 12 says yes) and the email says so.
- **Retention** (run by `/internal/payments/sweep`):
  - Guarantee cards are **detached** in Stripe 7 days after the booking date when no fee was charged; card
    brand/last 4 kept for display, `payment_method_id` blanked.
  - `booking_payments` card fields and Stripe customer/method ids are blanked 120 days after the booking date
    (the card networks' usual dispute window).
  - `gift_cards.message` blanked 30 days after delivery (same rule as `mail/outbox.scrub_expired`).
  - Gift buyer/recipient names and emails blanked 12 months after the card is closed (used, expired, refunded).
  - `payment_transactions` and `gift_card_entries` (amounts, dates, Stripe refs, no personal data) kept 10 years
    for the restaurant's accounting; `payment_events` deleted after 90 days.
  - Finished outbox rows already lose personal links after sending and their words after 30 days; gift codes
    are added to the redaction (7.4).
- **Erasure**: a diner's request erases names, emails and phone in their bookings and gift cards; the ledger
  keeps amounts (Art. 17(3)(b), legal obligation). Implemented as a documented runbook step in
  `docs/runbook.md` with a pure helper `booking_payments.erase_person(session, email)` (tested); no UI in v1.
- **Processors**: Stripe is an independent controller for payment processing and fraud (Stripe's privacy
  policy) and a processor for the rest; the privacy notice must say so (decision for Martim, section 12).

### 8.4 Abuse limits and caps
| What | Limit |
|---|---|
| Bookings needing payment | existing caps (pending counts as upcoming); at most 2 pending per mailbox per venue |
| Pending booking lifetime | 30 minutes, then released (3 paths) |
| `GET /payments/{id}` | 60/min per address; Stripe pull at most once per 5 s per payment |
| Retry checkout | 10/min per address, 5 per payment |
| Gift code check (diner) | 10/min and 30 failures/day per address; 200 failures/hour per venue switches online check off for an hour ("show the code at the restaurant") |
| Gift purchase | 5/hour per address; 3 pending per buyer mailbox; €10 to €500 (owner may lower); €2,000/day per venue (card-testing brake; owner can raise in settings later); Stripe Radar on by default |
| Staff gift lookup / redeem | 30/min per user; redeem ≤ balance (database-enforced); undo only 10 min, same user |
| No-show fee | only `no_show` or late-cancelled bookings; from start + 15 min; within 7 days of the booking date; once per booking (UNIQUE key); ≤ `fee_cap`; never on staff-cancelled bookings |
| Policy values | guarantee €5 to €150 per person; deposit €5 to €100 per person; window 2 to 72 hours; min party 1 to 20; 20 policy rows per venue |
| Webhook | body ≤ 64 KB; 400 without a valid signature before any DB write; 300 s tolerance |
| Vercel 30 s | each Stripe call has a 10 s timeout; no request makes more than 2 Stripe calls; the sweep processes at most 50 items per kind per run |

### 8.5 Portuguese and EU legal points (to confirm with a lawyer and a certified accountant)
- **Consumer information before payment** (Decreto-Lei 24/2014, distance contracts; Lei 24/96, consumer
  protection): price, total, cancellation terms and gift card validity must be clear before the diner pays.
  The policy card and gift terms do this.
- **Right of withdrawal**: DL 24/2014 art. 17 excludes leisure services for a specific date (a restaurant
  booking). A gift card bought online has no date: we recommend allowing a refund of unused cards within 14 days.
- **Unfair terms** (DL 446/85, general contract terms): fees must be proportionate; the caps above and the
  "up to" wording help; the restaurant can always waive.
- **Gift card validity**: we could not confirm a Portuguese statute fixing a minimum validity for vouchers; the
  validity must be stated before purchase and on the card. Default 24 months. Confirm with a lawyer.
- **VAT / invoicing**: deposits are advance payments, normally taxable when received (CIVA art. 8) and the
  restaurant must issue an invoice in certified software (with ATCUD). A monetary gift card usable for food (13%)
  and drinks (23%) is a **multi-purpose voucher** (EU Directive 2016/1065): no VAT at sale, VAT and invoice at
  redemption. An experience with a fixed content could be a single-purpose voucher (VAT at sale). No-show fees
  and kept deposits may be compensation outside VAT (CJEU C-277/05) but the Portuguese tax authority's position
  must be confirmed. SeatPlan never issues the restaurant's invoices; it shows "This is not an invoice".
- **SCA / PSD2**: SetupIntent via Checkout authenticates the card and records the mandate; the fee is a
  merchant-initiated transaction. When the bank still asks, the guest gets a link (`fee_action`).
- **Who holds the money**: with Connect direct charges the restaurant is the merchant and Stripe holds the
  funds, so SeatPlan is not collecting payments for third parties (which would need a PSD2 licence or an
  exemption).
- **Complaints**: an online seller in Portugal must show the Livro de Reclamações Eletrónico link and an
  alternative dispute resolution entity (Lei 144/2015). This is a site-wide footer item for Martim.
- **PCI DSS**: SAQ A with hosted Checkout, as long as no card field is ever added to SeatPlan pages.

---

## 9. Frontend components and routes

### 9.1 Routes added to `frontend/src/App.tsx`
```tsx
<Route path="/owner/:venueId/payments" element={<PaymentsPage />} />
<Route path="/restaurants/:slug/gift-card" element={<GiftCardPage />} />   {/* before /restaurants/:slug is fine: more specific */}
<Route path="/gift/return/:purchaseId" element={<GiftReturnPage />} />
<Route path="/pay/return/:paymentId" element={<PaymentReturnPage />} />
<Route path="/pay/demo/:paymentId" element={<DemoCheckoutPage />} />
<Route path="/gift/demo/:purchaseId" element={<DemoCheckoutPage purchase />} />
```
`PageShell` must set `data-surface="restaurants"` for `/pay/` and `/gift/` (check `design/components/PageShell.tsx`'s
route list).

### 9.2 New files
- `src/api/payments.ts` (+ `payments.test.ts`): `getPolicy`, `checkGiftCode`, `getPaymentStatus`,
  `retryPayment`, `abandonPayment`, `completeDemoPayment`, `getGiftOffer`, `buyGiftCard`, `getGiftPurchase`,
  staff and owner calls; `Server...` types and `to...()` converters, cents -> display via `formatEur`.
- `src/pages/restaurant/PolicyCard.tsx`, `GiftCodeField.tsx`, `NoShowDialog.tsx`, `PaymentLine.tsx`,
  `StaffGiftCards.tsx`, `policyText.ts` (pure: `policySentence`, `deadlineText`, `confirmLabel`,
  `cancelWarning`, `paymentBadge`) + tests.
- `src/pages/pay/` with `READ_ME_FIRST.md`, `PaymentReturnPage.tsx`, `DemoCheckoutPage.tsx`, `pendingManage.ts`
  (sessionStorage wrapper, try/catch), `pay.css`, tests.
- `src/pages/gift/` with `READ_ME_FIRST.md`, `GiftCardPage.tsx`, `GiftReturnPage.tsx`, `giftModel.ts` (pure:
  amount bounds, delivery date bounds, code formatting `7KQ2-M9XD-4HPA`), `gift.css`, tests.
- `src/pages/owner/PaymentsPage.tsx`, `PolicyRows.tsx`, `GiftSettings.tsx`, `ExperiencesEditor.tsx`,
  `GiftCardList.tsx`, `paymentsModel.ts` (pure) + tests.

### 9.3 Modified files (additive)
- `StepTime.tsx` (policy line), `StepDetails.tsx` (policy card, checkbox, gift field, redirect on
  `payment.required`), `BookingPage.tsx` (pass `policy` into the details step; replace countdown when pending),
  `Confirmation.tsx`, `BookingSummary.tsx`, `ManageBookingPage.tsx` (payment section, cancel warning, "Add card"
  while pending), `BookingActions.tsx` (No-show opens `NoShowDialog`; "Confirm without card"),
  `FloorLists.tsx` (payment badge), `staffStatus.ts` (`pending` look: "Awaiting card"), `StaffPage.tsx` (fifth tab
  "Gift cards"), `OwnerShell.tsx` (menu item), `restaurant-public/RestaurantPage.tsx` ("Give a gift card"
  button), `api/restaurant.ts` (`BookingStatus` adds `"pending"`; `createBooking` sends `accept_policy`,
  `gift_code`; `BookingView.payment`; `StaffBooking.payment`), `restaurant.css` / `staff.css` (a few classes).

---

## 10. Tests to add

Tests first for every pure module and every security rule. No existing test is changed or weakened.

### 10.1 pytest (`backend/tests/`)
- `test_payments_money.py`: `test_deposit_total_is_per_person_times_party`, `test_fee_cap_uses_smaller_of_party_at_booking_and_now`,
  `test_cancel_before_deadline_is_free_or_refund`, `test_cancel_exactly_at_deadline_is_free`,
  `test_cancel_after_deadline_keeps_or_fee`, `test_deadline_across_dst_change_uses_utc`,
  `test_can_charge_from_is_start_plus_15_minutes`, `test_format_eur_whole_and_cents`,
  `test_policy_bounds_reject_out_of_range`, `test_policy_sentence_exact_copy`.
- `test_gift_codes.py`: `test_alphabet_has_no_ambiguous_symbols`, `test_new_code_shape_and_entropy`,
  `test_normalise_accepts_lowercase_spaces_and_hyphens`, `test_normalise_rejects_wrong_length_or_symbols`,
  `test_code_hash_is_keyed_not_plain_sha256`, `test_last4`.
- `test_stripe_signature.py`: `test_valid_signature_passes`, `test_any_of_several_v1_values_passes`,
  `test_either_webhook_secret_passes`, `test_wrong_secret_fails`, `test_tampered_body_fails`,
  `test_timestamp_older_than_tolerance_fails`, `test_timestamp_in_future_fails`, `test_missing_or_malformed_header_fails`,
  `test_uses_compare_digest`.
- `test_payment_providers.py` (httpx `MockTransport`, like `test_mail_providers.py`):
  `test_default_provider_is_demo`, `test_demo_provider_never_opens_a_network_connection`,
  `test_stripe_setup_checkout_is_form_encoded_with_customer_and_eur`, `test_stripe_sends_idempotency_key_and_account_header`,
  `test_stripe_off_session_authentication_required_maps_to_needs_action`, `test_stripe_card_declined_maps_to_declined`,
  `test_stripe_repr_and_errors_never_contain_the_key`, `test_stripe_timeout_is_ten_seconds`,
  `test_settings_refuse_stripe_without_keys`, `test_settings_refuse_live_key_without_https`.
- `test_booking_policies.py`: `test_named_service_policy_wins_over_default`, `test_min_party_threshold`,
  `test_replace_policies_validates_bounds`, `test_policy_needs_ready_account_or_demo_venue`,
  `test_policy_survives_schedule_replace`, `test_owner_of_other_venue_gets_404`.
- `test_booking_payment_flow.py`: `test_venue_without_policy_books_exactly_as_before`,
  `test_policy_not_accepted_is_422`, `test_guarantee_booking_is_pending_and_owns_its_table`,
  `test_second_diner_gets_409_on_pending_table`, `test_confirmation_email_only_after_card_secured`,
  `test_demo_ok_confirms_and_stores_brand_last4_only`, `test_demo_endpoint_is_404_with_stripe_provider`,
  `test_pending_expires_after_30_minutes_and_offers_waitlist`, `test_hold_request_sweeps_expired_pending_for_that_day`,
  `test_abandon_frees_tables_at_once`, `test_pending_counts_against_booking_caps`,
  `test_deposit_cancel_before_deadline_refunds`, `test_deposit_cancel_after_deadline_keeps`,
  `test_deposit_party_change_is_409`, `test_gift_card_covering_deposit_skips_checkout`,
  `test_gift_card_partial_deposit_starts_checkout_for_rest`, `test_cancel_returns_gift_part_of_deposit`,
  `test_webhook_and_return_pull_at_once_apply_once` (two threads).
- `test_payment_webhooks.py`: `test_bad_signature_is_400_and_writes_nothing`, `test_duplicate_event_is_processed_once`,
  `test_object_is_refetched_not_trusted`, `test_metadata_mismatch_is_ignored_and_logged`,
  `test_checkout_expired_releases_booking`, `test_unknown_type_is_200`, `test_body_over_64kb_is_413`,
  `test_account_updated_sets_ready`, `test_dispute_created_flags_payment_for_owner`.
- `test_no_show_fee.py`: `test_fee_needs_no_show_or_late_cancel`, `test_fee_refused_before_start_plus_grace`,
  `test_fee_refused_after_7_days`, `test_fee_charged_once_under_concurrent_clicks`, `test_fee_capped`,
  `test_needs_action_queues_guest_email_with_link`, `test_declined_fee_keeps_no_show_status`,
  `test_waive_writes_audit`, `test_staff_cancel_never_allows_fee`, `test_other_venue_staff_404`,
  `test_demo_staff_cannot_charge_on_non_demo_venue`, `test_confirm_without_card_is_owner_only`.
- `test_gift_cards.py`: `test_disabled_restaurant_has_no_gift_page`, `test_purchase_bounds_422`,
  `test_card_has_no_code_until_paid`, `test_paid_card_emails_recipient_on_delivery_morning`,
  `test_code_is_never_stored_in_plain_text`, `test_check_reveals_no_buyer_or_recipient`,
  `test_check_one_message_for_unknown_and_other_venue`, `test_check_rate_limited`,
  `test_redeem_partial_balance`, `test_redeem_more_than_balance_is_409`,
  `test_concurrent_redeems_never_overdraw` (20 threads), `test_undo_within_10_minutes_same_user_only`,
  `test_experience_redeems_whole`, `test_expired_card_refused_and_expired_by_sweep`,
  `test_refund_unused_within_14_days`, `test_finished_outbox_row_loses_gift_code`,
  `test_event_emails_unchanged_by_code_redaction`, `test_lisbon_catalogue_venues_cannot_enable_gift_cards_in_demo_seed`.
- `test_payments_retention.py`: `test_sweep_detaches_unused_guarantee_cards_after_7_days`,
  `test_card_fields_blanked_after_120_days`, `test_gift_message_blanked_30_days_after_delivery`,
  `test_gift_contacts_blanked_12_months_after_close`, `test_payment_events_deleted_after_90_days`,
  `test_sweep_requires_cron_secret`, `test_sweep_is_bounded_per_run`, `test_erase_person_keeps_ledger_amounts`.
- `test_migrate_payments.py`: `test_upgrade_from_2026_11_17_schema_adds_tables_and_gift_card_id`,
  `test_migrate_twice_changes_nothing`.
- `test_payments_seed.py`: `test_demo_payments_seed_is_idempotent`, `test_casa_lumen_policy_only_for_6_or_more`,
  `test_demo_links_include_gift_code_only_in_demo_mode`.

### 10.2 vitest (`frontend/src`)
- `api/payments.test.ts`: `converts server payment to view`, `formats cents in euros`.
- `pages/restaurant/policyText.test.ts`: `guarantee sentence`, `deposit sentence`, `deadline in venue time`,
  `confirm button label per mode`, `cancel warning per outcome`, `payment badge per status`.
- `pages/restaurant/PolicyCard.test.tsx`: `shows demo label`, `requires the checkbox`, `shows test-card hint in test mode`.
- `pages/restaurant/StepDetailsPayment.test.tsx`: `redirects to next_url after booking`, `keeps manage token for the return page`,
  `gift code applied message`, `one message for unknown codes`.
- `pages/restaurant/NoShowDialog.test.tsx`: `charge disabled before grace with the time in words`, `amount capped`,
  `deposit booking shows kept deposit`, `focus returns to the button`.
- `pages/restaurant/StaffGiftCards.test.tsx`: `find, take off, undo`, `experience mark as used`.
- `pages/pay/PaymentReturnPage.test.tsx`: `polls until secured`, `declined offers try again`, `expired offers book again`,
  `no stored token shows check your inbox`.
- `pages/pay/DemoCheckoutPage.test.tsx`: `banner says no real money`, `four outcomes`, `404 message when not demo`.
- `pages/gift/giftModel.test.ts` and `GiftCardPage.test.tsx`: `amount bounds`, `delivery date bounds`,
  `send to me hides recipient email`, `terms required`.
- `pages/owner/PaymentsPage.test.tsx` and `paymentsModel.test.ts`: `one row per service plus all others`,
  `preview sentence`, `bounds messages`, `demo panel`, `connect button when not connected`.

### 10.3 Playwright (`frontend/e2e/`)
- `payments-guarantee.spec.ts` (1440 and 390): demo restaurant with a guarantee; book; policy visible before
  confirm; demo checkout "Card works"; confirmation shows "Demo •• 0000"; staff marks no-show after moving the
  clock past grace (fixture books a past-today slot through the API) and charges; manage page shows the fee.
- `payments-deposit.spec.ts`: pay deposit; cancel before deadline; manage page says refunded; staff day totals.
- `payments-expiry.spec.ts`: "Card is declined now" -> retry -> abandon frees the table for a second browser.
- `gift-cards.spec.ts`: buy €50 by demo; read the code from the outbox through the existing e2e outbox helper;
  apply it at booking; staff takes off €20 and undoes; owner sees the card in the list.
- `owner-payments.spec.ts` (1440 and 390): set Dinner guarantee, add an experience, save, reload.
- `accessibility.spec.ts` (shared file, append): axe on `/pay/demo/...`, `/restaurants/<slug>/gift-card`,
  `/owner/<vid>/payments`, the no-show dialog. CSP violation rule in `fixtures.ts` keeps proving no external
  script is loaded.

---

## 11. Files touched

### New
```
backend/app/payments/__init__.py
backend/app/payments/READ_ME_FIRST.md
backend/app/payments/money.py
backend/app/payments/giftcodes.py
backend/app/payments/stripe_signature.py
backend/app/payments/providers.py
backend/app/restaurant_service/policies.py
backend/app/restaurant_service/payment_settings.py
backend/app/restaurant_service/booking_payments.py
backend/app/restaurant_service/gift_cards.py
backend/app/restaurant_service/payment_events.py
backend/app/restaurant_service/payment_emails.py
backend/app/mail/payment_templates.py
backend/app/routers/payments.py
backend/app/routers/gifts.py
backend/app/routers/staff_payments.py
backend/app/routers/owner_payments.py
backend/app/seed/demo_payments.py
backend/tests/test_payments_money.py, test_gift_codes.py, test_stripe_signature.py, test_payment_providers.py,
  test_booking_policies.py, test_booking_payment_flow.py, test_payment_webhooks.py, test_no_show_fee.py,
  test_gift_cards.py, test_payments_retention.py, test_migrate_payments.py, test_payments_seed.py
backend/tests/fixtures/schema_2026_11_17.sqlite.sql, schema_2026_11_17.postgres.sql
frontend/src/api/payments.ts (+ test)
frontend/src/pages/restaurant/PolicyCard.tsx, GiftCodeField.tsx, NoShowDialog.tsx, PaymentLine.tsx,
  StaffGiftCards.tsx, policyText.ts (+ tests)
frontend/src/pages/pay/READ_ME_FIRST.md, PaymentReturnPage.tsx, DemoCheckoutPage.tsx, pendingManage.ts, pay.css (+ tests)
frontend/src/pages/gift/READ_ME_FIRST.md, GiftCardPage.tsx, GiftReturnPage.tsx, giftModel.ts, gift.css (+ tests)
frontend/src/pages/owner/PaymentsPage.tsx, PolicyRows.tsx, GiftSettings.tsx, ExperiencesEditor.tsx,
  GiftCardList.tsx, paymentsModel.ts (+ tests)
frontend/e2e/payments-guarantee.spec.ts, payments-deposit.spec.ts, payments-expiry.spec.ts, gift-cards.spec.ts,
  owner-payments.spec.ts
docs/payments.md (provider setup, Stripe events list, legal checklist, runbook for erasure and refunds)
```

### Modified (shared with other features are marked **shared**)
| File | Change | Shared? |
|---|---|---|
| `backend/app/models.py` | 8 new classes; `Booking.gift_card_id` appended | **shared** (events models untouched) |
| `backend/app/seed/migrate.py` | 1 `NEW_COLUMNS` entry, 2 `RESTAURANT_INDEXES` entries | **shared** |
| `backend/app/config.py` | 5 payment settings | **shared** |
| `backend/app/main.py` | register 4 routers | **shared** |
| `backend/app/mail/outbox.py` | gift code redaction in `_forget_links` | **shared** (event output unchanged, tested) |
| `backend/app/mail/restaurant_templates.py` | optional `payment_line` | restaurant |
| `backend/app/restaurant_service/occupancy.py` | `pending` in `ACTIVE_STATUSES` | restaurant core (also used by availability, caps) |
| `backend/app/restaurant_service/diner_flow.py`, `manage_flow.py`, `staff_floor.py`, `emails.py`, `discovery.py` | hooks listed in 7.4 | restaurant (other restaurant features also edit these) |
| `backend/app/routers/restaurants.py`, `bookings.py` | additive fields | restaurant |
| `backend/app/seed/run.py` | call `demo_payments.seed` | **shared** seed entry |
| `backend/app/READ_ME_FIRST.md`, `restaurant_service/READ_ME_FIRST.md`, `routers/READ_ME_FIRST.md`, `mail/READ_ME_FIRST.md`, `seed/READ_ME_FIRST.md` | document the new files | docs |
| `.github/workflows/email-cron.yml` | second `curl` step to `/api/internal/payments/sweep` (same secrets) | **shared** (the only scheduler) |
| `frontend/src/App.tsx` | 6 routes | **shared** |
| `frontend/src/design/components/PageShell.tsx` | restaurant surface for `/pay/`, `/gift/` | **shared** |
| `frontend/src/api/restaurant.ts` | types and `createBooking` fields | restaurant |
| `frontend/src/pages/restaurant/StepTime.tsx`, `StepDetails.tsx`, `BookingPage.tsx`, `Confirmation.tsx`, `BookingSummary.tsx`, `ManageBookingPage.tsx`, `BookingActions.tsx`, `FloorLists.tsx`, `staffStatus.ts`, `StaffPage.tsx`, `restaurant.css`, `staff.css`, `READ_ME_FIRST.md` | section 9.3 | restaurant (diner-flow features also edit these) |
| `frontend/src/pages/owner/OwnerShell.tsx`, `READ_ME_FIRST.md` | menu item | owner |
| `frontend/src/pages/restaurant-public/RestaurantPage.tsx`, `READ_ME_FIRST.md` | "Give a gift card" | public page |
| `frontend/e2e/accessibility.spec.ts`, `frontend/e2e/READ_ME_FIRST.md` | new pages | **shared** |
| `docs/data-model.md`, `docs/api.md`, `docs/security.md`, `docs/user-guide-diner.md`, `docs/user-guide-staff.md`, `docs/user-guide-owner.md`, `docs/ux-restaurant.md`, `docs/deployment.md` | docs | docs |

Not touched: `vercel.json` (hosted Checkout needs no CSP change), any events path, `pages/room-editor/`.

---

## 12. Rollout and demo data

1. **Phase A (demo only, mergeable alone)**: pure modules + tests, models + migrate, policies, pending bookings,
   demo provider, demo checkout and return pages, policy card, staff no-show dialog, owner policy rows. Default
   `PAYMENT_PROVIDER=demo`. Restaurants with no policy behave byte-for-byte as today (a regression test proves it).
2. **Phase B (Stripe test mode)**: `StripeProvider`, webhook, Connect onboarding, sweep in the cron. Enabled on a
   preview deployment with `sk_test_` keys only.
3. **Phase C (gift cards)**: settings, experiences, purchase, delivery emails, staff tab, owner list.
4. **Go live**: only after Martim's checklist (below) and a test-mode end-to-end run recorded in `docs/payments.md`.

Production deploy order (memory: backup + migrate before merge): back up Postgres -> `python -m app.seed.migrate`
-> merge -> GitHub Actions deploy -> add the sweep step secrets (same `CRON_SECRET`).

**Demo seeding** (`seed/demo_payments.py`, idempotent, called from `seed_all`, also runnable as
`python -m app.seed.demo_payments` on local SQLite with `DEMO_MODE=1`):
- All demo restaurants: `venue_payment_settings(provider="demo", account_status="ready")`.
- **Casa Lumen**: Dinner = card guarantee €20 per person, 24 h, **from party size 6** (existing e2e flows use
  smaller parties and stay unchanged; verify party sizes in `restaurant.spec.ts` before merging). Gift cards on,
  presets €25/€50/€100, experience **"Dinner at the window table"** (€120, for 2, zone `window`). Three past
  no-shows with demo fees in the ledger so the staff day totals show numbers. One active demo gift card
  (€100, €80 left) whose code is stored in `demo_links` as `gift_demo_code` (only served while `DEMO_MODE=1`).
- **Showcase restaurant with the south glass wall and terrace** (`demo_showcase.py`): Dinner = deposit €15 per
  person, 48 h; gift cards on with experience **"Sunset on the terrace"** (€90, for 2, zone `terrace`).
- **Showcase quiet small room**: Lunch none, Dinner guarantee €10 per person, 12 h.
- **Lisbon catalogue (20 real businesses)**: no payment settings, no policies, no gift cards.

---

## 13. External services and what Martim must do

| Service | Use | Cost (check current prices on stripe.com/pt/pricing before deciding) |
|---|---|---|
| Stripe Payments + Checkout | guarantees, deposits, fees, gift card sales | per successful card charge, roughly 1.5% + €0.25 for standard EEA cards, more for UK/international; SetupIntents themselves are free; disputes about €20 each |
| Stripe Connect (Express) | restaurant onboarding, KYC, payouts | if the platform manages pricing: a monthly fee per active connected account plus a small payout fee; if Stripe bills the restaurants directly, no platform fee. Confirm the current model |
| Stripe Radar | fraud screening | included for standard pricing |
| Resend (existing) | payment emails | unchanged |

Steps for Martim (none needed for Phase A):
1. Decide the legal entity that operates SeatPlan (Unipessoal Lda or empresário em nome individual), with NIF,
   registered address and IBAN; Stripe requires a business to open a platform account.
2. Create the Stripe account (country Portugal), complete the business profile, enable **Connect** with Express
   accounts, set branding, choose who pays fees (recommended: restaurants, direct charges).
3. In test mode, create the webhook endpoints `https://<site>/api/payments/webhooks/stripe` for account events and
   for Connect events with the event list in 6.2; copy both signing secrets.
4. Set in Vercel (Preview first): `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_CONNECT_WEBHOOK_SECRET`, optionally `STRIPE_APPLICATION_FEE_BPS`. Never in the repository.
5. Write and publish: diner terms (booking policy, gift card terms), restaurant terms (Connect agreement is
   accepted inside Stripe onboarding), privacy notice update (Stripe's role, retention in 8.3).
6. Add the Livro de Reclamações Eletrónico link and an ADR entity to the site footer.
7. Ask a certified accountant (contabilista certificado) to confirm VAT on deposits, kept deposits, no-show fees,
   monetary vs experience vouchers, and how SeatPlan invoices its own platform fee (if any).
8. Ask a lawyer to confirm gift card validity and the 14-day refund rule.
9. Complete the PCI SAQ A in the Stripe dashboard.
10. Switch to live keys only after a full test-mode run is recorded.

---

## 14. Open decisions for Martim (each with a recommended default)

1. **Who is the merchant?** Recommended: each restaurant via Stripe Connect Express, direct charges.
2. **SeatPlan fee on payments?** Recommended: 0% during the pilot (`STRIPE_APPLICATION_FEE_BPS=0`).
3. **Who pays Stripe fees?** Recommended: the restaurant (default with direct charges).
4. **Charge no-show fees automatically or by staff?** Recommended: staff decide in the dialog, from 15 minutes
   after the booking time, within 7 days.
5. **Late cancellation fee for guarantees?** Recommended: yes, same amount, charged by staff like a no-show.
6. **Gift card validity?** Recommended: 24 months (owner may choose 12 or 36).
7. **Refund unused gift cards within 14 days?** Recommended: yes.
8. **Gift cards per restaurant or platform-wide?** Recommended: per restaurant only.
9. **Email the diner when a pending booking expires?** Recommended: yes, one short email "We did not keep your
   table", no marketing.
10. **Policy limits?** Recommended: guarantee ≤ €150 per person, deposit ≤ €100 per person, window 2 to 72 hours.
11. **Allow the demo provider on non-demo restaurants in production?** Recommended: no; only `is_demo` venues or
    `DEMO_MODE=1`.
12. **Expiry reminder to gift card holders 30 days before?** Recommended: yes (one email, contract-related).
13. **Lisbon catalogue (real businesses) in payment demos?** Recommended: never.
14. **Pending window length?** Recommended: 30 minutes (Stripe Checkout minimum).
15. **Accept MB WAY / Multibanco for deposits and gift cards later?** Recommended: later, gift cards and deposits
    only (they cannot back an off-session guarantee).

---

## 15. Risks

- Ripple of the new `pending` status through availability, caps, floor, dashboard and the optimiser's busy maps
  (mitigated by putting it in `ACTIVE_STATUSES` and a regression test per consumer).
- Shared-file conflicts with other restaurant features editing `StepDetails.tsx`, `BookingActions.tsx`,
  `diner_flow.py`, `models.py`, `migrate.py` and `App.tsx` in parallel.
- Stripe API drift: pin `Stripe-Version`; the provider is the only file that knows Stripe.
- Webhook delivery delays: covered by the return-page pull and the sweep.
- Legal/VAT uncertainty (section 8.5) blocks going live, not development.
- 30 s function limit: Stripe timeouts at 10 s, at most two calls per request.
- Demo confusion: every demo money screen carries "no real money" in words.

## 16. Size and effort

**XL** overall (about 13 to 16 developer days), or three L phases: A demo guarantees/deposits/no-show (5 days),
B Stripe + Connect + webhooks + sweep (4 days), C gift cards (5 days), plus 1 to 2 days of e2e, accessibility
and docs.
