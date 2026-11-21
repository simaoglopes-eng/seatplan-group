# Running late / On my way: design

Date: 2026-11-17. Status: design only, nothing implemented. Branch: `codex/restaurantes-ux`.
Mockup: `scratchpad/features/running-late.html` (manage page on a phone, staff floor on a laptop, owner policy card).

## 1. Goal

A diner who will be late tells the restaurant in one tap from the manage link (`/b/{token}`). Staff see it live
on the floor, on the booking and in the arrivals list, with a countdown to the end of the restaurant's hold time.
The restaurant's hold time (grace policy) is shown to the diner before they need it. Optionally, when the hold
ends and the party is not seated, the table is released automatically and offered to the waitlist with the
mechanism that cancellation already uses.

### User stories

- **Diner.** "I'm stuck in traffic. From the link in my confirmation email I tap *15 min late* and know the
  restaurant has seen it, and until when they hold my table."
- **Diner.** "I can't come any more. I tap *I can't make it* and the table goes to someone else."
- **Diner.** "On my confirmation and on my booking link I can see how long the restaurant holds a table."
  (Before booking, on the public page, is phase 2: D10.)
- **Staff (host stand).** "Without phoning anyone I see which expected parties are on their way, which are late
  without a word, and how many minutes each hold has left. I can add 10 minutes with one tap."
- **Staff.** "When a hold ends, either I decide (seat, no-show) or the system frees the table and tells me.
  If the system released a party that was in fact already here (I forgot to tap Seated), I can undo it
  within 15 minutes while the table is still free."
- **Owner.** "I choose how long we hold a table (or no stated hold), and whether a table is released by itself."

## 2. Non-goals

- No live location, GPS, maps tracking or "share my trip". Only an arrival time the diner picks.
- No free-text message from the diner (no moderation problem, no PII in a new field). The existing `notes` stay.
- No SMS, WhatsApp or push notifications to staff or diners (no external service in this feature).
- The ETA never moves the booking: `start_at`, `end_at` and `table_slots` do not change. A late party has a
  shorter stay; the next booking on that table is protected.
- No reopening a released booking, with one exception: staff "Undo release" within 15 minutes while every
  freed table is still free (6.2 `undo_release`; the `table_slots` primary key decides, never a read-then-write).
  After that, if the party turns up, staff seat them as a walk-in.
