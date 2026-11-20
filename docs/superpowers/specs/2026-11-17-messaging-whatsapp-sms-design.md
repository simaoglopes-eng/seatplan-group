# WhatsApp and SMS messages for restaurant bookings: design

Date: 2026-11-17. Status: design for review (nothing implemented). Branch for the work: a new branch off
`codex/restaurantes-ux`, never `main`. Slug: `messaging-whatsapp-sms`.

Mockup: `C:\Users\marti\AppData\Local\Temp\claude\51127802244b2e7b\048014bd-52bb-4f3b-b71e-3f8ba641286a\scratchpad\features\messaging-whatsapp-sms.html` (owner "Guest messages" page and staff no-show card on
desktop; the diner's opt-in and the "Are you still coming?" page at 390 px).

---

## 0. What exists today (checked in the code on 2026-11-17)

| Fact | Where |
|---|---|
| Email is written to `email_outbox` first and sent later; UNIQUE `idempotency_key`; `_claim` (conditional UPDATE) makes two processors send each row once; backoff 5/10/20/40 min, `failed` after 5 tries; `EMAIL_ALLOWLIST` (empty = nobody); finished rows lose personal links (S9); `scrub_expired` after 30 days | `backend/app/mail/outbox.py` (`enqueue`, `process_due`, `send_now`, `_claim`, `backoff_delay`, `MAX_ATTEMPTS`, `CLAIM_LEASE`, `RETENTION_DAYS`, `scrub_expired`) |
| Provider protocol, console provider (masked address), Resend through httpx with a fake-transport-friendly client and a `__repr__` that hides the key | `backend/app/mail/providers.py` |
| The only scheduler: GitHub Actions every 15 min, `POST /api/internal/email/process` with `X-Cron-Secret`; secret checked with `tokens_match`, rate limited 30/min | `.github/workflows/email-cron.yml`, `backend/app/routers/emails.py` (`_check_cron_secret`) |
| One "when" rule for reminders: 24 h before, else 2 h, else none | `backend/app/mail/reminders.py` (`reminder_time`) |
| Restaurant emails: confirmation, change (numbered keys), reminder, cancellation, waitlist offer; `drop_reminder` marks queued reminders `skipped` | `backend/app/restaurant_service/emails.py` |
| Booking flow hooks: `diner_flow.confirm_booking` (queues email, one commit), `manage_flow.change_booking`, `manage_flow.cancel_booking` (cancellation email + `waitlist.offer_freed_tables`), `staff_floor.set_status` | `backend/app/restaurant_service/` |
| Only the SHA-256 of the manage token is stored, so a message built later cannot contain the manage link | `Booking.manage_token_hash`, `emails._link` |
| `Booking.phone` is free text (max 40), optional; the diner form says "Only used if we need to reach you on the day" | `models.Booking`, `routers/restaurants.BookingIn`, `frontend/src/pages/restaurant/StepDetails.tsx` |
| `WaitlistEntry` has email only | `models.WaitlistEntry`, `routers/bookings.WaitlistIn` |
| Dashboard: no-show rate over 90 days = no-shows / (completed + no-show) | `backend/app/restaurant_service/dashboard.py` (`no_show_counts`, `HISTORY_DAYS`) |
| Codes: 6 digits, keyed hash (`security.keyed_hash`), tries counted by one `UPDATE ... WHERE attempts < 5 RETURNING` (S40), limits per network/mailbox/app | `backend/app/events_service/accounts.py` (pattern only; events code is not edited or imported for this) |
| Rate limits live in the DB with keyed-hash keys (S7) | `backend/app/security.py` (`rate_limit`, `limit_reached`, `network_of`, `keyed_hash`, `tokens_match`, `hash_token`) |
| Every env var is read in one file | `backend/app/config.py` |
| New columns on existing tables must be in `NEW_COLUMNS`; new tables come from `db.create_all()` in `python -m app.seed.migrate`; Postgres never auto-creates | `backend/app/seed/migrate.py` |
| No `python-multipart` in `requirements.txt`, so FastAPI `Form()` is not available; Twilio's form posts must be parsed with `urllib.parse.parse_qsl` | `requirements.txt` |
| The frontend has no `/m/...` route; `vercel.json` rewrites everything that is not `/api/` to `index.html`; CSP `connect-src 'self'` is enough because only the backend calls providers | `frontend/src/App.tsx`, `vercel.json` |
| Product spec lists "SMS" as a non-goal of the first release; this feature lifts that | `docs/product-spec.md:354` |

Provider facts checked on 2026-11-17 (re-check before signing up; prices change):

- Twilio, Portugal SMS: outbound US$0.0501 per segment, inbound US$0.045 per segment, a Portuguese mobile number
  US$135 per month; alphanumeric sender ID supported, no pre-registration; two-way SMS needs a number (an
  alphanumeric sender cannot receive replies); send in daytime hours; support STOP/HELP in the local language;
  SMS to landlines fails with error 21614. Sources: twilio.com/en-us/sms/pricing/pt and
  twilio.com/en-us/guidelines/pt/sms.
- WhatsApp Business Platform (Meta): per-message pricing since 2025-07-01; business-started messages must be
  approved templates (utility, authentication, marketing); messages from users are free; since 2026-10-01 utility
  templates are charged even inside the 24-hour window; first 1,000 non-template service replies per number per
  month are free. Portugal is billed at the "Rest of Western Europe" rate. Source:
  developers.facebook.com/docs/whatsapp/pricing. The utility and authentication rate for that region is about
  US$0.0197 per message according to third-party rate tables (SleekFlow, ManyChat) **[not verified against
  Meta's own rate card]**.

---

## 1. Goal and user stories

Goal: cut no-shows and give tables back earlier. Diners who want them get messages on the phone (WhatsApp or SMS)
next to the email they already get: a confirmation (optional per restaurant), a reminder 24 h and 3 h before with
"Yes, I'm coming / Cancel", a cancellation notice and the waitlist "a table is free" offer. The dashboard shows
whether this lowers no-shows.

Diner
- D1. As a diner I can tick "Send me booking messages by WhatsApp or SMS" while booking, verify my mobile with a
  6-digit code, and book. Without ticking, nothing changes from today.
- D2. As a diner I get a reminder the day before and 3 hours before, and I can say "I'm coming" or cancel with
  one tap (WhatsApp button or link), or by replying YES / CANCEL where replies are supported.
- D3. As a diner on the waitlist I can get the "table free" offer on my phone, because by email I would see it
  too late.
- D4. As a diner I can stop messages at any time (reply STOP, or "Stop messages" on the link page or the manage
  page), and my number is deleted 30 days after my visit.
- D5. As a diner who booked without it, I can add phone reminders later on the manage page (`/b/:token`).

Staff
- S1. On the floor I see which parties said "Coming" (and when, and how), and which got a reminder and did not
  answer, so I know whom to call.
- S2. When a diner cancels by reply, the table is free at once and offered to the waitlist (same code path as a
  cancellation through the manage link).
- S3. On the dashboard I see the no-show rate of bookings with phone reminders next to email-only bookings,
  the confirmation rate and how many tables reminders gave back.

Owner
- O1. As an owner I switch WhatsApp and SMS on or off for my restaurant (both off by default), choose which
  messages go out, and set a monthly limit so the cost is bounded.
- O2. I see this month's count, an estimated cost and a log of recent messages with masked numbers.

---

## 2. Non-goals (this release)

- Marketing or promotional messages of any kind (different legal basis, different WhatsApp category).
- Numbers outside Portugal (+351 mobiles only; see 9.3, SMS pumping fraud). Foreign numbers: open decision Q3.
- Messages in Portuguese. All copy is English like the rest of the app (open decision Q4 for a `pt_PT` set).
- Free-text chat between diner and restaurant. Unknown replies get one fixed answer with the restaurant's phone.
- Changing time or party size by message. The `/m/` link can only confirm, cancel or stop; changes stay on the
  manage link from the email.
- Remembering a verified number across bookings (would need a column on the shared `GuestAccount`; Q7).
- Messages for walk-ins, staff-created bookings, or events. Event code and the event emails do not change.
- Push notifications, voice calls, RCS, Telegram.
- A Twilio WhatsApp provider. WhatsApp goes direct to Meta's Cloud API (no Twilio fee of about US$0.005 a message);
  the provider interface allows adding one later.
- Automatic overbooking from the new numbers (the dashboard still only suggests).

---

## 3. UX flow per screen, with exact copy

Design: restaurant theme (`frontend/src/design/restaurant-theme.css`): white and lavender surfaces, purple
`#4F3F8F` for structure and selection, one pink `#B0347A` main button per screen, bold sans headings. Uses the
shared `Field`, `Checkbox`, `Button`, `Badge`, `Dialog` components only.

### 3.1 Booking, "Your details" step (`StepDetails.tsx`, both `step` and `panel` variants)

A new block `PhoneOptIn` sits under the Email field and above "Add a phone number or a note for the restaurant".
It is shown only when `GET /r/{vid}` says at least one channel is on for the restaurant.

Unticked (default; consent is never pre-ticked):

- Section title: **Reminders on your phone (optional)**
- Checkbox: **Send me booking messages by WhatsApp or SMS**

Ticked:

- Consent text under the checkbox (versioned `MSG_CONSENT_VERSION = "2026-11-17"`):
  "We'll send your reminders 24 hours and 3 hours before, each with a link to confirm or cancel. No marketing.
  Reply STOP or use the link to stop at any time. We delete your number 30 days after your visit."
  (When the restaurant also sends confirmations, the first sentence starts "We'll send your confirmation and
  reminders ..."; when only one reminder is on, it names that one.)
- Channel choice (radio group shown as two segments, only the channels the restaurant has on; one channel means
  no choice is shown): **WhatsApp** · **SMS**
- Field: label **Mobile number**, fixed prefix chip **+351**, placeholder `912 345 678`,
  hint "Portuguese mobile numbers only for now."
- Button (secondary): **Send code**

After "Send code":

- Status line: "We sent a 6-digit code to +351 912 ••• 678 by WhatsApp." (or "by SMS")
- Field: label **Code**, `inputMode="numeric"`, `autoComplete="one-time-code"`, 6 digits.
- Button (secondary): **Verify**
- Links: **Send a new code** (disabled with "Send a new code in 0:24" for 30 s), **Change number**
- Demo only (server sent `demo_code`): notice "Demo: no message is sent. Your code is 482913."

Verified:

- Line with a check: "Verified: +351 912 345 678 · WhatsApp" and a ghost button **Change**.

Errors (inline, `role="alert"` on the field):

| Case | Copy |
|---|---|
| Landline or special number | "This looks like a landline or a special number. Enter a mobile number starting with 9." |
| Not +351 | "For now we can only send messages to Portuguese mobile numbers (+351 9...)." |
| Wrong code | "That code is not right. You have 3 tries left." (server message) |
| Code expired / replaced | "This code has expired. Send a new code." |
| Rate limited | "Too many codes for this number. Try again in an hour, or book without phone messages." |
| Provider down (code not sent) | "We could not send the code right now. Try again, or book without phone messages." |
| Submit while ticked but not verified | "Verify your number, or untick the box to book without phone messages." Focus moves to the code field (same `focusFirstError` rule). |

The 5-minute hold timer keeps running: the code expires after 10 minutes, so it outlives the hold, and resending
is allowed after 30 s. If the hold runs out the existing "Your hold on table ... ended" flow applies; the
verified state survives because it is kept with the contact details in the page (the proof lasts 30 minutes).

The existing optional "Phone (optional)" field stays as is. When the diner verifies a number and leaves that field
empty, the server copies the verified number (display form) into `Booking.phone` so staff can call.

### 3.2 Confirmation (`Confirmation.tsx`)

Under the booking summary, when messages were set up:
"Reminders by WhatsApp to +351 912 ••• 678: the day before and 3 hours before." (SMS: "by SMS"; only the
reminders that will really be sent are named, using `messages.planned` from the API).

### 3.3 The link page: `/m/:token` (new `MessageActionPage.tsx`)

Opened from the reminder. Shows the least that is needed (no diner name, no notes, no email).

- Page title (h1): **Are you still coming?**
- Card: restaurant name (bold), "Friday 20 November · 19:30 · 2 people · Table 4", address line with
  "Directions" (existing `DirectionsLink`).
- Primary (pink): **Yes, I'm coming**
- Secondary: **I can't come, cancel**
- Muted text: "Want to change the time or party size? Use the link in your confirmation email."
- Footer link: **Stop messages for this booking**

States:

| State | Copy |
|---|---|
| After "Yes" | Badge **Confirmed**. "Thanks. Casa Lumen is expecting you at 19:30." |
| Already confirmed earlier | Badge **Confirmed**. "You confirmed on Thursday at 14:02. See you at 19:30." Buttons: only "I can't come, cancel". |
| Cancel dialog | Title "Cancel this booking?" Body: "Table 4 is released straight away and offered to the next person waiting. You would need to book again." Buttons: **Keep booking** (first, focused), **Cancel booking** (danger). |
| Cancelled | "Your booking is cancelled. Thanks for letting Casa Lumen know." Link **Book another time** (`/r/{vid}`). |
| Stopped | "We won't send more messages about this booking, and we've deleted your number from it." |
| Started or finished | "Your booking has started. To make a change, please call Casa Lumen on +351 210 000 100." |
| Invalid / old link (404) | Title "This link no longer works". "The booking may have finished, or the link was mistyped. To change a booking, use the link in your confirmation email or call the restaurant." |
| Waitlist offer token | Redirects at once to `/r/{vid}?date=&time=&party=` (existing `useLinkedTime`). |

### 3.4 Manage page (`ManageBookingPage.tsx`)

New card "Phone messages" in the side column:

- With messages: "WhatsApp to +351 912 ••• 678. Next: reminder tomorrow at 19:30." Ghost button
  **Stop messages**. After stopping: "Messages stopped. Your number is deleted from this booking."
- Without, restaurant has a channel on and the booking is more than 4 hours away: "Want a reminder on your
  phone?" and the same `PhoneOptIn` block (bound to the manage token), then **Save** (secondary).

### 3.5 Waitlist dialog (`WaitlistDialog.tsx`)

Under the email field, when the restaurant has waitlist offers on: checkbox **Text me when a table frees up**
(WhatsApp or SMS), then the same verify block. Consent text: "We'll send one message if a table frees up for
your time, with a link to book it. It is not held for you, so be quick. We delete your number after that day."

### 3.6 Staff floor (`StaffFloor.tsx`, `FloorLists.tsx`, `SelectionPanel.tsx`)

On each booking in the list and in the selection panel, a small badge:

- **Coming** with tooltip/line "Confirmed by WhatsApp at 14:02" (or "by SMS", "by link").
- **Reminded, no answer** (neutral tone) when a reminder was sent and nothing came back.
- No badge for email-only bookings.
- After a cancel by message, the existing live update frees the table; the audit actor is `diner-message`.

### 3.7 Staff dashboard (`StaffDashboard.tsx`), new card "Reminders and no-shows"

- Two stats side by side: "With phone reminders **3.8%** no-shows · 52 bookings" and "Email only **11.2%**
  no-shows · 89 bookings".
- Line: "61% of reminded diners confirmed. 7 tables were given back by a cancel after a reminder."
- Muted: "Last 90 days. Diners who choose reminders may be more reliable anyway, so this is a comparison, not
  proof."
- Below 30 finished bookings in either group: "Not enough data yet. We need at least 30 finished bookings in each
  group (now 12 and 41)."
- With demo seed data: badge **Simulated history** next to the title.

### 3.8 Owner: "Guest messages" page `/owner/:venueId/messages` (new `MessagingSettingsPage.tsx`)

Reached from the owner restaurant card ("Guest messages") and the owner shell navigation.

- h1 **Guest messages**
- Intro: "Send confirmations and reminders by WhatsApp or SMS. Diners choose it when they book; nobody gets a
  message without saying yes."
- Demo banner (when the server's providers are the log provider): "Demo mode: messages are written to the log,
  never sent."
- Section **Channels**
  - Toggle **WhatsApp**, hint "About €0.02 per message. Diners can tap Yes or Cancel."
  - Toggle **SMS**, hint "About €0.05 per message. Sent from "SeatPlan"; diners confirm or cancel with a link."
    (When a two-way number is configured: "Diners can reply YES or CANCEL.")
- Section **What to send**
  - **Booking confirmation** (off by default), hint "Email already confirms every booking."
  - **Reminder 24 hours before** (on)
  - **Reminder 3 hours before** (on)
  - **Waitlist: a table is free** (on)
- Section **Monthly limit**: "Stop sending after [ 300 ] messages a month", hint "When the limit is reached,
  diners still get every email." Range 0 to 5000.
- Usage card: "This month: 212 messages · about €6.40 · limit 300". Small: "Estimate from list prices; your
  provider's invoice is the real cost."
- Preview: a phone frame showing the reminder exactly as it will be sent (WhatsApp bubble with buttons, or SMS).
- Pink button **Save changes**; toast "Saved. Changes apply to messages not sent yet."
- Section **Recent messages** (table): Time · To · Message · Channel · Status. "To" is masked
  (`+351 9•• ••• 678`). Status words: Delivered, Sent, Read, Waiting, Skipped (not on the allowlist), Skipped
  (monthly limit), Skipped (booking cancelled), Failed.

---

## 4. Messages (templates) and timing

All SMS text is GSM-7 only (no "·", curly quotes, accents or emoji), so one segment holds 160 characters. The
venue name is shortened (never the link) to keep each SMS to one segment; `messaging/gsm.py` counts segments and
a test checks every template with the longest demo name and a 40-character `PUBLIC_BASE_URL`. No diner name
appears in any message (minimisation; the phone may be shared).

`{link}` is `{PUBLIC_BASE_URL}/m/{action token}` (22-character token, see 6.4).

| Kind | SMS (link-only, alphanumeric sender "SeatPlan") | WhatsApp template (utility, `en`) |
|---|---|---|
| `phone_code` | `SeatPlan code: 482913. It expires in 10 minutes. Do not share it.` | `seatplan_code_v1` (authentication category, Meta's fixed text: "482913 is your verification code. For your security, do not share this code." + copy-code button) |
| `booking_confirmed` (if on) | `SeatPlan: Booked at Casa Lumen, Fri 20 Nov 19:30, 2 people. Confirm or cancel: {link}` | `seatplan_booking_confirmed_v1`: "Your table is booked at {{1}}: {{2}}, {{3}} people, table {{4}}. We will remind you before your visit." URL button "View booking" `.../m/{{1}}` |
| `reminder_24h` | `SeatPlan: See you tomorrow 19:30 at Casa Lumen, 2 people. Still coming? Confirm or cancel: {link}` | `seatplan_reminder_v1`: "Reminder: {{1}} at {{2}}, table for {{3}}. Are you still coming?" Quick replies "Yes, I'm coming", "Cancel booking"; URL button "View booking" |
| `reminder_3h` | `SeatPlan: Today 19:30 at Casa Lumen, 2 people. Can't come? Please cancel so others can eat: {link}` | same `seatplan_reminder_v1` with {{2}} = "today at 19:30" |
| `booking_cancelled` (diner or staff cancel; only if a message was sent before for this booking) | `SeatPlan: Your booking at Casa Lumen, Fri 20 Nov 19:30, is cancelled.` | `seatplan_booking_cancelled_v1`: "Your booking at {{1}} on {{2}} is cancelled." |
| `waitlist_offer` | `SeatPlan: A table for 2 is free at Casa Lumen, Fri 20 Nov 19:30. Not held, book fast: {link}` | `seatplan_waitlist_offer_v1`: "A table for {{1}} is free at {{2}} on {{3}}. It is not held for you." URL button "Book it" |
| `reply_ack` (answer to a reply; inside the 24 h window on WhatsApp this is a free-form service message) | Two-way SMS only: `SeatPlan: Thanks, you're confirmed for 19:30.` / `SeatPlan: Cancelled. The table is released.` / `SeatPlan: Stopped. You will get no more messages.` / help: `SeatPlan: Reply YES to confirm, CANCEL to cancel, STOP to stop. To talk to Casa Lumen call +351 210 000 100.` | same words, free-form |

When `TWILIO_SMS_FROM` is a phone number (two-way, open decision Q2), the reminder SMS ends
`Reply YES or CANCEL, or tap {link}` instead of `Confirm or cancel: {link}`.

Timing (pure function `message_times.reminder_times`, local time of the restaurant, `clock.venue_zone`):

1. `reminder_24h` at start minus 24 h, only if the booking was made at least 26 h before the start (otherwise it
   would land right after the confirmation).
2. `reminder_3h` at start minus 3 h, only if the booking was made at least 4 h before the start.
3. Quiet hours 22:00 to 09:00 local: a reminder that falls inside moves to 21:30 the evening before for the 24 h
   one, and to 09:00 for the 3 h one if that is still at least 1 h before the start; otherwise it is dropped.
4. Stale rule at send time: a reminder processed later than start minus 1 h is `skipped` ("Too late").
5. The cron runs every 15 minutes and GitHub may delay it, so reminders can arrive up to about 30 minutes late;
   the copy never promises an exact minute.

Confirmation, cancellation, waitlist offer and code are sent at once (`send_message_now` after the commit, like
`accounts.send_at_once`); the cron retries what failed. Reminders are only sent by the cron.

The existing email reminder (24 h, else 2 h) stays unchanged (open decision Q5).

---

## 5. Data model changes

All new tables are restaurant-only. `venues` (shared with events) gets no new column: the settings live in their
own table. `email_outbox` and `email_codes` (shared) are not touched.

### 5.1 New columns on `bookings` (restaurant-only table)

| Column | Type | Meaning |
|---|---|---|
| `reconfirmed_at` | `UtcDateTime`, NULL | When the diner said "I'm coming" |
| `reconfirmed_via` | `String(10)`, NULL | `whatsapp`, `sms` or `link` |

`migrate.py` `NEW_COLUMNS`, appended at the end in the same order as in `models.py` (seed READ_ME rule):

```python
("bookings", "reconfirmed_at", "TIMESTAMP"),
("bookings", "reconfirmed_via", "VARCHAR(10)"),
```

(`_add_missing_columns` already turns `TIMESTAMP` into `DATETIME` on SQLite.)

### 5.2 New tables (created by `db.create_all()` inside `python -m app.seed.migrate`)

`venue_message_settings` (one row per restaurant that has opened the page; no row = everything off)

| Column | Type | Default |
|---|---|---|
| `venue_id` | FK `venues.id`, PK, `ondelete=CASCADE` | |
| `sms_enabled` | Boolean | FALSE |
| `whatsapp_enabled` | Boolean | FALSE |
| `send_confirmation` | Boolean | FALSE |
| `reminder_24h` | Boolean | TRUE |
| `reminder_3h` | Boolean | TRUE |
| `waitlist_offers` | Boolean | TRUE |
| `monthly_cap` | Integer, CHECK 0..5000 | 300 |
| `updated_at` | UtcDateTime | now |

`message_consents` (one per booking or waitlist entry that opted in)

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `venue_id` | FK venues, index | |
| `booking_id` | FK bookings, NULL | unique index `uq_message_consents_booking` |
| `waitlist_entry_id` | FK waitlist_entries, NULL | unique index `uq_message_consents_waitlist` |
| `channel` | String(10) | `sms` or `whatsapp` |
| `phone_e164` | String(16), NULL | `+351912345678`; NULL after retention or "stop and forget" |
| `phone_hash` | String(64), index | `keyed_hash("phone:" + e164)`; matches replies without reading numbers |
| `consent_at` | UtcDateTime | |
| `consent_version` | String(20) | `MSG_CONSENT_VERSION` |
| `verified_at` | UtcDateTime | when the code was typed |
| `withdrawn_at` | UtcDateTime, NULL | STOP or "Stop messages" |
| `token_version` | Integer, default 0 | bumping it kills the old `/m/` link |
| `action_token_hash` | String(64), NULL, unique | SHA-256 of the derived action token |

CHECK: exactly one of `booking_id`, `waitlist_entry_id` is set (`ck_message_consents_subject`).

`message_outbox` (same life cycle as `email_outbox`, but rendered at send time)

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `idempotency_key` | String(200), UNIQUE | e.g. `msg-reminder_24h-<booking public id>`, `msg-code-<phone code id>-<n>` |
| `venue_id` | FK venues, index | for caps and the owner log |
| `consent_id` | FK message_consents, NULL | NULL only for `phone_code` |
| `channel` | String(10) | |
| `kind` | String(20) | `phone_code`, `booking_confirmed`, `reminder_24h`, `reminder_3h`, `booking_cancelled`, `waitlist_offer`, `reply_ack` |
| `to_phone` | String(16) | E.164; masked to `+351•••••5678` by retention |
| `payload` | Text, NULL | `phone_code` only: the code, blanked (`[code removed]`) as soon as the row is finished |
| `body_preview` | Text, default '' | the text as sent with the link replaced by `[link]`; blanked after 30 days |
| `status` | String(10) | `queued`, `sending`, `sent`, `skipped`, `failed`, `unknown` |
| `attempts` | Integer | |
| `next_attempt_at` | UtcDateTime, index | |
| `sent_at` | UtcDateTime, NULL | |
| `provider_message_id` | String(100), NULL, index | Twilio `SM...` or WhatsApp `wamid...` |
| `delivery_status` | String(12), NULL | `delivered`, `read`, `undelivered`, `failed` (from webhooks) |
| `delivery_at` | UtcDateTime, NULL | |
| `segments` | Integer, default 0 | SMS segments, for the cost estimate |
| `last_error` | Text, NULL | fixed short messages only (avoids S18) |

`phone_codes`

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `verification_hash` | String(64), UNIQUE | `keyed_hash("phone-verify:" + verification_id)`; the id is known only to the browser that asked |
| `venue_id` | FK venues | |
| `channel` | String(10) | |
| `phone_e164` | String(16) | lives at most 10 minutes |
| `code_hash` | String(64) | `keyed_hash("phone-code:" + verification_id + ":" + e164 + ":" + code)` |
| `attempts` | Integer | capped at 5 with one UPDATE ... RETURNING (S40 pattern) |
| `sends` | Integer | resends of this verification, max 3 |
| `expires_at`, `created_at` | UtcDateTime | 10 minutes |

`message_inbound` (replies and button taps; webhook idempotency)

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `channel` | String(10) | |
| `provider_message_id` | String(100), UNIQUE | providers resend webhooks; the second insert is ignored |
| `phone_hash` | String(64), index | never the number itself |
| `received_at` | UtcDateTime | |
| `intent` | String(10) | `confirm`, `cancel`, `stop`, `start`, `help`, `unknown` |
| `outbox_id` | FK message_outbox, NULL | from the WhatsApp button payload |
| `booking_id` | FK bookings, NULL | the booking acted on |
| `result` | String(20) | `confirmed`, `cancelled`, `stopped`, `ambiguous`, `ignored`, `too_late` |

The reply text is never stored, only its intent (open decision Q8).

`message_optouts`

| Column | Type | Notes |
|---|---|---|
| `phone_hash` | String(64), PK | |
| `opted_out_at` | UtcDateTime | |

A STOP blocks every future message to that number from every restaurant until the diner opts in again on a
booking form (which writes a new consent) or replies START.

### 5.3 `migrate.py`

- `NEW_COLUMNS`: the two `bookings` rows above.
- `NEW_INDEXES` / `RESTAURANT_INDEXES`: nothing (all new indexes are on new tables, created with them).
- Test `test_migrate_messaging.py` starts from the current schema without the new parts and runs `upgrade_schema`
  twice.
- Production: back up, then `python -m app.seed.migrate` against Postgres **before** merging (memory rule:
  migrate before the deploy that needs it).

---

## 6. API endpoints

All under `/api`. Bodies use `extra="forbid"` models. Errors are the usual `{"error": {"code", "message"}}`.

### 6.1 Diner (no account)

| Method, path | Auth | Request | Response |
|---|---|---|---|
| `GET /r/{vid}` (changed) | none | | adds `"messaging": {"sms": bool, "whatsapp": bool, "confirmation": bool, "reminders": ["24h","3h"], "waitlist": bool}` |
| `POST /r/{vid}/phone/code` | none; limits 6.6 | `{"phone": "912 345 678", "channel": "whatsapp", "verification_id": str \| null}` | 202 `{"verification_id": "<32 url-safe chars>", "sent_to": "+351 912 ••• 678", "channel": "whatsapp", "expires_in_seconds": 600, "resend_after_seconds": 30, "demo_code": "482913"?}`; 422 `invalid_phone` (copy in 3.1); 409 `channel_off`; 429 |
| `POST /r/{vid}/phone/verify` | none; limits | `{"verification_id": str, "code": "482913"}` | 200 `{"phone_proof": str, "phone_display": "+351 912 345 678", "channel": "whatsapp", "expires_at": iso}`; 422 wrong code with tries left; 404 expired |
| `POST /r/{vid}/bookings` (changed) | none | `BookingIn` gains `"messages": {"phone_proof": str, "consent": true} \| null` (`consent: Literal[True]`) | unchanged, plus `"messages": {"channel", "phone_masked", "planned": ["reminder_24h", "reminder_3h"]} \| null` |
| `POST /r/{vid}/waitlist` (changed) | none | `WaitlistIn` gains the same optional `messages` | unchanged plus `"messages"` |
| `GET /b/{token}/messages` | manage token | | `{"channel", "phone_masked", "planned": [{"kind", "at"}], "can_add": bool}` |
| `PUT /b/{token}/messages` | manage token | `{"phone_proof": str, "consent": true}` | same as GET; 409 if the booking is not `confirmed` or starts within 4 h |
| `DELETE /b/{token}/messages` | manage token | | 204; withdraws, nulls `phone_e164`, skips queued rows |
| `GET /m/{action_token}` | action token | | `{"kind": "booking", "restaurant": {"public_id", "name", "address", "phone"}, "date", "time", "party_size", "tables": ["4"], "status", "reconfirmed_at", "can_act": bool}` or `{"kind": "waitlist_offer", "book_path": "/r/<vid>?date=..&time=..&party=.."}`; 404 for wrong, old or finished links |
| `POST /m/{action_token}/confirm` | action token | `{}` | 200 same shape; idempotent |
| `POST /m/{action_token}/cancel` | action token | `{}` | 200 same shape; 409 `deadline_passed` after the start; runs `manage_flow.cancel_booking(actor="diner-message")` |
| `POST /m/{action_token}/stop` | action token | `{}` | 204 |

The phone proof is stateless: `"{expiry}.{channel}.{e164}.{venue public id}.{signature}"` where the signature is
`keyed_hash("phone-proof:" + verification_hash + ...)`; the request that uses it must also send
`verification_id` inside `messages` so a proof copied out of one browser cannot be used without it. The proof lives
30 minutes. (Stateless like the session tokens in `security.py`; no table write.)

### 6.2 Webhooks and cron (internal)

| Method, path | Auth | Notes |
|---|---|---|
| `POST /internal/messages/process` | `X-Cron-Secret` (same `_check_cron_secret` logic, copied into the new router to keep `routers/emails.py` unchanged) | Sends due messages within a 20 s budget, scrubs expired rows, deletes expired `phone_codes`, nulls old consent numbers. Returns `{"sent", "skipped", "retrying", "failed", "unknown"}` |
| `POST /internal/messages/twilio/status?row={id}` | `X-Twilio-Signature` (HMAC-SHA1 of the full public URL plus the sorted form fields, keyed with `TWILIO_AUTH_TOKEN`) | Sets `delivery_status`; a row in `unknown` whose status arrives becomes `sent` |
| `POST /internal/messages/twilio/inbound` | `X-Twilio-Signature` | Only used when a two-way number is configured; answers empty TwiML `<Response/>` and queues a `reply_ack` |
| `GET /internal/messages/whatsapp` | `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN` (constant-time) | Meta's subscription handshake: answers `hub.challenge` as text |
| `POST /internal/messages/whatsapp` | `X-Hub-Signature-256` = `sha256=` HMAC-SHA256 of the raw body with `WHATSAPP_APP_SECRET` | `statuses[]` -> delivery; `messages[]` (button replies and text) -> intents |

Every webhook: rate limited 300/min per address, refuses with 401 when its secret is not configured (an empty
secret never means "anyone"), reads the raw body before parsing (signature first), always answers 200 quickly
after a valid signature (providers retry on errors; duplicates are absorbed by `message_inbound` UNIQUE).

### 6.3 Owner and staff

| Method, path | Auth | Request / response |
|---|---|---|
| `GET /owner/restaurants/{vid}/messaging` | `CurrentOrganiser` + `profiles.load` (owner-only, 404 otherwise) | `{"settings": {...5.2 fields}, "providers": {"sms": "log"\|"twilio", "whatsapp": "log"\|"meta", "sms_two_way": bool}, "month": {"sent": 212, "estimated_cost_eur": 6.4, "cap": 300}, "preview": {"sms": str, "whatsapp": {"body": str, "buttons": [...]}}}` |
| `PUT /owner/restaurants/{vid}/messaging` | same | `{"sms_enabled", "whatsapp_enabled", "send_confirmation", "reminder_24h", "reminder_3h", "waitlist_offers", "monthly_cap"}` -> same as GET; switching a channel off skips its queued rows |
| `GET /owner/restaurants/{vid}/messaging/log?limit=50` | same | `[{"id", "kind", "channel", "to": "+351 9•• ••• 678", "status", "delivery_status", "sent_at", "next_attempt_at", "reason"}]`, never `body_preview` with links, never `payload` |
| `GET /staff/{vid}/dashboard` (changed) | `CurrentUser` + `load_for_staff` | adds `"messaging": {"enabled": bool, "with_reminders": {"no_shows", "finished", "rate"}, "email_only": {...}, "reconfirmed_rate", "released_by_reminder", "enough_data": bool, "simulated": bool}` |
| `GET /staff/{vid}/floor` (changed) | same | each occupied table adds `"reconfirmed_via": "whatsapp"\|"sms"\|"link"\|null`, `"reconfirmed_at"`, `"reminded": bool` |
| `GET /b/{token}`, staff `describe` (changed) | | `booking_rows.describe` adds `reconfirmed_at`, `reconfirmed_via` |

### 6.4 The action token (`/m/...`)

`token = base64url(HMAC-SHA256(SECRET_KEY, "msg-action:" + kind + ":" + subject public id + ":" + token_version))[:22]`
(132 bits). We store only `sha256(token)` in `message_consents.action_token_hash` for the lookup; because it can be
derived again, a reminder rendered at send time can carry it without the raw token ever being stored (the same
idea as the shared event link, S41, accepted). It can only confirm, cancel or stop one booking, and it dies when
the booking ends, is cancelled, the diner stops messages (`token_version + 1`) or `SECRET_KEY` changes. A 22-char
token keeps every SMS to one segment; the manage token (43 chars) would not.

---

## 7. Backend modules and functions

### 7.1 New package `backend/app/messaging/` (generic, no restaurant logic; mirrors `mail/`)

| File | Functions | Pure? |
|---|---|---|
| `READ_ME_FIRST.md` | Purpose, key functions, data flow, three walkthrough questions (house style) | |
| `phone.py` | `normalise_pt_mobile(raw) -> str` (accepts `912345678`, `+351 912 345 678`, `00351 912345678`, `(+351) 91-234-5678`; raises `PhoneError(code, message)`), `is_pt_mobile(e164)` (`+3519[1236]` and 9 digits), `display_phone(e164)` -> `+351 912 345 678`, `mask_phone(e164)` -> `+351 912 ••• 678` | yes |
| `gsm.py` | `is_gsm7(text)`, `segments(text) -> (encoding, count)` (GSM-7 160/153, extended chars count 2; UCS-2 70/67) | yes |
| `templates.py` | `MessageFacts` dataclass (venue name, day word, date text, time, party, table, link, venue phone), `MessageParts(sms_text, wa_template, wa_params, wa_buttons)`, `phone_code`, `booking_confirmed`, `reminder(kind, two_way)`, `booking_cancelled`, `waitlist_offer`, `reply_ack(intent)`, `fit_venue_name(name, budget)` | yes |
| `replies.py` | `intent_of(text) -> Intent` (case and accent folded: YES, Y, SIM, S, OK, 1, CONFIRM -> confirm; CANCEL, CANCELAR, CANCELA, 2 -> cancel; STOP, PARAR, STOPALL, UNSUBSCRIBE -> stop; START -> start; HELP, AJUDA -> help; else unknown; STOP anywhere in a short message wins), `button_intent(payload)` | yes |
| `signatures.py` | `twilio_signature_ok(auth_token, url, params, given)`, `meta_signature_ok(app_secret, raw_body, header)`; constant-time compares | yes |
| `providers.py` | `OutgoingMessage`, `MessageProvider` Protocol (`send(msg) -> str`, `supports_replies`), `ProviderError`, `AmbiguousSend(ProviderError)`, `LogProvider` (one masked log line, no body), `TwilioSmsProvider(account_sid, auth_token, sender, status_url)` (httpx `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`, basic auth, form `To`, `From` or `MessagingServiceSid`, `Body`, `StatusCallback`), `MetaWhatsAppProvider(token, phone_number_id, api_version)` (httpx `POST https://graph.facebook.com/{version}/{phone_number_id}/messages`, Bearer, JSON `messaging_product: "whatsapp"`, `type: "template"` with body and button components, or `type: "text"` inside the window), `providers_from_settings(settings) -> dict[str, MessageProvider]` | provider classes are thin; `_payload` methods are pure |
| `outbox.py` | `enqueue_message(session, *, key, venue_id, channel, kind, to_phone, consent_id=None, send_after=None, payload=None)` (insert-or-ignore via `db.insert_ignoring_duplicates`, no commit), `reschedule(session, key, send_after)`, `skip_queued(session, where, reason)`, `process_due_messages(session, providers, render, now, budget_s=20, batch=40)`, `send_message_now(session, providers, render, key, now)`, `scrub_expired_messages(session, now)` | DB |

`outbox.py` imports `MAX_ATTEMPTS`, `CLAIM_LEASE`, `RETENTION_DAYS`, `backoff_delay` and `CODE_REMOVED` from
`app/mail/outbox.py` (read-only reuse) and copies the 15-line `_claim` pattern for the new table. `mail/outbox.py`
is not edited, so event emails cannot change.

Differences from email, on purpose:

- **Rendered at send time.** A row stores ids and the kind, not the words. `render(session, row)` (supplied by the
  restaurant side) loads the booking and returns the message or a skip reason: booking no longer `confirmed`,
  consent withdrawn or number forgotten, number on `message_optouts`, restaurant channel or kind switched off,
  monthly cap reached, reminder stale, not on `MESSAGE_ALLOWLIST`. So a changed booking's reminder always shows the
  new time, and no queued row ever holds a link (S9 by design).
- **At most once on an ambiguous error.** Twilio and Meta document no idempotency key for sending
  **[verify before go-live]**. A connect error (nothing reached the provider) is retried with `backoff_delay`; a read
  timeout after the request was written ends as `unknown` and is not retried (a missed reminder is better than a
  doubled paid message). The Twilio status callback or WhatsApp status webhook can still move it to `sent`.
- **Time budget.** The Vercel function has 30 s; the processor stops claiming new rows after 20 s and each HTTP
  call has a 5 s timeout.
- **Caps before sending**: the restaurant's `monthly_cap` (count of `sent` + `unknown` rows this calendar month,
  Lisbon time) and an app-wide `MESSAGING_APP_HOURLY_CAP` (default 300). A capped row is `skipped` with the reason;
  the email still goes, so the diner is never left without a confirmation or reminder.

### 7.2 Restaurant side (`backend/app/restaurant_service/`)

| New file | Functions |
|---|---|
| `message_settings.py` | `load_settings(session, venue) -> VenueMessageSettings` (defaults when no row), `save_settings(...)`, `public_messaging(settings, providers) -> dict`, `month_usage(session, venue, now)`, `estimated_cost_eur(rows)` (pure, rates from 10.2) |
| `message_times.py` (pure) | `reminder_times(start_utc, booked_at_utc, zone, settings, now) -> list[tuple[str, datetime]]`, `in_quiet_hours(local)`, `is_stale(kind, start_utc, now)` |
| `phone_verification.py` | `start(session, request, venue, raw_phone, channel, verification_id) -> (row, code, verification_id)`, `verify(session, request, venue, verification_id, code) -> str` (proof), `make_proof(...)`, `read_proof(proof, verification_id, venue) -> VerifiedPhone` (pure apart from the key), `may_show_code(settings)` (DEMO_MODE and both providers `log`) |
| `message_facts.py` | `facts_for_booking(session, venue, booking, link) -> MessageFacts`, `facts_for_waitlist(...)` (reuses `templates.format_when` style and `clock.local_datetime`, `booking_rows.table_labels`) |
| `messages.py` (like `emails.py`) | `record_consent(session, venue, *, booking=None, entry=None, phone) -> MessageConsent`, `sync_booking_messages(session, venue, booking)` (the one entry point: queue or reschedule `reminder_24h`/`reminder_3h`, skip what no longer applies; called after confirm, change, cancel, no-show), `queue_confirmation_message`, `queue_cancellation_message`, `queue_waitlist_offer_message`, `render(session, row)`, `withdraw(session, consent, forget_number)`, `send_after_commit(session, keys)` (calls `send_message_now`, never raises) |
| `message_actions.py` | `action_token(consent, subject_public_id)`, `load_by_action_token(session, token)`, `summary(session, venue, booking)`, `confirm_attendance(session, venue, booking, via)`, `cancel_by_message(session, venue, booking, via)` (wraps `manage_flow.cancel_booking`, `actor="diner-message"`, then `session.commit()`), `stop(session, consent)` |
| `message_inbound.py` | `handle_inbound(session, event)` (dedupe on `provider_message_id`, find the consent by button payload or by `phone_hash` among bookings reminded in the last 48 h that are still upcoming, one -> act, several -> `ambiguous` + help ack, none -> `ignored`), `handle_status(session, event)` |
| `messaging_stats.py` | `no_show_effect(session, venue, day)` (over `dashboard.HISTORY_DAYS`, diner-source bookings only, walk-ins out) and pure `compare(groups, minimum=30) -> Effect` |

Changes to existing restaurant files (small, each with a test):

| File | Change |
|---|---|
| `diner_flow.py` | `Contact` gains `messages: VerifiedPhone \| None`; `confirm_booking` calls `messages.record_consent` + `sync_booking_messages` + `queue_confirmation_message` before its single commit; fills `Booking.phone` when empty |
| `manage_flow.py` | `change_booking` calls `sync_booking_messages` (reschedules); `cancel_booking` calls `sync_booking_messages` and `queue_cancellation_message` |
| `waitlist.py` | `offer_freed_tables` also calls `queue_waitlist_offer_message` when the entry has a consent; `join` unchanged |
| `staff_floor.py` | `set_status` calls `sync_booking_messages` for closing statuses; `_floor_table` adds `reconfirmed_via`, `reconfirmed_at`, `reminded` |
| `dashboard.py` | `dashboard()` adds `"messaging": messaging_stats.no_show_effect(...)` |
| `booking_rows.py` | `describe` adds `reconfirmed_at`, `reconfirmed_via` |

### 7.3 Routers

| File | Change |
|---|---|
| `routers/messages.py` (new) | Diner phone code routes, `/b/{token}/messages`, `/m/{token}...`, owner settings and log, internal cron and webhooks. Thin: check, call one helper, commit, then `send_after_commit` |
| `routers/restaurants.py` | `GET /r/{vid}` adds `messaging`; `BookingIn.messages`; after the booking, `send_after_commit` |
| `routers/bookings.py` | `WaitlistIn.messages`; `cancel_booking` route calls `send_after_commit` for the cancellation and offer messages |
| `routers/staff.py` | none (dashboard and floor shapes come from the services) |
| `main.py` | register `messages` in the router list |
| `config.py` | new settings (section 10.3) with safe defaults |
| `.github/workflows/email-cron.yml` | a second step calling `/api/internal/messages/process` (same secrets), `continue-on-error` on the first step so one failure does not hide the other |

---

## 8. Frontend components and routes

| File | What |
|---|---|
| `frontend/src/App.tsx` | `<Route path="/m/:token" element={<MessageActionPage />} />`, `<Route path="/owner/:venueId/messages" element={<MessagingSettingsPage />} />` |
| `frontend/src/api/messages.ts` (new) | `sendPhoneCode`, `verifyPhoneCode`, `getBookingMessages`, `addBookingMessages`, `stopBookingMessages`, `getMessageAction`, `confirmByLink`, `cancelByLink`, `stopByLink`, `getMessagingSettings`, `saveMessagingSettings`, `getMessageLog`; `Server...` types and `to...` converters like `api/restaurant.ts` |
| `frontend/src/api/restaurant.ts` | `createBooking` and `joinWaitlist` accept `messages`; `toDashboard` and floor converters carry the new fields; `ContactDetails` unchanged (the proof lives in its own state) |
| `frontend/src/pages/restaurant/PhoneOptIn.tsx` (new) | The opt-in, channel, number, code, verified states of 3.1; props `venueId`, `channels`, `value`, `onChange`, `mode: "booking" \| "manage" \| "waitlist"` |
| `frontend/src/pages/restaurant/phoneInput.ts` (new, pure) | `formatPtMobile`, `ptMobileError`, `maskPhone`, `resendCountdown` (mirrors the server rules for instant feedback; the server decides) |
| `frontend/src/pages/restaurant/StepDetails.tsx` | renders `PhoneOptIn`; submit refuses "ticked but not verified"; passes `messages` to `createBooking` |
| `frontend/src/pages/restaurant/useBookingFlow.ts` | keeps the verified proof with the contact, so going back to the map does not lose it |
| `frontend/src/pages/restaurant/Confirmation.tsx` | the reminders line (3.2) |
| `frontend/src/pages/restaurant/MessageActionPage.tsx` (new) | `/m/:token` (3.3); reuses `VenueCard`'s `DirectionsLink`, `Dialog`, `Badge`, `PageShell` |
| `frontend/src/pages/restaurant/BookingMessagesCard.tsx` (new) | the manage page card (3.4) |
| `frontend/src/pages/restaurant/ManageBookingPage.tsx` | renders `BookingMessagesCard` |
| `frontend/src/pages/restaurant/WaitlistDialog.tsx` | the waitlist opt-in (3.5) |
| `frontend/src/pages/restaurant/staffStatus.ts`, `FloorLists.tsx`, `SelectionPanel.tsx` | the "Coming" / "Reminded, no answer" badge (3.6); the rule is pure in `staffStatus.ts` |
| `frontend/src/pages/restaurant/StaffDashboard.tsx` | `RemindersCard` (3.7) |
| `frontend/src/pages/owner/MessagingSettingsPage.tsx` (new) | 3.8; uses `OwnerShell` |
| `frontend/src/pages/owner/messagingCost.ts` (new, pure) | monthly estimate from counts and the rates the server sends |
| `frontend/src/pages/owner/OwnerHomePage.tsx`, `OwnerShell.tsx` | link "Guest messages" |
| `frontend/src/pages/restaurant/READ_ME_FIRST.md`, `frontend/src/pages/owner/READ_ME_FIRST.md`, `frontend/src/api/READ_ME_FIRST.md` | new rows |

`frontend/src/pages/room-editor/` (Sergio) is **not touched**. No event pages are touched. No new dependency.

---

## 9. Security, privacy and abuse

### 9.1 Threats and answers

| Threat | Answer |
|---|---|
| Someone types a stranger's number to spam them | No message except the code goes to an unverified number; the code message itself is limited per number (3/hour, 5/day) and carries no restaurant text or link |
| SMS pumping / toll fraud (bots trigger codes to premium or foreign numbers the attacker is paid for) | +351 mobiles only (`+3519[1236]`, 9 digits), checked before any limit or send; Twilio Geo Permissions set to Portugal only; app-wide hourly cap; per-network limits; the cost of a burst is bounded by `MESSAGING_APP_HOURLY_CAP` x price |
| Guessing a code | 6 digits, 10 min, 5 tries per code counted atomically (S40 pattern), 100 checks per 10 min per network; code bound to a `verification_id` only the asking browser has (like `signup_hash`) |
| Reusing a proof for another number, booking or restaurant | The proof signs channel, number, venue and verification hash and lasts 30 min; the request must also carry the `verification_id` |
| Forged webhook ("YES" for someone else's booking, fake delivery) | Twilio HMAC-SHA1 and Meta HMAC-SHA256 checked on the raw body before parsing; empty secrets refuse; the reply must come from the consent's `phone_hash`; button payloads carry the outbox id and are cross-checked with the phone |
| Replay of a webhook | `message_inbound.provider_message_id` UNIQUE; confirm and cancel are idempotent |
| Forwarded or leaked `/m/` link | It can confirm, cancel or stop one booking, nothing else; no name, email or notes on the page; dies with the booking; 30/min per address like `MANAGE_LIMIT`; same 404 for wrong and expired |
| Accidental cancel by reply | Only the exact words in `replies.py`; WhatsApp "Cancel booking" is a button the diner taps; the ack says what happened and links to book again (Q6 offers a two-step cancel) |
| Secrets in logs | Providers' `__repr__` hide tokens; `last_error` keeps fixed messages and HTTP status only (fixes the S18 pattern for this table); `LogProvider` logs masked number, kind, segment count, never the text |
| Cost runaway | Per-restaurant monthly cap (default 300, max 5000), app hourly cap, confirmation off by default, SMS link-only (no US$135/month number) |
| Demo sends to real people | `MESSAGE_ALLOWLIST` (E.164 list, empty = nobody), default providers `log`, `demo_code` only when both providers are `log` and `DEMO_MODE=1` |

### 9.2 GDPR

- **Consent**: separate, unticked checkbox with its own text; `consent_at` and `consent_version` stored per
  consent; the restaurant's switch alone never sends anything. The legal basis for the reminders is consent
  (Art. 6(1)(a)); the email confirmation stays as today (contract).
- **Minimisation**: messages carry no diner name; the `/m/` page shows no name, email or notes; replies are kept as
  an intent, never as text; the owner log masks numbers; rate-limit keys stay keyed hashes (S7).
- **Retention**: `phone_codes` deleted at expiry by the cron; `message_outbox.payload` blanked when finished,
  `to_phone` masked and `body_preview` blanked 30 days after `sent_at` (same `RETENTION_DAYS`);
  `message_consents.phone_e164` set to NULL 30 days after the booking date (waitlist: the day after);
  `message_inbound` rows deleted after 90 days (enough for the dashboard's 90-day window, which only needs
  `reconfirmed_at` on bookings); `message_optouts` kept until START (a keyed hash, no number).
- **Withdrawal and deletion**: STOP, "Stop messages" on `/m/` and on the manage page all withdraw, skip queued
  rows and null the number at once (`withdraw(forget_number=True)`).
- **Processors**: Twilio (SMS) and Meta (WhatsApp) become sub-processors; DPAs, transfer basis and the privacy
  notice are Martim's steps (10.1). `docs/security.md` section 6 (GDPR) gets a messaging paragraph; S23 (no
  general retention) stays open but this feature does not widen it.

### 9.3 Limits (constants in `phone_verification.py` and `routers/messages.py`)

| Limit | Value |
|---|---|
| Code sends per number | 3 per hour, 5 per day |
| Code sends per network (`network_of`) | 10 per hour, 30 per day |
| Code sends per verification id | 3 |
| Code checks per network | 100 per 10 min |
| Code sends app-wide | 200 per hour |
| All messages app-wide | `MESSAGING_APP_HOURLY_CAP`, default 300 per hour |
| Messages per restaurant | `monthly_cap`, default 300, 0..5000 |
| `/m/` and `/b/{token}/messages` | 30 per minute per address |
| Webhooks | 300 per minute per address |
| Upcoming bookings with messages per number | 4 (same as `MAX_UPCOMING_PER_EMAIL`) |

---

## 10. External services: provider interface, accounts, cost, legal

### 10.1 What Martim must do before switching a real provider on

Nothing below is needed for the demo; defaults are the `log` providers.

SMS (Twilio), recommended first:
1. Create a Twilio account (company or personal), add a payment method and upgrade from trial (a trial only sends
   to verified numbers).
2. Messaging > Settings > Geo permissions: allow **Portugal only**.
3. Create a Messaging Service with alphanumeric sender **SeatPlan** (max 11 characters; no pre-registration for
   Portugal per Twilio's guidelines page). Optional and costly: a Portuguese mobile number (about US$135/month,
   regulatory bundle) only if two-way SMS replies are wanted (Q2).
4. Put `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` in Vercel environment variables
   (never in the repo); set `MESSAGING_SMS_PROVIDER=twilio`; keep `MESSAGE_ALLOWLIST` to the team's numbers for a
   test week.

WhatsApp (Meta Cloud API):
1. Meta Business account and **business verification** (company documents; a sole trader may need extra proof).
2. Create an app at developers.facebook.com with the WhatsApp product; add a phone number that is not used in the
   WhatsApp app (a landline that can receive a voice code works); get the display name approved ("SeatPlan").
3. Submit the five templates in section 4 (utility; `seatplan_code_v1` as authentication), language `en`; wait for
   approval. The URL button base (`https://<domain>/m/`) is fixed in the template, so a domain change needs new
   templates.
4. Create a system user with a permanent token (`whatsapp_business_messaging` permission); set
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
   `MESSAGING_WHATSAPP_PROVIDER=meta`; subscribe the webhook to `https://<domain>/api/internal/messages/whatsapp`
   (fields `messages`).
5. Add a payment method in WhatsApp Manager.

Legal (Portugal / EU):
1. Privacy notice: add phone messages, purposes, Twilio and Meta as processors, retention (30 days), withdrawal.
2. DPAs: accept Twilio's and Meta's data processing terms; both are US companies, so transfers rely on the EU-US
   Data Privacy Framework or SCCs **[verify each one's current certification]**.
3. Decide the controller roles with restaurants (restaurant controller, SeatPlan processor, or joint) and put it in
   the restaurant terms.
4. Record of processing activities (Art. 30) entry "booking messages".
5. Keep it transactional: no marketing in these messages (marketing would need its own consent under Portugal's
   Lei 41/2004 and Meta's marketing category).
6. WhatsApp Business Policy: the opt-in must name the business and the channel (the checkbox text does).

### 10.2 Cost (estimates; list prices on 2026-11-17)

| Item | Unit | Price |
|---|---|---|
| SMS to a Portuguese mobile (Twilio) | per segment | US$0.0501 (≈ €0.047) |
| WhatsApp utility or authentication template, Portugal | per delivered message | about US$0.0197 (≈ €0.018) **[third-party figure]** |
| WhatsApp replies from diners | | free |
| WhatsApp free-form replies inside the 24 h window | | first 1,000/month per number free |
| Portuguese two-way SMS number (optional) | per month | US$135 |
| Meta, Twilio accounts | | free to open |

Per opted-in booking with defaults (code + 24 h + 3 h, no confirmation): SMS 3 x €0.047 ≈ **€0.14**;
WhatsApp 3 x €0.018 ≈ **€0.06**. A restaurant with 600 bookings a month and 40% opting in: 240 bookings ≈
€34 (SMS) or €13 (WhatsApp) a month; the default cap of 300 messages bounds a restaurant at about €14 (SMS). The
owner page shows the estimate; rates live in `message_settings.RATES_EUR` and are documented as estimates.

### 10.3 Environment variables (all in `config.py`)

| Variable | Default | Meaning |
|---|---|---|
| `MESSAGING_SMS_PROVIDER` | `log` | `log` or `twilio` |
| `MESSAGING_WHATSAPP_PROVIDER` | `log` | `log` or `meta` |
| `MESSAGE_ALLOWLIST` | empty (nobody) | comma list of E.164 numbers that may receive messages, like `EMAIL_ALLOWLIST`; `*` allowed only when both providers are real (open decision Q9) |
| `MESSAGING_APP_HOURLY_CAP` | 300 | |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | empty | |
| `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_SMS_FROM` | empty | service (alphanumeric) or a number (two-way) |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | empty | |
| `WHATSAPP_API_VERSION` | `v23.0` **[check the current Graph version when setting up]** | |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `en` | |

A real provider with missing secrets makes `providers_from_settings` raise `ValueError`; the cron reports it and
the request paths fall back to "could not send the code" (like `accounts.send_at_once`).

---

## 11. Tests to add (tests first for pure logic and security)

pytest, `backend/tests/`:

- `test_messaging_phone.py`: `test_normalise_accepts_portuguese_formats`, `test_rejects_landlines_and_special_numbers` (21x, 22x, 707, 760, 800), `test_rejects_foreign_numbers_in_v1`, `test_display_and_mask`.
- `test_messaging_gsm.py`: `test_gsm7_single_and_multi_segment_limits`, `test_accent_switches_to_ucs2`, `test_extended_characters_count_twice`.
- `test_messaging_templates.py`: `test_every_sms_template_is_gsm7_and_one_segment` (longest demo name, 40-char base URL), `test_long_venue_name_is_shortened_never_the_link`, `test_two_way_reminder_mentions_reply_only_when_supported`, `test_no_template_contains_the_diner_name`, `test_whatsapp_params_have_no_newlines_or_tabs`.
- `test_messaging_replies.py`: `test_confirm_words`, `test_cancel_words_with_and_without_accents`, `test_stop_wins_over_other_words`, `test_unknown_text`, `test_button_payload_intent`.
- `test_messaging_times.py`: `test_24h_and_3h_reminders`, `test_late_booking_skips_24h`, `test_very_late_booking_gets_none`, `test_quiet_hours_move_or_drop`, `test_daylight_saving_night`, `test_stale_at_send_time`.
- `test_messaging_signatures.py`: `test_twilio_signature_matches_documented_example`, `test_twilio_signature_rejects_changed_field`, `test_meta_signature_ok_and_bad`, `test_empty_secret_never_validates`.
- `test_messaging_providers.py`: `test_twilio_payload_with_fake_transport`, `test_meta_template_payload_with_buttons`, `test_repr_hides_secrets`, `test_errors_store_status_not_body`, `test_read_timeout_is_ambiguous`, `test_defaults_are_log_providers`.
- `test_messaging_outbox.py`: `test_enqueue_is_idempotent`, `test_two_processors_send_each_message_once` (threads, as the email test), `test_not_on_allowlist_is_skipped`, `test_connect_error_retried_with_backoff`, `test_ambiguous_timeout_not_retried`, `test_render_at_send_skips_cancelled_booking`, `test_render_uses_current_time_after_change`, `test_monthly_cap_skips_and_email_still_queued`, `test_app_hourly_cap`, `test_time_budget_stops_claiming`, `test_code_payload_blanked_when_finished`, `test_scrub_masks_phone_after_30_days`, `test_optout_blocks_every_restaurant`.
- `test_phone_verification.py`: `test_send_limits_per_number_network_and_app`, `test_code_tries_capped_under_concurrency`, `test_code_bound_to_verification_id`, `test_proof_bound_to_phone_channel_venue`, `test_expired_proof_rejected`, `test_demo_code_only_with_log_providers_in_demo_mode`, `test_foreign_number_refused_before_counting`, `test_channel_off_is_409`.
- `test_restaurant_messages_flow.py`: `test_booking_without_messages_is_unchanged`, `test_booking_with_proof_queues_both_reminders`, `test_booking_fills_empty_phone_field`, `test_change_reschedules_reminders`, `test_cancel_skips_queued_and_sends_cancellation`, `test_staff_no_show_skips_queued`, `test_waitlist_offer_sent_at_once`, `test_restaurant_switched_off_sends_nothing`, `test_upcoming_bookings_per_number_cap`.
- `test_message_actions.py`: `test_confirm_sets_reconfirmed`, `test_confirm_is_idempotent`, `test_cancel_frees_table_and_offers_waitlist`, `test_cancel_after_start_refused`, `test_action_token_cannot_change_or_read_personal_data`, `test_wrong_and_old_tokens_are_the_same_404`, `test_stop_withdraws_forgets_number_and_kills_link`.
- `test_message_webhooks.py`: `test_whatsapp_handshake`, `test_whatsapp_yes_button_confirms`, `test_duplicate_webhook_handled_once`, `test_reply_from_other_number_ignored`, `test_two_upcoming_bookings_reply_is_ambiguous`, `test_twilio_stop_adds_optout`, `test_status_callback_reconciles_unknown`, `test_unsigned_webhook_401`.
- `test_messaging_owner_settings.py`: `test_owner_only_other_owner_404`, `test_staff_role_403`, `test_cap_bounds`, `test_switching_channel_off_skips_queued`, `test_log_masks_numbers_and_hides_links`.
- `test_messaging_dashboard.py`: `test_no_show_split_by_reminder`, `test_not_enough_data_below_30`, `test_walkins_and_staff_bookings_excluded`, `test_floor_shows_reconfirmed`.
- `test_migrate_messaging.py`: `test_migrate_adds_columns_and_tables_twice_without_change`.
- Regression: the whole existing suite, especially `test_mail_outbox.py`, `test_outbox.py`, `test_restaurant_emails.py`, `test_bookings_manage.py`, and every event test, unchanged and green.

vitest, `frontend/src/`:

- `pages/restaurant/phoneInput.test.ts`: formats, errors, mask, resend countdown.
- `pages/restaurant/PhoneOptIn.test.tsx`: `unticked by default`, `only the restaurant's channels are offered`, `send code then verify shows Verified`, `landline error copy`, `submit while unverified focuses the code`.
- `pages/restaurant/MessageActionPage.test.tsx`: `confirm shows Confirmed`, `cancel asks first and Keep booking is focused`, `already confirmed state`, `old link copy`.
- `pages/restaurant/StaffDashboard.test.tsx` (or a new `RemindersCard.test.tsx`): `not enough data copy`, `two rates with sample sizes`.
- `pages/restaurant/staffStatus.test.ts`: `coming and reminded badges`.
- `pages/owner/MessagingSettingsPage.test.tsx`: `toggles save`, `cap validation`, `demo banner`; `pages/owner/messagingCost.test.ts`.

Playwright, `frontend/e2e/restaurant-messages.spec.ts` (own restaurant prepared through `restaurant-fixture.ts`
style real APIs; no shared demo mutation):

- `diner opts in with the demo code and books at 1440 and 390 px` (no sideways scroll at 390).
- `owner switches WhatsApp on and sees the message in the log`.
- `the demo /m/ link confirms, and cancel frees the table on the staff floor`.
- axe (WCAG 2.1 A/AA) on `/m/:token` and `/owner/:venueId/messages`; the CSP-violation rule in `fixtures.ts` applies.

Checks from `AGENTS.md`: ruff check and format, pytest, typecheck, vitest, build, contrast, e2e, and
`scripts/check_forbidden_paths.py --base main`.

---

## 12. Files touched

New:

- `backend/app/messaging/__init__.py`, `READ_ME_FIRST.md`, `phone.py`, `gsm.py`, `templates.py`, `replies.py`, `signatures.py`, `providers.py`, `outbox.py`
- `backend/app/restaurant_service/message_settings.py`, `message_times.py`, `phone_verification.py`, `message_facts.py`, `messages.py`, `message_actions.py`, `message_inbound.py`, `messaging_stats.py`
- `backend/app/routers/messages.py`
- `backend/tests/test_messaging_*.py`, `test_phone_verification.py`, `test_restaurant_messages_flow.py`, `test_message_actions.py`, `test_message_webhooks.py`, `test_migrate_messaging.py`
- `frontend/src/api/messages.ts`
- `frontend/src/pages/restaurant/PhoneOptIn.tsx`, `phoneInput.ts`, `MessageActionPage.tsx`, `BookingMessagesCard.tsx` and their tests
- `frontend/src/pages/owner/MessagingSettingsPage.tsx`, `messagingCost.ts` and tests
- `frontend/e2e/restaurant-messages.spec.ts`
- `docs/messaging.md` (provider setup, templates, costs, runbook)

Changed (shared with other features marked **shared**):

- `backend/app/models.py` **shared** (two `Booking` columns, six new restaurant tables; no event table changes)
- `backend/app/seed/migrate.py` **shared** (two `NEW_COLUMNS` rows)
- `backend/app/config.py` **shared** (new fields with defaults)
- `backend/app/main.py` **shared** (register the router)
- `backend/app/routers/restaurants.py`, `routers/bookings.py` (**shared** by every diner-flow feature)
- `backend/app/restaurant_service/diner_flow.py`, `manage_flow.py`, `waitlist.py`, `staff_floor.py`, `dashboard.py`, `booking_rows.py` (**shared** by other restaurant features)
- `backend/app/restaurant_service/READ_ME_FIRST.md`, `backend/app/routers/READ_ME_FIRST.md`, `backend/app/seed/READ_ME_FIRST.md`
- `backend/app/seed/demo_restaurant.py` (demo data, 13)
- `.github/workflows/email-cron.yml` **shared** (second step)
- `frontend/src/App.tsx` **shared**, `frontend/src/api/restaurant.ts` **shared**
- `frontend/src/pages/restaurant/StepDetails.tsx`, `useBookingFlow.ts`, `Confirmation.tsx`, `ManageBookingPage.tsx`, `WaitlistDialog.tsx`, `StaffDashboard.tsx`, `FloorLists.tsx`, `SelectionPanel.tsx`, `staffStatus.ts`, `READ_ME_FIRST.md` (**shared** with other diner/staff features)
- `frontend/src/pages/owner/OwnerHomePage.tsx`, `OwnerShell.tsx`, `READ_ME_FIRST.md`
- `docs/email.md` (section 8: the second cron step), `docs/security.md` (new findings rows and GDPR paragraph), `docs/api.md`, `docs/data-model.md`, `docs/user-guide-diner.md`, `docs/user-guide-owner.md`, `docs/user-guide-staff.md`, `docs/product-spec.md` (SMS no longer a non-goal)

Not touched: `backend/app/mail/*` (imported only), every events path, `frontend/src/pages/room-editor/`,
`vercel.json` (no CSP change: browsers never call Twilio or Meta).

---

## 13. Rollout and demo data

1. **Phase A (M)**: data model, migrate, `messaging/` pure modules, log provider, outbox with render-at-send, phone
   verification, reminders, `/m/` page, owner page, dashboard card, demo seed. Everything works end to end in
   the demo with nothing sent.
2. **Phase B (M)**: Twilio SMS provider and status callback; WhatsApp Cloud provider, webhook, buttons and replies;
   optional two-way SMS inbound.
3. Before merge: back up Postgres, run `python -m app.seed.migrate`, then merge (deploy by GitHub Actions on
   `main`). Set `CRON_SECRET` already present; no new GitHub secret.
4. Switch-on order in production: Twilio with `MESSAGE_ALLOWLIST` = team numbers for one week, then one pilot
   restaurant, then open `MESSAGE_ALLOWLIST=*`; WhatsApp after template approval.
5. Kill switch: set the provider variable back to `log` (messages become `skipped`/logged; email unaffected).

Demo seed (`demo_restaurant.py`, deterministic `random.Random(2026)`):

- Casa Lumen gets `venue_message_settings` with WhatsApp and SMS on, confirmation off, both reminders on.
- About 45% of its past diner bookings (two weeks of history) get a consent with fictional numbers
  `+351 910 000 0xx`, `sent` reminder rows (log provider), `reconfirmed_at` on about 60% of those, and statuses
  chosen so the card shows roughly 4% no-shows with reminders against 11% email-only; enough rows for 30+ per group.
  The dashboard marks it **Simulated history** (`simulated: true` when `venue.is_demo`).
- Two upcoming bookings get queued reminders, and a `demo_links` row `restaurant_message_action` -> `/m/<token>` so
  reviewers can open the link page from `/demo`.
- The 20 Lisbon catalogue restaurants keep messaging off.

---

## 14. Open decisions for Martim (each with a recommended default)

| # | Question | Recommended default |
|---|---|---|
| Q1 | Which channel first? | SMS through Twilio first (no business verification wait), WhatsApp as soon as Meta approves the templates |
| Q2 | Two-way SMS (replies YES/CANCEL) needs a Portuguese number at about US$135/month | No: SMS is one-way from "SeatPlan" with the link; replies only on WhatsApp |
| Q3 | Foreign numbers | Portuguese mobiles only in v1 (fraud and cost); add an EU list later |
| Q4 | Language of messages | English like the app; Portuguese (`pt_PT` templates) as the next step |
| Q5 | Keep the email reminder when a phone reminder is set? | Keep both (the email has the map and the calendar invite) |
| Q6 | Cancel in one tap/reply or two steps? | One step, with a clear ack and a "book again" link |
| Q7 | Remember a verified number for signed-in diners (`GuestAccount`, shared with events)? | Not in v1 |
| Q8 | Store the text of free replies for staff ("running 10 min late")? | No, intent only; the help ack gives the restaurant's phone |
| Q9 | When to open `MESSAGE_ALLOWLIST` to everyone | After one test week and one pilot restaurant |
| Q10 | Who pays: SeatPlan absorbs, or restaurants are billed? | SeatPlan absorbs during the pilot, bounded by the 300-message monthly cap |
| Q11 | A hold-out group (1 in 10 opted-in bookings gets no phone reminder) to measure the real effect | Off; show the comparison with its caveat first |
| Q12 | Booking confirmation by phone message | Off by default per restaurant (email already confirms) |

---

## 15. Size and effort

**L** overall, built as two M phases. Rough effort for one developer: Phase A about 6 days (backend 3.5,
frontend 2, tests and docs inside), Phase B about 4 days (providers 1.5, webhooks and replies 1.5, live testing with
real accounts 1). Plus Martim's account and legal steps, which can take one to three weeks for Meta business
verification and template approval, in parallel.

Risks: Meta verification or template rejection delays WhatsApp; prices change quarterly (Meta) or without notice
(Twilio); GitHub cron delays make reminders late; no provider idempotency key means an ambiguous timeout drops a
reminder; self-selection makes the no-show comparison look better than the real effect; many shared files with
other diner-flow features (merge order matters); legal role (controller/processor) unclear until restaurant terms
exist.