- No change to the diner booking steps, the optimiser, the seat map component (`frontend/src/seatmap/`) or the
  room editor (`frontend/src/pages/room-editor/`, Sergio's area). Nothing in the events vertical.
- No dashboard chart for lateness in v1 (auto-released bookings already count as no-shows).

## 3. What exists today (verified in code)

| Fact | Where |
|---|---|
| Booking statuses `confirmed`, `seated`, `finishing` own `table_slots`; `completed`, `no_show`, `cancelled` have handed them back | `restaurant_service/occupancy.py` `ACTIVE_STATUSES`; `staff_floor.py` `CLOSING_STATUSES`, `FLOOR_STATUS` |
| Staff status change releases slots for closing statuses; it reads the status in Python, then assigns it (no conditional update) | `staff_floor.set_status` |
| Staff move also checks `booking.status` in Python only, then deletes and rewrites slots | `staff_floor.move_booking` |
| `_floor_table` does `FLOOR_STATUS[owner.status]`; a slot owned by a closing-status booking would raise `KeyError` (500 on the whole floor) | `staff_floor._floor_table` |
| Cancel = `emails.drop_reminder` -> `booking_rows.release_slots` -> status `cancelled` -> flush -> `emails.queue_cancellation` -> `waitlist.offer_freed_tables` -> `record_change`. No time limit on `DELETE /b/{token}`; the route checks `status != "confirmed"` in Python, then cancels unconditionally | `manage_flow.cancel_booking`, `routers/bookings.py cancel_booking` |
| Diner change (`PATCH /b/{token}`) is allowed until the booking time (`check_changeable`) and rewrites `start_at`/`end_at`/`date` | `manage_flow.change_booking` |
| `waitlist.offer_freed_tables` skips entries whose wanted time has passed and needs an overlap with the freed booking window; offer key `waitlist-offer-{entry.id}-{booking.public_id}` | `waitlist.py`, `emails.queue_waitlist_offer` |
| `security.rate_limit` commits at once ("call it before any other write") | `security.py` |
| Restaurant-only email templates live in `mail/restaurant_templates.py`; `mail/templates.py` is shared with events | `app/mail/READ_ME_FIRST.md` |
| Every API answer gets `Cache-Control: no-store` by default, so public GETs reach the function | `main.py` |
| The only privacy text in the app is `frontend/src/pages/account/PrivacyText.tsx`, an **events path we must not edit** | `pages/account/` |
| The waitlist offer emails a booking link; it does not hold the table | `waitlist.offer_freed_tables`, `emails.queue_waitlist_offer` |
| Every restaurant write calls `record_change` = `live.bump(venue-{pid}-{date})` + audit row | `restaurant_service/changes.py`, `core/live.py` |
| A booking as diners and staff see it, without email, phone or token | `booking_rows.describe` (used by `/b/{token}`, floor `bookings`, staff actions, confirmation) |
| Floor table status from the booking that owns the slot | `staff_floor._owners_at`, `_floor_table`, `floor` |
| Staff floor reloads on live bumps; its `time` is rounded to the slot, so it does not refetch on its own between slots | `StaffFloor.tsx` (`useLive`, `referenceNow`) |
| The staff map's `marked` prop is already used for "selected booking" | `StaffFloor.tsx` line ~180 |
| Only scheduler: GitHub Actions every 15 minutes, `POST /internal/email/process`, `X-Cron-Secret` | `.github/workflows/email-cron.yml`, `routers/emails.py _check_cron_secret` |
| Manage link: 30 calls per minute per address | `routers/bookings.py MANAGE_LIMIT` |
| Owner profile patch: strict Pydantic, `profiles.update` sets fields generically | `routers/owners.py ProfilePatch`, `restaurant_service/profiles.py update/view` |
| Lazy expiry precedent: expired holds are removed in the same transaction that takes a new one | `core/holds.py take_hold` |
| Error codes the frontend knows include `deadline_passed`, `rate_limited`, `conflict`, `validation` | `frontend/src/api/types.ts` |

## 4. Rules (the pure part)

All times are aware UTC datetimes in the backend and local `HH:MM` in answers, through `clock.py`.

```
grace       = venue.late_grace_minutes          None = the restaurant states no hold time
extra       = booking.hold_extra_minutes         0, 10, 20 or 30 (staff "Hold 10 more min")
hold_end    = None if grace is None else min(start_at + grace + extra, end_at)
eta         = ceil_to_minute(max(start_at, now) + minutes)     minutes in {10, 15, 20}
window      = [start_at - 90 min, close)  where close = hold_end if hold_end else min(start_at + 60 min, end_at)
```

- Before the booking time, *+10* means "10 minutes after my booking time" (19:30 -> 19:40). After it, it means
  "in 10 minutes from now" (at 19:36, *There in 10 min* -> 19:46). One formula covers both: `max(start, now)`.
- An option whose ETA is at or after `end_at` is not offered. An ETA after `hold_end` is allowed but labelled
  "After the hold" and explained (the diner is told the truth; the ETA does not extend the hold, see D1).
- At most 3 notices per booking, at least 60 s apart. Only while `status == "confirmed"` and inside `window`.
- Arrival state for staff and diner (`arrival_state`):

| State | When | Staff words | Diner words |
|---|---|---|---|
| `not_due` | now < start, no ETA | (nothing) | (nothing) |
| `on_way` | ETA sent, now < ETA | On the way · ETA 19:40 | On your way · Expected 19:40 |
| `late` | now >= start + 1 min, no ETA, not past hold | Not here yet · 11 min late | (card offers the buttons) |
| `past_eta` | ETA sent, now >= ETA, not past hold | ETA passed 3 min ago | Expected 19:40 |
| `hold_over` | hold_end set and now >= hold_end, still confirmed | Hold over 3 min ago | Hold time over |
| `released` | status `no_show` and `released_at` set | Released 19:45 | Your table was released |

- Auto-release happens only if `venue.late_auto_release` is true, `grace` is set, the booking is `confirmed`,
  `hold_end <= now`, and `hold_end > now - 60 min` (lookback: a forgotten old row is never swept in bulk).
  Consequence, stated to owners: if neither a visitor nor the cron reaches the booking within 60 minutes of
  the hold end, it stays `confirmed` and staff close it by hand as today.
- `grace` is one of `5, 10, 15, 20, 30, 45, 60` or NULL. Zero is not allowed (a 0-minute hold would release at
  the booking time itself).
- Any change of the booking time by the diner (`PATCH /b/{token}`) resets `eta_at`, `eta_sent_at`, `eta_count`
  and `hold_extra_minutes`: an ETA always refers to the current booking time.

## 5. UX flow and exact copy

### 5.1 Manage page `/b/{token}` (phone first) — `ManageBookingPage.tsx` + new `RunningLateCard.tsx`

**Always (confirmed booking), in "Reservation details"** — a new row in `BookingRows` (`BookingSummary.tsx`),
so the confirmation page shows it too:

- Label: `Hold time`. Value: `15 minutes after 19:30` (grace set) or omitted (no grace).

**Card appears** when `late.can_send` or the state is `on_way`, `past_eta`, `hold_over` or `released`. It sits
above "Make a change" in the right column on desktop and directly under the details on a phone.

A. Window open, no ETA yet (before the booking time):

- Title: `Running late?`
- Text: `Let Casa Lumen know when you'll arrive. They hold your table for 15 minutes, until 19:45.`
  (no grace: `Let Casa Lumen know when you'll arrive. They have not set a hold time, so please call if you'll be very late.`)
- Three options in a row: a `<fieldset>` with `<legend>When will you arrive?</legend>` and three native radio
  inputs styled as cards (real radios give arrow-key moves and the checked state for free), each two lines:
  `10 min late` / `Arrive 19:40`; `15 min late` / `Arrive 19:45`; `20 min late` / `Arrive 19:50`.
  After the booking time the first line reads `There in 10 min`, `There in 15 min`, `There in 20 min`.
  An option after the hold has a third small line `After the hold`.
- Primary pink button (the page's one main action): `Send to the restaurant` (disabled look until an option is
  chosen; `aria-disabled`, like `Button busy`).
- Link-style danger button: `I can't make it`.
- Hint: `Only your arrival time is shared with the restaurant. We don't use your location.`

B. The chosen option is after the hold, before sending (inline notice under the buttons, `role="status"`):

- auto-release on: `That is after the 15-minute hold. If you're not there by 19:45, the table will be offered to other guests automatically.`
- auto-release off: `That is after the 15-minute hold. After 19:45 the restaurant may give the table to other guests.`

C. Sent (`on_way` / `past_eta`):

- Pill: `On your way · Expected 19:40`
- Text: `Casa Lumen can see you're on your way. Your table is held until 19:45.`
  (staff added time: `... Your table is held until 19:55.`) (no grace: `Casa Lumen can see you're on your way.`)
- Secondary button: `Change arrival time` (re-opens the options) and the muted line `2 updates left`.
- Toast on success: `Sent. The restaurant knows you'll arrive around 19:40.`

D. Hold over, still confirmed (auto-release off): `The 15-minute hold ended at 19:45. Your booking is still open, but the restaurant may give the table to other guests. Call +351 210 000 100 if you're nearly there.`

E. Released (`released`), replaces the card and the "Make a change" section:
`Your table was released at 19:45 because the 15-minute hold ended. If you're still coming, call Casa Lumen on +351 210 000 100, or make a new booking.` with the existing link `Make another booking at Casa Lumen`.
Status badge next to the venue name: `Released` (neutral tone).

F. "I can't make it" opens the existing `CancelDialog` with different words (same `DELETE /b/{token}`):

- Title: `Can't make it?`
- Body: venue, date and time line (as today), then `We'll cancel your booking and free the table for other guests. This cannot be undone.`
- Buttons: `Keep booking` (focus starts here) / `Cancel booking` (danger).
- Toast: `Booking cancelled. Thanks for letting Casa Lumen know.`

Errors (inline `role="alert"`, the card stays usable):

| Code from server | Copy |
|---|---|
| `rate_limited` and `late.notices_left === 0` (3 notices used) | `You've already sent 3 updates. Please call the restaurant on +351 210 000 100.` |
| `rate_limited` otherwise (60 s gap, or the per-address limit) | `You sent an update a moment ago. Try again in a minute.` |
| `deadline_passed` | `The hold time is over, so we can't send updates any more. Please call the restaurant.` |
| `validation` (too early, or ETA after the end of the booking) | the server's message, e.g. `You can tell the restaurant from 90 minutes before your booking.` |
| `conflict` | `This booking can no longer be updated. Refresh to see its latest state.` |
| `network` / other | `We could not send your update. Please try again, or call the restaurant.` |

While the card is visible the page listens with `useLive(venueDayScope(venue, date), reload)` so a staff
"hold longer" or a release appears without a refresh. Outside the window it does not subscribe. The venue-day
scope bumps on **every** write at that restaurant that evening (other diners, staff seating tables), and
`GET /b/{token}` is limited to 30 per minute per address, so the reload is throttled: at most one reload every
15 s (trailing call kept), pure helper `throttleMs` in `lateView.ts`. A 429 on a live reload is ignored silently
(the card keeps the last answer) instead of replacing the page with an error.

Phone numbers come from `usePublicVenue` (already used by `VenueCard`); when the venue has no phone the call
sentences end at `Please contact the restaurant.`

### 5.2 Confirmation step — `Confirmation.tsx`

Through `BookingRows` it gains the `Hold time` row. One line under the manage link:
`Running late? Use your booking link to tell the restaurant.` (always shown, with or without a hold time).

### 5.3 Staff floor `/staff/{vid}` (laptop first) — `StaffFloor.tsx`, `FloorLists.tsx`, `SelectionPanel.tsx`

- **Policy line** under the status counts: `Late policy: tables held 15 min after the booking time · Auto-release on`
  (or `· Auto-release off`; no grace: `Late policy: no hold time set`).
- **Late strip** (new `LateStrip.tsx`, a `<section aria-label="Late and on the way">`) between the counts and the
  map, only when at least one booking is `on_way`, `late`, `past_eta` or `hold_over`:
  heading `Late and on the way (3)`, then one button-chip per booking sorted by least time left:
  - `19:30 · Rui Costa · 2 · T4` / `On the way · ETA 19:40` / `Hold ends in 12 min`
  - `19:15 · Inês Duarte · 4 · T7` / `Not here yet · 11 min late` / `Hold ends in 4 min` (amber)
  - `19:00 · Miguel Sousa · 2 · T2` / `Hold over 3 min ago` (red outline, only when auto-release is off)
  - Auto-release on and less than 5 minutes left: third line `Releases in 4 min. Tap Seated if they're here.`
    (amber). This is the guard against the main real-world failure: a party that arrived but was never
    marked seated.
  Clicking a chip selects the booking (same as the arrivals list) and zooms the map with `focusId`.
- **Table tile** (`TableBoard`): a fourth line under the status: `ETA 19:40`, `Late 11 min` or `Hold over`.
- **Arrivals list** (`ArrivalsList`): the badge `Expected` becomes `On the way · 19:40`, `Late 11 min` or `Hold over`.
- **Map**: no change to the shared `SeatMap`. Its spoken name (via `describeStaffTables`) gains
  `, on the way, arriving 19:40` / `, 11 minutes late` / `, hold over`.
- **Selection panel**, new `LateBox` above `BookingActions`:
  - Heading `On the way` / `Not here yet` / `Hold over`.
  - `Rui told us at 19:26: arriving around 19:40 (10 min late).` (no ETA: `No message from the guest.`)
  - `Hold ends 19:45 · 12 min left` (live countdown, minute precision, `aria-live="off"`).
  - Auto-release on: `If they are not seated by 19:45, the table is released and offered to the waitlist.`
  - Hold over, auto off: `The 15-minute hold ended at 19:45. Seat them, hold 10 more minutes, or mark a no-show to free the table.`
  - Secondary button `Hold 10 more min` (shown while confirmed, grace set, extra < 30). Toast:
    `Holding table 4 for Rui Costa until 19:55.` At the cap the button is replaced by `Maximum extra time reached.`
- **Released tonight** (`<details>` under the arrivals list, only when there are any):
  summary `Released tonight (1)`; row `Miguel Sousa · 2 · T2 · released 19:15. If they arrive, seat them as a walk-in.`
  While `released_at` is less than 15 minutes ago the row has a secondary button `Undo release (they're here)`.
  Success toast: `Miguel Sousa is seated at T2. The release email will not be sent.` Conflict (a table was taken
  meanwhile): `T2 has been booked again. Seat Miguel Sousa as a walk-in.`
- **Announcements** (the existing `spoken` live region): new ETA -> `Rui Costa, table 4: on the way, arriving around 19:40.`;
  release -> `Table 2 released: Miguel Sousa did not arrive within the 15-minute hold.`
- **Timely refresh**: the floor schedules one `reload(true)` at the earliest upcoming `hold_end` + 5 s (pure
  helper `nextDeadline`), only when the floor shows today and the venue has auto-release on, so the lazy
  release (6.4) runs while staff watch. Only one timer at a time (cleared on every new answer).

### 5.4 Owner `/owner/{vid}/hours` — `HoursPage.tsx` + new `LatePolicyCard.tsx`

Card under the schedule editor:

- Title: `Late arrivals`
- Select label: `How long do you hold a table after the booking time?` Options: `Don't show a hold time`,
  `5 minutes`, `10 minutes`, `15 minutes (most restaurants)`, `20 minutes`, `30 minutes`, `45 minutes`, `60 minutes`.
  (These are exactly the values the API accepts.)
- Checkbox: `Release the table automatically when the hold ends`; hint:
  `The booking is marked as a no-show, the guest gets an email, and the first matching person on the waitlist is offered the table. Staff can add 10 minutes from the floor. Your staff must tap Seated when guests arrive, or their table can be released while they are there.`
  Choosing `Don't show a hold time` while the box is ticked unticks it (the API refuses the pair).
  Disabled with the hint `Choose a hold time first.` when the select is "Don't show".
- Preview line: `Guests see: "The restaurant holds your table for 15 minutes after your booking time."`
- Button: `Save late policy`. Toast: `Late policy saved.` Error: `We could not save the late policy. Please try again.`

## 6. Backend

### 6.1 Data model (`backend/app/models.py`, `backend/app/seed/migrate.py`)

No new table. New columns, appended in the same order in the model and in `NEW_COLUMNS`:

| Table | Column | Type / DDL | Meaning |
|---|---|---|---|
| venues | `late_grace_minutes` | `INTEGER` (nullable) | Hold time; NULL = no stated hold. API accepts only 5, 10, 15, 20, 30, 45, 60 |
| venues | `late_auto_release` | `BOOLEAN NOT NULL DEFAULT FALSE` | Release automatically at hold end |
| bookings | `eta_at` | `TIMESTAMP` (SQLite `DATETIME`, per seed read-me) | Latest arrival time the diner sent |
| bookings | `eta_sent_at` | `TIMESTAMP` | When it was sent (60 s gap, "told us at 19:26") |
| bookings | `eta_count` | `INTEGER NOT NULL DEFAULT 0` | Notices sent (cap 3) |
| bookings | `hold_extra_minutes` | `INTEGER NOT NULL DEFAULT 0` | Staff extensions (cap 30) |
| bookings | `released_at` | `TIMESTAMP` | Set only by auto-release (status becomes `no_show`) |

`NEW_COLUMNS` entries:

```python
("venues", "late_grace_minutes", "INTEGER"),
("venues", "late_auto_release", "BOOLEAN NOT NULL DEFAULT FALSE"),
("bookings", "eta_at", "TIMESTAMP"),
("bookings", "eta_sent_at", "TIMESTAMP"),
("bookings", "eta_count", "INTEGER NOT NULL DEFAULT 0"),
("bookings", "hold_extra_minutes", "INTEGER NOT NULL DEFAULT 0"),
("bookings", "released_at", "TIMESTAMP"),
```

(`_add_missing_columns` already turns `TIMESTAMP` into `DATETIME` on SQLite; nothing to add for that.)

Model side, matching word for word (the comment above `NEW_COLUMNS` requires it):

- the three timestamps are `mapped_column(UtcDateTime)` (aware UTC in Python, naive UTC in the database),
  never plain `DateTime`;
- `late_auto_release = mapped_column(Boolean, default=False, server_default=text("FALSE"))`;
- `eta_count`, `hold_extra_minutes = mapped_column(Integer, default=0, server_default=text("0"))`;
- columns appended at the end of `Venue` and `Booking`, in the order of the `NEW_COLUMNS` entries.

`RESTAURANT_INDEXES` entry (not `NEW_INDEXES`, which the seed read-me keeps for the historical guest-account
contract), mirrored as `__table_args__ = (Index("ix_bookings_status_start_at", "status", "start_at"),)` on
`Booking` (it has no `__table_args__` today) so a fresh `create_all` matches:

```python
("ix_bookings_status_start_at",
 "CREATE INDEX IF NOT EXISTS ix_bookings_status_start_at ON bookings (status, start_at)"),
```

No constraint changes; `table_slots` is untouched.

### 6.2 New module `backend/app/restaurant_service/late_arrivals.py`

Pure functions (no session, no clock; tested first):

| Function | Job |
|---|---|
| `ETA_CHOICES = (10, 15, 20)`, `GRACE_CHOICES = (5, 10, 15, 20, 30, 45, 60)`, `MAX_NOTICES = 3`, `NOTICE_GAP_S = 60`, `OPEN_BEFORE_MIN = 90`, `NO_GRACE_CLOSE_MIN = 60`, `EXTRA_STEP = 10`, `MAX_EXTRA = 30`, `RELEASE_LOOKBACK_MIN = 60`, `UNDO_WINDOW_MIN = 15`, `RELEASE_EMAIL_DELAY_MIN = 10`, `LAZY_LIMIT = 10`, `CRON_LIMIT = 50`, `CRON_BUDGET_S = 15` | Constants |
| `hold_end(start_at, end_at, grace, extra) -> datetime | None` | Section 4 |
| `eta_moment(start_at, now, minutes) -> datetime` | `max(start, now) + minutes`, rounded up to the minute |
| `notice_window(start_at, end_at, hold) -> tuple[datetime, datetime]` | Open/close |
| `eta_options(start_at, end_at, hold, now) -> list[EtaOption]` | `EtaOption(minutes, eta, before_start, after_hold)`; drops ETAs >= end |
| `notice_problem(status, start_at, end_at, hold, eta_count, eta_sent_at, minutes, now) -> Problem | None` | `Problem(status, code, message)`: 409 `conflict` (not confirmed), 409 `deadline_passed` (window closed), 429 `rate_limited` (cap or gap), 422 `validation` (too early, or ETA at/after end) |
| `arrival_state(status, released_at, start_at, eta_at, hold, now) -> str` | Section 4 table |
| `due_for_release(auto_release, status, hold, now) -> bool` | Includes the 60-minute lookback |
| `can_undo_release(status, released_at, now) -> bool` | `no_show`, `released_at` set and `now - released_at < 15 min` |
| `grace_problem(grace, auto_release) -> str | None` | The merged-state check for the owner patch (auto-release needs a grace) |

Database functions (thin, each "does not commit" unless stated):

| Function | Job |
|---|---|
| `late_payload(venue, booking, now) -> dict` | The `late` block (6.3). No query |
| `send_eta(session, venue, booking, minutes, now) -> None` | Checks `notice_problem`, writes `eta_at`, `eta_sent_at`, `eta_count+1` with a conditional `UPDATE ... WHERE id=:id AND status='confirmed' AND eta_count=:seen` (rowcount 0 -> 409 `conflict`), `record_change(actor="diner", action="booking.eta", detail={"minutes": m})`. Commits |
| `hold_longer(session, venue, booking, user, now) -> None` | 409 if not confirmed / no grace / at cap; conditional update on `hold_extra_minutes=:seen`; `record_change(actor=user.email, action="booking.hold_longer", detail={"extra": n})`. Commits |
| `release_overdue(session, venue, now, limit=LAZY_LIMIT) -> list[Booking]` | Lazy sweep of one venue: returns at once when `late_auto_release` is false or grace is None; else selects `confirmed` bookings of that venue with `start_at` in `[now - (grace+30+60) min, now]`, filters with `due_for_release`, and releases each through `_release_one`. Does not commit. Limit 10, because it runs inside public GETs that must stay well under Vercel's 30 s |
| `release_overdue_safely(session, venue, now) -> int` | What the read routes call: runs `release_overdue` inside `session.begin_nested()`; on any exception it rolls the savepoint back, logs `late_release_failed` (booking ids only) and returns 0, so a release bug never breaks the map, slots, floor or manage page. Commits only when something was released |
| `sweep_all(session, now, limit=CRON_LIMIT, budget_s=CRON_BUDGET_S) -> SweepReport` | Cron: same query across venues with auto-release (join `venues`, uses `ix_bookings_status_start_at`). Stops after 50 bookings or 15 s of wall time, whichever first, commits after each venue, and reports `more: true` so the next run continues. Each release runs the waitlist matcher (`candidate_choices` per waiting entry), so an unbounded batch could pass the 30 s function limit |
| `_release_one(session, venue, booking, seen_extra, now) -> bool` | Conditional `UPDATE bookings SET status='no_show', released_at=:now WHERE id=:id AND status='confirmed' AND hold_extra_minutes=:seen` (the `_claim` pattern of `mail/outbox.py`), executed with `synchronize_session=False` followed by `session.refresh(booking)`, so `describe` in the same request never shows the stale `confirmed`. On Postgres the UPDATE also holds the row lock until commit, which serialises it with the staff/diner claims below. If rowcount 1: `emails.drop_reminder`, `booking_rows.release_slots`, flush, `emails.queue_release` (with `send_after = now + 10 min`, see undo), `waitlist.offer_freed_tables(session, venue, booking, freed)`, `record_change(actor="system", action="booking.released", detail={"offered_to_waitlist": bool, "grace": g, "tables": [ids]})` |
| `undo_release(session, venue, booking, user, now) -> None` | Staff only. 409 `conflict` unless `can_undo_release`. Conditional `UPDATE ... SET status='seated', released_at=NULL WHERE id=:id AND status='no_show' AND released_at=:seen`; then `booking_rows.write_slots` for the booking's original window on the table ids from the release audit row (the primary key refuses if anyone took a slot: `SeatTaken` -> rollback -> 409 `conflict` with the 5.3 copy); marks the queued `booking-released-{public_id}` email `skipped` (same update shape as `drop_reminder`). The waitlist offer already queued is not withdrawn: it is a link, and a booking attempt on the re-taken table meets the primary key. `record_change(actor=user.email, action="booking.release_undone")`. Commits via `commit_or_seat_taken` |
| `recent_releases(session, venue, day, now) -> list[dict]` | Bookings of that venue and day with `released_at` in the last 3 h (at most 20): `id`, `name`, `party_size`, `tables` (labels; see note), `released_at`, `can_undo` |
| `scrub_old_etas(session, now, days=30) -> int` | Retention: `UPDATE bookings SET eta_at=NULL, eta_sent_at=NULL WHERE eta_sent_at IS NOT NULL AND eta_sent_at < now - 30 days` (bounded by the cron call; the table has no `date` index, so the filter is on the column being cleared) |
| `reset_eta(booking) -> None` | Sets `eta_at`, `eta_sent_at` to None and `eta_count`, `hold_extra_minutes` to 0. Called by `manage_flow.change_booking` |

Note on `recent_releases` tables: `release_slots` deletes the rows, so `_release_one` puts the freed table ids in
the audit `detail` (`{"tables": [...]}`, ids only, no names) and `recent_releases` reads them back with one query
`action = 'booking.released' AND entity_id IN (:ids)` (uses the existing `audit_log.action` index; at most 20
ids). No extra column.

Shared claim helper in `booking_rows.py` (new, used by every path that closes or moves a booking, so a release
and a human action can never both win):

`claim_status(session, booking, expected: tuple[str, ...], new_status: str | None) -> None` runs
`UPDATE bookings SET status = COALESCE(:new, status) WHERE id=:id AND status IN :expected`; rowcount 0 ->
409 `conflict` `"This booking changed a moment ago. The floor has been refreshed."` (staff) or
`"This booking can no longer be cancelled."` (diner). It is called **before** any slot is deleted or written.
Callers: `staff_floor.set_status`, `staff_floor.move_booking` (with `new_status=None`, a pure lock/check),
`manage_flow.cancel_booking` (both the diner `DELETE /b/{token}` and staff cancel). `send_eta` and
`hold_longer` already carry `status='confirmed'` in their own conditional updates. Without this, a diner cancel
racing a release would overwrite `no_show` with `cancelled` and queue a second (cancellation) email, and a staff
move racing a release would write slots owned by a `no_show` booking, which makes `_floor_table` raise `KeyError`
on `FLOOR_STATUS` and the whole floor answer 500.

Reused as is: `booking_rows.release_slots`, `booking_rows.describe`, `booking_rows.load_by_token`,
`waitlist.offer_freed_tables`, `emails.drop_reminder`, `changes.record_change`, `clock.venue_zone`, `clock.hhmm`,
`staff_floor.load_booking`, `venue_access.load_for_staff`, `security.rate_limit`, `security.client_ip`,
`routers/emails._check_cron_secret` (imported; a private name, so `restaurant_cron.py` imports it with a
comment, or the helper is renamed `check_cron_secret` in the same commit with its one existing caller updated).

### 6.3 Changes to existing backend modules

- `booking_rows.describe`: adds `"late": late_arrivals.late_payload(venue, booking, utc_now())`. Additive key,
  every booking answer carries it (manage, confirmation, staff actions, floor `bookings`). Shape:

```json
"late": {
  "grace_minutes": 15,
  "auto_release": true,
  "hold_until": "19:45",             "hold_until_at": "2026-11-17T19:45:00Z",
  "extra_minutes": 0,
  "eta": "19:40",                    "eta_at": "2026-11-17T19:40:00Z",
  "eta_sent_at": "2026-11-17T19:26:10Z",
  "state": "on_way",
  "can_send": true,
  "notices_left": 2,
  "options": [{"minutes": 10, "eta": "19:40", "before_start": true, "after_hold": false}, ...],
  "released_at": null,
  "server_now": "2026-11-17T19:28:03Z"
}
```

  `options` is `[]` when `can_send` is false. No new personal data: the ETA is about the booking itself.
- `staff_floor.set_status`: replace the plain assignment with `booking_rows.claim_status(session, booking,
  (old,), new)` **before** `release_slots`; rowcount 0 -> 409 `conflict`
  `"This booking changed a moment ago. The floor has been refreshed."` This closes the race "staff seat at 19:45:00
  while the sweep releases".
- `staff_floor.move_booking`: `claim_status(session, booking, ("confirmed", "seated", "finishing"), None)` before
  `release_slots`.
- `staff_floor._floor_table`: `FLOOR_STATUS.get(owner.status, "free")` as defence in depth, so one inconsistent
  row can never 500 the floor.
- `manage_flow.cancel_booking`: `claim_status(session, booking, ("confirmed",) if actor == "diner" else
  ("confirmed", "seated", "finishing"), "cancelled")` replaces `booking.status = "cancelled"` and runs before
  `release_slots`. Staff cancel keeps its current allowed statuses (today `set_status` lets staff cancel any
  non-closing booking).
- `manage_flow.change_booking`: calls `late_arrivals.reset_eta(booking)` when it moves the booking.
- `staff_floor.floor`: payload gains `"late_policy": {"grace_minutes", "auto_release"}` and
  `"released": late_arrivals.recent_releases(...)`. `_floor_table` gains `"arrival": state` for the owning
  booking (or null). `booking_rows.describe` already gives each booking its `late` block.
- `emails.py`: new `queue_release(session, venue, booking, send_after)`: key `booking-released-{public_id}`, kind
  `booking_released`, cancelled calendar invite (`_invite(..., cancelled=True)`), link `_link(venue, "")` (the
  restaurant's booking page; we only hold the token hash). `send_after = released_at + 10 min`, so a staff undo
  within that time skips it before it goes; after an undo between 10 and 15 min the diner may already have the
  email (they are at the table; staff can tell them). No email when `booking.email` is empty. New
  `skip_release_email(session, booking)` for the undo.
- `mail/restaurant_templates.py` (restaurant-only; **not** the events-shared `mail/templates.py`): new
  `booking_released(name, venue_name, when, grace_minutes, hold_end_text, phone, link) -> EmailParts`, built with
  the helpers that module already imports from `templates.py` (`_compose`-style text and HTML, `_check_link`,
  `_one_line`). `phone` may be None: the sentence then reads `If you are still coming, please contact the restaurant.`
  Subject `Your table at Casa Lumen was released`. Text:
  `Hello Rui,` / `Casa Lumen held your table for 15 minutes after Tue 17 Nov 2026, 19:30. You had not arrived by 19:45, so the table has been given to other guests.` /
  `If you are still coming, please call +351 210 000 100. You can also make a new booking: <link>.`
  `mail/templates.py` is not touched at all.
- `profiles.py`: `PROFILE_FIELDS` gains `late_grace_minutes`, `late_auto_release` (read and patched like the rest).
  `profiles.update` checks the **merged** state after applying the patch, with `late_arrivals.grace_problem`:
  a patch that only sets `late_auto_release: true` on a venue whose stored grace is NULL, or only sets
  `late_grace_minutes: null` on a venue with auto-release on, is refused with 422 `validation`
  `"Choose a hold time before turning on automatic release."` (a Pydantic validator alone cannot see the
  stored value).
- `seed/demo_restaurant.py`, `seed/demo_showcase.py`: see 10.

### 6.4 When does auto-release run?

There is no always-on worker. Three triggers, all calling the same `release_overdue`/`sweep_all`, all safe to run
twice at once thanks to the conditional update:

1. **Lazy, on read** (seconds after the hold ends whenever someone is looking), only for today's date in the venue
   zone and only when the venue has auto-release on: `GET /staff/{vid}/floor`, `GET /r/{vid}/map`,
   `GET /r/{vid}/slots`, `GET /b/{token}`. The route calls `release_overdue_safely` after its rate limit and
   before reading; if it released anything it commits (live bump included) and then reads. Cost when nothing is
   due: one indexed SELECT, and zero queries for venues with auto-release off. At most 10 releases per request;
   a failure is logged and swallowed (the read still answers). These are GETs with a side effect: acceptable
   because the effect is idempotent, bounded, time-driven (not caller-driven: a caller cannot choose what is
   released or make it happen earlier) and every answer is `Cache-Control: no-store`.
2. **Staff floor timer**: the open floor reloads at the next `hold_end` + 5 s (5.3), which triggers (1).
3. **Cron backstop**: new `POST /internal/restaurants/late-sweep` called by a new **separate** step in
   `.github/workflows/email-cron.yml` that runs before the email step with `continue-on-error: true` and its own
   `--max-time 25`, so a failing or not-yet-deployed sweep (404 right after the workflow merges) never stops the
   email step. Release emails are queued with `send_after = now + 10 min` (undo window), so they go out in the
   next run or the one after.
   Worst case without any visitor: GitHub documents that scheduled workflows can be delayed under load and
   that runs may be dropped, so "within 15 minutes" is not guaranteed; in practice 15 to 30 minutes, and
   bookings missed for more than 60 minutes are left to staff (lookback). This is why the lazy path (1) and the
   floor timer (2) carry the real-time behaviour.

### 6.5 API

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/b/{manage_token}` (changed) | manage token; 30/min/IP (existing) | - | booking + `late` (6.3); runs lazy release first | 404 |
| POST | `/b/{manage_token}/eta` (new) | manage token; `b-manage` 30/min/IP + new `b-eta` 10/min/IP (both before the token lookup, so guessing tokens costs the same as today); per booking 3 notices, 60 s gap | `{"minutes": 10 \| 15 \| 20}` (`Literal[10, 15, 20]` with `strict=True`, `extra="forbid"`) | booking + `late` | 404; 409 `conflict` (not confirmed, or changed meanwhile); 409 `deadline_passed` (window closed); 422 `validation` "You can tell the restaurant from 90 minutes before your booking." (too early); 429 `rate_limited`; 422 `validation` (ETA at or after the end of the booking) |
| DELETE | `/b/{manage_token}` (changed inside only) | manage token | - | booking | "I can't make it" reuses it; the status check becomes the conditional `claim_status` (409 `conflict` if a release won) |
| PATCH | `/b/{manage_token}` (changed inside only) | as today | as today | as today | a time/date change resets the ETA fields |
| POST | `/staff/{vid}/bookings/{booking_id}/hold-longer` (new) | `CurrentUser` + `load_for_staff` + `load_booking` (venue-scoped, so another venue's booking id is 404) | `{}` (strict, empty; always +10) | booking + `late` | 404; 409 `conflict` (closed / no grace / cap 30 reached) |
| POST | `/staff/{vid}/bookings/{booking_id}/undo-release` (new) | `CurrentUser` + `load_for_staff` + `load_booking` | `{}` (strict, empty) | booking (now `seated`) + `late` | 404; 409 `conflict` (not released, older than 15 min, or a table was taken) |
| POST | `/staff/{vid}/bookings/{id}/move` (changed inside only) | as today | as today | as today | + 409 `conflict` when the booking was closed meanwhile |
| GET | `/staff/{vid}/floor` (changed) | `CurrentUser` | - | + `late_policy`, `released`, tables' `arrival`; runs lazy release first (today only) | as today |
| POST | `/staff/{vid}/bookings/{id}/status` (changed) | as today | as today | as today | + 409 `conflict` when the status changed meanwhile |
| GET | `/r/{vid}/map`, `/r/{vid}/slots` (changed) | public, as today | - | unchanged shape; lazy release first (today only) | as today |
| POST | `/internal/restaurants/late-sweep` (new) | `X-Cron-Secret` (reuses `_check_cron_secret`), own key `cron-late:{ip}` 30/min, rate limit before the secret check (as the email route does) | - | `{"released": n, "offered": m, "scrubbed": k, "more": bool}` | 401, 429 |
| PATCH | `/owner/restaurants/{vid}/profile` (changed) | owner session (existing; `profiles.load` is owner-only, demo staff cannot change the policy) | + `late_grace_minutes: Literal[5, 10, 15, 20, 30, 45, 60] \| None` (`strict=True`; explicit null = no hold, absent = unchanged, thanks to the existing `exclude_unset`), `late_auto_release: StrictBool` (null refused in `complete_values`, because the column is NOT NULL) | profile + the two fields | 422 `validation` "Choose a hold time before turning on automatic release." when the **merged** state would have auto-release on with no grace (checked in `profiles.update`) |
| GET | `/owner/restaurants/{vid}` (changed) | owner | - | + the two fields | - |

Routers: `routers/bookings.py` (`EtaIn`, `post_eta`, lazy release in `view_booking`), `routers/staff.py`
(`hold_longer` and `undo_release` routes, lazy release in `floor` only when the requested date is today in the
venue zone, `EmptyIn`), `routers/restaurants.py` (lazy release in map and
slots), `routers/owners.py` (`ProfilePatch` fields + validator), new `routers/restaurant_cron.py`
(late-sweep) registered in `main.py`.

## 7. Frontend

| File | Change |
|---|---|
| `src/api/restaurant.ts` | `LateInfo`, `ArrivalState`, `EtaOption` types; `late?` on `ServerBooking`, `late` on `BookingView` and `StaffBooking` (via `toBookingView`/`toStaffBooking`, default `null` for old answers); `StaffFloor.late_policy`, `released`, `StaffTable.arrival`; `sendEta(token, minutes)`, `holdLonger(vid, bookingId)`, `undoRelease(vid, bookingId)` |
| `src/api/owner.ts` | `OwnerProfile.late_grace_minutes`, `late_auto_release` |
| `src/pages/restaurant/lateView.ts` (new, pure) | `arrivalWords(late, nowMs, who)`, `minutesLeft(iso, nowMs, serverSkewMs)`, `countdownText`, `optionLabel(option)`, `afterHoldNotice(late, venueName)`, `lateBookings(bookings, nowMs)` (sorted by time left), `nextDeadline(bookings, nowMs)`, `lateAnnouncements(prev, next)`, `staffLateSpoken(booking)`, `releaseSoon(late, nowMs)` (under 5 min, auto-release on), `throttleMs(lastMs, nowMs, gapMs)` for the manage page live reload; clock skew from `server_now` |
| `src/pages/restaurant/useNow.ts` (new) | `useNow(intervalMs = 30_000)` tick for minute countdowns |
| `src/pages/restaurant/RunningLateCard.tsx` (new) | States A-E of 5.1 |
| `src/pages/restaurant/ManageBookingPage.tsx` | Renders the card, `Released` badge, "I can't make it" opening `CancelDialog` with a `variant="cant-make-it"` prop, `useLive` while the card is visible |
| `src/pages/restaurant/BookingSummary.tsx` | `Hold time` row in `BookingRows` (shared by manage and confirmation) |
| `src/pages/restaurant/Confirmation.tsx` | The "Running late?" line |
| `src/pages/restaurant/LateStrip.tsx`, `LateBox.tsx` (new) | Staff strip and selection-panel box |
| `src/pages/restaurant/StaffFloor.tsx` | Policy line, `LateStrip`, deadline reload timer, announcements |
| `src/pages/restaurant/FloorLists.tsx` | Tile fourth line, arrivals badge, `Released tonight` details with `Undo release (they're here)` |
| `src/pages/restaurant/SelectionPanel.tsx` | `LateBox` above `BookingActions` |
| `src/pages/restaurant/staffStatus.ts` | `describeStaffTables` adds the arrival words; `BOOKING_LOOK` unchanged |
| `src/pages/restaurant/restaurant.css`, `staff.css` | Card, chips and strip styles with existing tokens (lilac surface, purple text, amber warning, red danger) |
| `src/pages/owner/LatePolicyCard.tsx` (new), `HoursPage.tsx` | 5.4 |

No new routes in `App.tsx`. Nothing in `seatmap/`, `room-editor/` or any event folder.

## 8. Security, privacy, abuse

- **Auth.** The manage token stays the only key (looked up by hash). Staff routes use `load_for_staff` (staff on
  demo restaurants, owners on their own). The cron route requires the secret; empty secret refuses everyone.
- **No new personal data.** Only times and counters about the booking. No location, no free text. Audit detail
  holds minutes and table ids, never names or emails. Live scopes carry no data.
- **GDPR.** Lawful basis: performance of the booking contract (the diner chooses to send it). The card states
  what is shared. Retention: `scrub_old_etas` (cron) clears `eta_at`/`eta_sent_at` 30 days after the booking
  date; `released_at` and counters stay with the booking as operational data under the existing booking
  retention. The release email follows outbox retention (`scrub_expired`, 30 days, links redacted).
  Deletion: no new place to delete; whatever deletes a booking deletes these columns.
- **Abuse limits.** 10 ETA calls/min/IP (on top of 30 manage calls), 3 notices per booking, 60 s gap, only in the
  window, only `confirmed`. The diner cannot extend the hold or move slots. Staff extensions: +10 at a time,
  max +30. Sweep: 50 bookings per venue per read, 200 per cron call, 60-minute lookback. Strict request models
  (`extra="forbid"`, `Literal` minutes) give 422 on anything else.
- **Races.** Release, ETA and hold-longer use conditional updates (rowcount 1 wins); staff status changes become
  conditional too (6.3). A diner cancel that commits after a release ends `cancelled` with `released_at` set:
  acceptable, the diner said they will not come; the waitlist offer key is idempotent so no double email.
- **Headers.** No new external origins; `vercel.json` CSP is unchanged.

## 9. Tests (written first for the pure rules and security)

pytest, new `backend/tests/test_late_arrivals.py` (pure):
`test_hold_end_is_start_plus_grace_plus_extra`, `test_hold_end_never_after_booking_end`,
`test_hold_end_none_without_grace`, `test_eta_before_start_counts_from_booking_time`,
`test_eta_after_start_counts_from_now_rounded_up`, `test_options_drop_etas_at_or_after_end`,
`test_option_after_hold_is_flagged`, `test_window_opens_90_minutes_before`, `test_window_closes_at_hold_end`,
`test_window_without_grace_closes_one_hour_after_start`, `test_fourth_notice_is_rate_limited`,
`test_notice_within_60_seconds_is_rate_limited`, `test_arrival_states_table` (parametrised over section 4),
`test_due_for_release_respects_lookback`, `test_due_for_release_needs_auto_release_and_grace`.

pytest, new `backend/tests/test_late_api.py` (HTTP + DB, clock patched like `test_bookings_manage.py`):
`test_manage_view_has_late_block_without_personal_data`, `test_post_eta_sets_eta_and_bumps_live_scope`,
`test_post_eta_audit_detail_has_minutes_only`, `test_post_eta_rejects_unknown_minutes_and_extra_fields`,
`test_post_eta_too_early_is_409`, `test_post_eta_after_hold_end_is_deadline_passed`,
`test_post_eta_on_cancelled_booking_is_409`, `test_post_eta_wrong_token_is_404`, `test_post_eta_ip_rate_limit`,
`test_eta_does_not_touch_table_slots`, `test_hold_longer_extends_by_ten_up_to_thirty`,
`test_hold_longer_needs_staff_session`, `test_hold_longer_other_owner_gets_404`,
`test_floor_shows_arrival_state_and_policy`, `test_lazy_release_on_floor_read_frees_slots_and_marks_no_show`,
`test_lazy_release_offers_table_to_waitlist`, `test_lazy_release_queues_release_email_once`,
`test_no_release_when_auto_release_off`, `test_no_release_for_seated_booking`,
`test_two_sweeps_release_once` (two threads), `test_seat_after_release_is_409_conflict`,
`test_release_skips_booking_extended_meanwhile`, `test_cron_sweep_requires_secret`,
`test_cron_sweep_releases_and_scrubs_old_etas`, `test_public_map_shows_released_table_free`,
`test_owner_patch_late_policy_and_validation`, `test_cancel_after_start_still_offers_waitlist` (the "can't make it" path).

pytest, existing files, new tests only: `test_migrate_restaurants.py::test_migrate_adds_late_arrival_columns_and_index`
(idempotent twice), `test_restaurant_emails.py::test_release_email_words_and_cancelled_invite`,
`test_mail_templates.py::test_booking_released_template`, `test_staff_endpoints.py::test_status_change_is_conditional`,
`test_redteam.py::test_eta_endpoint_never_returns_email_or_token`.

vitest: `src/pages/restaurant/__tests__/lateView.test.ts` (`arrivalWords`, skew-corrected `minutesLeft`,
`optionLabel` before/after start, `nextDeadline`, `lateAnnouncements`, sort order);
`__tests__/runningLate.test.tsx` ("sends 15 min late and shows On your way", "warns when the option is after the hold",
"shows Released and hides Make a change", "I can't make it uses the cancel dialog with Keep booking focused",
"shows the 3-updates error with the phone"); `__tests__/staffLate.test.tsx` ("late strip lists on-the-way and
late bookings by time left", "Hold 10 more min calls the API and announces", "tile and arrivals show ETA",
"spoken table name includes arrival", "released tonight appears"); `src/pages/owner/LatePolicyCard.test.tsx`
("auto-release disabled until a hold time is chosen", "saves both fields", "shows the guest preview");
`src/api/restaurant.test.ts` new case "toBookingView keeps late, defaults to null on old answers".

Playwright: new `frontend/e2e/restaurant-late.spec.ts` using `restaurant-fixture.ts` (isolated owned venue with
an all-day service so the test does not depend on the hour): "diner sends 10 min late from the manage link and
staff see On the way within 3 s" at 1440 and 390 px (no sideways scroll at 390), "staff hold 10 more minutes and
the diner page updates live", "owner sets a 15-minute hold and the confirmation shows Hold time", plus axe scans
of the manage page with the card open and of the staff floor with the strip. The release itself is covered in
pytest (time control), not in e2e.

## 10. Rollout and demo data

1. Merge order on Martim's branch: backend pure rules + tests, migration, endpoints, then frontend, then e2e.
2. Production: back up the database, run `python -m app.seed.migrate` on Postgres **before** the deploy (new
   columns are read by `describe`, so an old schema would 500 every booking answer).
3. All existing venues start with `late_grace_minutes = NULL` and auto-release off: diners can still send an ETA,
   no hold time is promised, nothing is released until an owner opts in.
4. Update the cron workflow (new step, same secrets; no new secret).
5. Demo seed: Casa Lumen (`demo_restaurant.py`) gets grace 15, auto-release **off** (otherwise the unattended demo
   would empty itself every evening). For today's next two `confirmed` bookings after the seed time it sets
   `eta_at = start + 10 min`, `eta_sent_at = start - 5 min`, `eta_count = 1`, so the floor shows "On the way" at
   once. One showcase venue (`demo_showcase.py`, the small quiet room one) gets grace 10 and auto-release on, with
   no seeded bookings today, for presenting the release live. The 20 Lisbon catalogue venues get grace 15,
   auto-release off (`lisbon_catalogue.py`), keeping re-runs idempotent (only set when NULL).
6. Docs: `docs/ux-restaurant.md`, `docs/user-guide-diner.md`, `docs/user-guide-staff.md`,
   `docs/user-guide-owner.md`, `docs/api.md`, `docs/data-model.md`, `docs/openapi.json` (regenerated), and the
   READ_ME_FIRST.md of `restaurant_service`, `routers`, `seed`, `frontend/src/pages/restaurant`, `pages/owner`, `e2e`.

## 11. External services, accounts, cost, legal

None. No new provider, account, secret or cost. The release email uses the existing outbox and provider
(`mail/providers.py`, Resend when configured, console otherwise) and the existing `EMAIL_ALLOWLIST`. If Martim later
wants SMS ("Your table was released") it would go behind a `SmsProvider` interface with a `LogSmsProvider`
default, chosen by `SMS_PROVIDER` / `SMS_API_KEY`; that is out of scope here. Legal: add one sentence to the
diner privacy text: "If you tell a restaurant you're running late, we share the arrival time you choose with it.
We keep it for 30 days after your booking."

## 12. Files touched

Backend (new): `backend/app/restaurant_service/late_arrivals.py`, `backend/app/routers/restaurant_cron.py`,
`backend/tests/test_late_arrivals.py`, `backend/tests/test_late_api.py`.

Backend (changed): `backend/app/models.py`*, `backend/app/seed/migrate.py`*,
`backend/app/restaurant_service/booking_rows.py`*, `backend/app/restaurant_service/staff_floor.py`*,
`backend/app/restaurant_service/emails.py`*, `backend/app/restaurant_service/profiles.py`*,
`backend/app/mail/templates.py`* (additive), `backend/app/routers/bookings.py`*, `backend/app/routers/staff.py`*,
`backend/app/routers/restaurants.py`*, `backend/app/routers/owners.py`*, `backend/app/main.py`*,
`backend/app/seed/demo_restaurant.py`, `backend/app/seed/demo_showcase.py`, `backend/app/seed/lisbon_catalogue.py`,
`backend/tests/test_migrate_restaurants.py`, `backend/tests/test_restaurant_emails.py`,
`backend/tests/test_mail_templates.py`, `backend/tests/test_staff_endpoints.py`, `backend/tests/test_redteam.py`,
`.github/workflows/email-cron.yml`*.

Frontend (new): `frontend/src/pages/restaurant/lateView.ts`, `useNow.ts`, `RunningLateCard.tsx`, `LateStrip.tsx`,
`LateBox.tsx`, `__tests__/lateView.test.ts`, `__tests__/runningLate.test.tsx`, `__tests__/staffLate.test.tsx`,
`frontend/src/pages/owner/LatePolicyCard.tsx`, `LatePolicyCard.test.tsx`, `frontend/e2e/restaurant-late.spec.ts`.

Frontend (changed): `frontend/src/api/restaurant.ts`*, `frontend/src/api/owner.ts`*, `frontend/src/api/restaurant.test.ts`,
`frontend/src/pages/restaurant/ManageBookingPage.tsx`*, `BookingSummary.tsx`*, `Confirmation.tsx`*, `StaffFloor.tsx`*,
`FloorLists.tsx`*, `SelectionPanel.tsx`*, `staffStatus.ts`*, `restaurant.css`*, `staff.css`*,
`frontend/src/pages/owner/HoursPage.tsx`*, `frontend/e2e/restaurant-fixture.ts`*.

`*` = shared with other restaurant features designed in parallel (most likely conflicts: `models.py`, `migrate.py`
`NEW_COLUMNS`, `booking_rows.describe`, `api/restaurant.ts`, `ManageBookingPage.tsx`, `StaffFloor.tsx`,
`email-cron.yml`). Append-only edits keep merges simple. `mail/templates.py` and `models.py` are shared with
events: only additions, event behaviour unchanged. Not touched: `seatmap/`, `room-editor/`, every event path.

## 13. Open decisions for Martim (with recommended default)

| # | Question | Recommended |
|---|---|---|
| D1 | Does a diner's ETA extend the hold? | No. The hold is the restaurant's rule; staff add 10 min with one tap (max 30) |
| D2 | Auto-release default for restaurants | Off; the owner opts in on the hours page |
| D3 | Status of an auto-released booking | `no_show` + `released_at` (counts in the no-show rate; no new status to teach every screen) |
| D4 | Hold time for restaurants that never set one | None shown (NULL) until the owner chooses; demo venues 15 min |
| D5 | When can the diner send an ETA? | From 90 min before the booking until the hold ends (or 60 min after start with no hold) |
| D6 | Clock badge drawn on the table in the staff map | Not in v1 (needs a new prop in the shared `seatmap/`); the strip, tiles and spoken names cover it |
| D7 | Email the diner when the table is released | Yes, with a cancelled calendar invite |
| D8 | Run the lazy release on public map/slots reads | Yes, only for venues with auto-release on, today only, bounded |
| D9 | Offer the released table to the waitlist | Yes, with the existing offer email (a link, not a hold) |
| D10 | Show the hold time on the public restaurant page and in the confirmation email | Phase 2 (public page: one line; email: avoid changing the existing email tests now) |
| D11 | Number of ETA options | 10 / 15 / 20 plus "I can't make it", as asked |

## 14. Size

**L**, about 6 developer days: backend rules, endpoints, sweep and race hardening 2 days; manage card and staff
floor 2 days; owner card, seed, docs 1 day; e2e, accessibility and review 1 day.
