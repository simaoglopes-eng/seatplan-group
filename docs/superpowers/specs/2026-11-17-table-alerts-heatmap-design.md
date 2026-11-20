# Table alerts and the table heatmap: design

Date: 2026-11-17. Status: design only, nothing implemented. Branch to build on: a new branch from
`codex/restaurantes-ux` (never `main`). Mockup: `table-alerts-heatmap.html` (desktop owner heatmap plus a 390 px phone
column with the diner's alert sheet and offer page).

This spec covers two features that share data:

1. **Table alerts ("Tell me when this table is free").** A diner subscribes to one exact table for a date, a
   start-time window and a party size. When a booking on that table is cancelled or moved, the first matching
   subscriber is offered the table, held for a short time, and books it in one tap.
2. **Table heatmap.** On the owner's dashboard, the floor plan coloured by how often each table is booked, requested
   or left empty over the last 7, 30 or 90 days, with seated time and a "Most chosen" ranking, so the owner can see
   where a premium could make sense.

They share one new demand counter (`table_demand_days`): every alert is also a "request" on the heatmap.

---

## 0. What exists today (verified in code)

| Area | Existing code reused | Notes |
|---|---|---|
| Holds | `core/holds.py` (`Hold` rows, UNIQUE per scope/resource/slot), `restaurant_service/holding.py` (`hold_tables`, `read_hold`, `consume_hold`, `check_hold_caps`, holder key `"<client>:<choice>:<sha256(hold_id)>"`) | `read_hold` matches holds by the hash of the hold id alone, so a hold created by the alert engine with holder key `alert:chosen:<hash>` is read, confirmed and consumed by the existing booking code without changes. |
| Booking confirm | `diner_flow.confirm_booking(session, venue, held, needs, contact, seat_id)` | Commits through `commit_or_seat_taken`; the `table_slots` primary key still has the final say. |
| Cancel and move | `manage_flow.cancel_booking` (calls `waitlist.offer_freed_tables`), `manage_flow.change_booking`, `staff_floor.move_booking`, `staff_floor.set_status` (staff cancel goes through `cancel_booking`), `service_plan.apply_proposal` | These are the five places where a table can be freed early. |
| Generic waitlist | `waitlist.py` (`WaitlistEntry`, `offer_freed_tables`), `POST /r/{vid}/waitlist` in `routers/bookings.py`, `WaitlistDialog.tsx` | Per date and time, not per table; it emails a link and does **not** hold anything (`queue_waitlist_offer` passes `expires=None`). Table alerts sit in front of it. |
| Occupancy | `occupancy.booked_slots`, `held_slots`, `merge`, `is_free`, `venue_tables`, `scope_for`; `map_view.fit_problem` | `Busy = {table_id: {slot,...}}`. |
| Time | `clock.slot_of`, `time_of_slot`, `is_past`, `now_local`, `local_datetime`, `hhmm`; `schedule.turn_minutes`, `window_for`, `check_bookable`, `periods_for_day`, `blackout_on` | 15-minute slots, venue-local wall clock. |
| Caps | `security.rate_limit`, `limit_reached`, `mailbox`, `network_of`, `client_ip`; `booking_caps.check_booking_caps`; `holding.client_key` | Same style of caps for alerts. |
| Email | `mail/outbox.enqueue` (idempotency key), `mail/outbox.send_now` (send one row at once, used for codes), `mail/providers.provider_from_settings` (Console by default, Resend by env), `mail/templates._compose`, `restaurant_service/emails.py` | Offer emails use `send_now`, so they do not wait for the 15-minute cron. |
| Scheduler | `POST /api/internal/email/process` (`routers/emails.py`), called by `.github/workflows/email-cron.yml` every 15 minutes | The only scheduler. Alert sweeps ride on it. |
| Dashboard | `dashboard.py` (`EXPECTED_STATUSES`, `SEATED_STATUSES`, one-day numbers), `GET /staff/{vid}/dashboard`, `StaffDashboard.tsx`; `/owner/:venueId/dashboard` renders `StaffPage` (tabs Floor, Dashboard, Optimise, Schedule) | The heatmap becomes a new tab, "Tables", between Dashboard and Optimise (the `Tab` union in `StaffPage.tsx` gains `"tables"`). |
| Floor drawing | `seatmap/roomScene.ts` (`outlinePath`, `polygonPath`), `seatmap/geometry.ts` (`tableCentre`), `pages/restaurant/floorPlanScene.ts` (`planLayout`, `viewBox`, `shouldTurn`, `project`) | The heatmap draws its own tables with these pure helpers; `FloorPlan.tsx` is not changed. |
| Diner map states | `map_view.table_state` gives `taken` / `held` / `too_small` / `blocked` / `free`; `tableView.ts` shows `taken` as "Booked" | The alert entry point is a Booked table. |

**Gap found while reading:** past bookings lose their tables. `booking_rows.release_slots` deletes the
`table_slots` rows when a booking is cancelled, completed or marked no-show, and the demo seed
(`demo_restaurant._seed_service`) never writes slots for past dinners. The only trace left is the `audit_log`
detail of `booking.create` / `booking.walkin` / `booking.change` / `booking.move`. The heatmap therefore needs a
durable `bookings.table_ids` column (section 4).

---

## 1. Goal and user stories

**Goal.** Turn "the table I wanted is booked" from a dead end into a fair queue, and show owners which exact tables
guests want, so exact-table choice pays for itself.

Diner

- D1. As a diner looking at the floor plan, when the window table I want is booked, I can ask to be told if it
  frees up between two times I choose, for my party size.
- D2. As a diner, I get an email the moment it frees up, the table is held for me for 15 minutes, and I book it with
  my details already filled in.
- D3. As a diner, I can see my place in the queue, change nothing by accident, and stop the alert at any time; when I
  stop it, my name and email are deleted.
- D4. As a diner, I am never charged, never booked without my action, and never queued behind someone who paid.

Staff

- S1. As staff, when I cancel or move a booking, I see that the freed table went to the next guest waiting for it,
  and until when it is held.
- S2. As staff, I see how many alerts wait on a selected table tonight (a count, no names).

Owner

- O1. As an owner, I see my floor plan coloured by bookings, requests, seated time or time left empty over the last
  7, 30 or 90 days.
- O2. As an owner, I see which tables guests choose themselves most often, and which ones they ask for but cannot
  get, so I can decide on a premium or a minimum spend.
- O3. As an owner, I can read the same numbers as a table (screen readers, export by copy and paste).

## 2. Non-goals

- No pricing, deposits, minimum spend or payment. The heatmap only informs; "Worth a premium?" is a note, never an
  action. (Premium pricing is its own future feature.)
- No SMS, push notifications or WhatsApp in this version. Email only, through the existing outbox and provider.
- No alerts on table combinations or on "any table in the Terrace". One alert = one table.
- No automatic booking on the diner's behalf. The diner always presses "Book".
- No swapping an existing booking onto the freed table ("upgrade my booking"). Listed as an open decision for later.
- No change to the generic waitlist's behaviour, except that it now runs after table alerts on a cancellation.
- No events vertical change. No change to `frontend/src/pages/room-editor/` (Sergio's area) or `FloorPlan.tsx`.
- No measured seating times. Seated time is the booked stay (start to planned end); see 6.2.

---

## 3. UX flow and exact copy

All copy in English. Restaurant theme (`frontend/src/design/restaurant-theme.css`): white and lavender surfaces,
purple `#4F3F8F` structure, the single pink `#B0347A` primary button per screen.

### 3.1 Diner: entry point in the booking flow (`StepTable` / `TablePanels`)

When the diner selects (tap, Enter or Space) a table whose state is `taken` and whose `fits_party` is true, the
table card in `TablePanels.tsx` shows:

- Badge: **Booked at 20:00**
- Text: *Someone has this table at your time. We can tell you if it frees up.*
- Secondary button: **Tell me if it frees up**

If `fits_party` is false the card keeps today's "Does not suit your party" text and shows no alert button.
If the restaurant has alerts switched off (feature flag) the button is not shown.

### 3.2 Diner: "Set a table alert" dialog (`TableAlertDialog.tsx`, uses `Dialog`)

Title: **Tell me when Table W3 is free**

Summary line (read-only, from the booking flow): *Casa Lumen · Friday 20 November · 2 people*

Fields:

| Field | Label | Default | Hint / rules |
|---|---|---|---|
| From | **Earliest start** | the time the diner chose | select of 15-minute times inside the same service |
| To | **Latest start** | chosen time + 60 min (clamped to the service's last seating) | must be on or after Earliest start; at most 3 hours apart |
| Name | **Name** | account name if signed in | 1 to 120 characters |
| Email | **Email** | account email if signed in (read-only then) | |

Notice under the fields (not a checkbox; legal basis is the diner's own request):
*We use your name and email only for this alert. We delete them as soon as you stop it, and at the latest 30 days
after the date. First come, first served: nobody can pay to jump the queue.*

Buttons: primary pink **Set alert**, text button **Cancel**.

Validation messages:

- *Choose a latest start on or after the earliest start.*
- *Choose a window of 3 hours or less.*
- *Please enter your name.* / *Please enter a valid email address.* (existing `validation.ts`)

Server answers shown in the dialog:

| Code | Message |
|---|---|
| 409 `table_free` | **Good news: Table W3 is free at 20:15.** Button: **Hold it now** (calls the normal hold for that time) |
| 409 `queue_full` | *Table W3 already has 15 people waiting for this date. Try another table or join the waitlist.* |
| 429 `rate_limited` | *You already have 3 table alerts here. Stop one before setting another.* (or the generic rate-limit message) |
| 422 `validation` | the server's message |

Result states (same dialog, title changes):

- Not signed in: title **Check your email**. *We sent a link to a•••@example.com. Open it within 60 minutes to start
  your alert for Table W3.* Button **Done**.
- Signed in (proven email): title **Alert set**. *You are number 2 for Table W3 on Friday 20 November between 19:30
  and 21:00. We will email you if it frees up.* Buttons: **See my alert** (to `/w/<token>`), **Done**.

### 3.3 Diner: the alert page `/w/:token` (`AlertPage.tsx`, phone first)

Header: restaurant name, then H1 per state. Summary card in every state:
*Table W3 · Window · seats up to 4 · Friday 20 November · starts between 19:30 and 21:00 · 2 people*

| State | H1 | Body | Actions |
|---|---|---|---|
| `pending` | **Start your table alert** | *Press the button to start your alert. (We ask so that nobody can sign you up without you knowing.)* | Pink **Start my alert**; text **Not me, delete this** |
| `waiting` | **You are number 2 in line** | *We will email you the moment Table W3 frees up between 19:30 and 21:00. If you are the next in line, we hold it for you for 15 minutes.* | Secondary **Stop this alert** |
| `offered` | **Table W3 is yours for 14:32** (live countdown, `aria-live="polite"` announced each minute) | *Held for you until 13:56. Book now to keep it. After that we offer it to the next person.* Offered time: **Friday 20 November at 20:00 · 2 people** | Pink **Book Table W3 at 20:00**; text **No thanks, pass it on** |
| `offered`, form open | **Your details** | Name (prefilled), Email (prefilled, read-only), Phone (optional), Notes (optional), "Where would you like to sit? (optional)" via existing `ChooseSeat` when chairs exist | Pink **Confirm booking** |
| `booked` | **Booked: Table W3 at 20:00** | Reuses `Confirmation` / `BookingSummary`. *Your alert is closed. We sent the booking to a•••@example.com.* | **Manage booking** |
| offer expired, still waiting | **This offer has ended** | *The 15 minutes ran out, so we passed Table W3 to the next person. Your alert is still on and you are back in line (number 3).* | Secondary **Stop this alert** |
| `ended` | **This alert has ended** | one of the reasons below | **Find another table** (to `/r/<vid>?date=&party=`) |

End reasons (copy):

- `stopped`: *You stopped this alert. We deleted your name and email.*
- `window_passed`: *The time you asked for has passed.*
- `missed_offers`: *We stopped this alert after two offers ran out without a booking.*
- `table_removed`: *The restaurant no longer offers Table W3.*
- `booked`: (state `booked` above)

Stop confirmation (dialog): **Stop this alert?** *We will delete your name and email straight away.* Buttons:
destructive **Stop alert**, **Keep it**. After: toast *Alert stopped.*

Decline confirmation: none (one tap, then the page shows *Thanks. We passed Table W3 to the next person. Your alert
is closed.*). Declining closes the alert, it does not re-queue.

Wrong or unknown token: same 404 page as `/b/:token` (*We could not find this link.*).

Example timeline used in all copy above and in the mockup: a guest cancels W3 on Friday 20 November at 13:41;
the first matching alert is offered the 20:00 start and the table is held until 13:56 (15 minutes). An offered
start is always at least 45 minutes after the offer (`OFFER_MINUTES + LEAD_MINUTES`).

### 3.4 Diner emails (all through `restaurant_service/emails.py` + new `mail/templates.py` functions)

1. **Confirm** (`table_alert_confirm`, only when not signed in). Subject: *Confirm your alert for Table W3 at Casa
   Lumen*. Body: *Hello Ana, press the button to start your alert for Table W3 on Friday 20 November between 19:30 and
   21:00 (2 people). If this was not you, ignore this email: without your click nothing starts, and we delete it
   within an hour.* Button: **Start my alert**. Reason line: *You received this email because someone entered this
   address on Casa Lumen's booking page.*
2. **Started** (`table_alert_started`, signed-in path only). Subject: *Your alert for Table W3 at Casa Lumen is on*.
   Button: **See or stop my alert**.
3. **Offer** (`table_alert_offer`, sent with `send_now`). Subject: *Table W3 at Casa Lumen is free: held for you
   until 13:56*. Body: *Good news: Table W3 is free on Friday 20 November at 20:00 for 2 people. It is held for you
   until 13:56. After that we offer it to the next person.* Button: **Book Table W3**. Secondary text link: *No
   thanks, pass it on*.
4. **Ended** (`table_alert_ended`, only for `missed_offers` and `table_removed`). Subject: *Your alert for Table W3
   at Casa Lumen has ended*.

No email for `stopped`, `window_passed` or `booked` (the booking confirmation is the email).

### 3.5 Staff: floor (`StaffFloor` / `SelectionPanel`)

- Selected table panel, new line when the count is above zero: *Table alerts tonight: 2 waiting* (count only).
- After a cancel or move frees a table that went to an alert, toast: *Table W3 went to the next guest on its alert.
  Held until 13:56.*
- A table held by an alert offer shows the existing "held" look on the floor (it is a normal `holds` row).

### 3.6 Owner: "Tables" tab (`StaffTables.tsx`, inside `StaffPage`)

Reached at `/owner/:venueId/dashboard?tab=tables` (and `/staff/:venueId?tab=tables` for demo staff). Owner menu
(`OwnerShell`) gains **Table insights** linking there.

Layout, top to bottom (desktop: plan left, ranking right; phone: stacked, the plan turns a quarter like
`FloorPlan`):

1. H2 **Which tables guests want** + muted line *Last 30 days · 18 October to 16 November · today not included*.
2. One filter row:
   - Period radio group (segmented): **7 days**, **30 days**, **90 days**.
   - Colour by (segmented): **Booked**, **Requested**, **Seated time**, **Left empty**.
   - Room chips when there is more than one room (`RoomTabs` look, no new component in the room editor).
   - Toggle button **Show as table** / **Show as plan**.
3. Stat tiles row (text, no chart): *317 bookings · 812 covers · 268 requests for a specific table · 14 table
   alerts*.
4. The plan: every active table filled with one of six steps of the purple scale; inside each table its label and
   the value (*W3 / 38*). Hover or focus shows a tooltip: *Table W3 · Window · 4 seats — 38 bookings, 29 chosen by
   the guest (76%), 44 requests (7 found it taken), 4 table alerts, 66 h seated, empty 69% of opening hours.*
5. Legend directly under the plan, titled with the metric and unit: *Bookings per table, last 30 days* with six
   swatches and their ranges: *0 · 1–8 · 9–16 · 17–24 · 25–32 · 33–40*.
6. Right column card **Most chosen**: top 5 tables by "chosen by the guest", horizontal bars in one hue with the value
   at the end, e.g. *W3 · 29 of 38 (76%)*. Below: **Asked for but not available**: top 3 by lost requests + alerts,
   e.g. *W3 · 7 found it taken · 4 alerts*.
7. Card **Worth a premium?** (only when the rule in 6.2 finds tables): *W3 and T2 are booked far more than the
   average table, and guests choose them on purpose. A premium or minimum spend may suit them. SeatPlan never changes
   prices on its own.*
8. Small print: *Seated time is the booked stay, from start to planned end. Requests count each guest once per table
   per day. "Found it taken" means a guest tapped the table but it was already booked or held.*

Empty and edge states:

- No bookings in range: EmptyState **No bookings in these 30 days yet** *Once guests book, each table gets a colour
  here.*
- Fewer than 20 bookings: notice *Only 12 bookings in this period, so treat the colours as a first hint.*
- Tables removed from the plan since: line under the legend *14 bookings were at tables that are no longer on the
  plan.*

---

## 4. Data model changes

All in `backend/app/models.py`; existing databases are upgraded by `backend/app/seed/migrate.py`
(`db.create_all` makes new tables; new columns go in `NEW_COLUMNS` in the same order as in `models.py`; restaurant
indexes go in `RESTAURANT_INDEXES`). Postgres production must run `python -m app.seed.migrate` before the deploy.

### 4.1 New column on `bookings`

```python
# The tables this booking was last given. Never cleared, so history survives release_slots.
table_ids: Mapped[list[int]] = mapped_column(JSON, default=list, server_default=text("'[]'"))
```

`NEW_COLUMNS += (("bookings", "table_ids", "JSON NOT NULL DEFAULT '[]'"),)`

Written in exactly one place: `booking_rows.write_slots` sets `booking.table_ids = sorted(table_ids)` (every
create, change, move, walk-in, re-plan and the demo seed go through it).

### 4.2 New table `table_alerts`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | queue tie-break |
| `public_id` | String(32), unique, default `new_public_id` | used in audit rows and the hold id derivation |
| `venue_id` | FK `venues.id`, index | |
| `table_id` | Integer, **no FK** | so `rooms.py` can still delete a table; a missing or inactive table ends the alert (`table_removed`) |
| `table_label` | String(40) | snapshot for emails after a rename |
| `date` | Date | venue-local service date |
| `earliest` | Time | first acceptable start |
| `latest` | Time | last acceptable start |
| `party_size` | Integer | |
| `needs_accessible` | Boolean, default False | from the booking flow |
| `high_chairs` | Integer, default 0 | from the booking flow |
| `name` | String(120) | blanked to `""` when the alert ends |
| `email` | String(254) | blanked to `""` when the alert ends |
| `token_hash` | String(64) | SHA-256 of the manage token (`security.hash_token`) |
| `status` | String(12), default `pending` | `pending`, `waiting`, `offered`, `booked`, `ended` |
| `end_reason` | String(20), nullable | `stopped`, `declined`, `window_passed`, `missed_offers`, `table_removed`, `unconfirmed` |
| `queued_at` | UtcDateTime | fair-order key; set on confirm, reset to now after a missed offer |
| `missed_offers` | Integer, default 0 | 2 ends the alert |
| `offer_seq` | Integer, default 0 | increments per offer; part of the hold id derivation |
| `offer_start_slot` | Integer, nullable | slot index of the offered start |
| `offer_expires_at` | UtcDateTime, nullable | |
| `created_at` | UtcDateTime, default now | |

No account id: a `GuestAccount` can be deleted by the events code (`events_service/accounts.delete_account`, which we
may not edit), and a foreign key would break that delete. The signed-in path only proves the email.

Indexes (`RESTAURANT_INDEXES`):

```
uq_table_alerts_token  CREATE UNIQUE INDEX IF NOT EXISTS uq_table_alerts_token ON table_alerts (token_hash)
ix_table_alerts_queue  CREATE INDEX IF NOT EXISTS ix_table_alerts_queue ON table_alerts (venue_id, date, table_id, status)
ix_bookings_venue_date CREATE INDEX IF NOT EXISTS ix_bookings_venue_date ON bookings (venue_id, date)
```

(They are also declared in `__table_args__` so `create_all` on a fresh database matches.)

### 4.3 New table `table_demand_days` (aggregate, no personal data)

| Column | Type | Notes |
|---|---|---|
| `venue_id` | FK `venues.id`, PK part | |
| `table_id` | Integer, PK part, no FK | same reason as above |
| `day` | Date, PK part | venue-local day **on which the diner asked** |
| `chosen_holds` | Integer, default 0 | a diner tapped this table and got the hold |
| `lost` | Integer, default 0 | a diner tapped it but it was booked or held (409) |
| `alerts` | Integer, default 0 | alerts that started (confirmed) on this table |

Increment with `db.insert_ignoring_duplicates` then `UPDATE ... SET x = x + 1` (atomic on both databases).
One count per client per table per day: guarded by `security.limit_reached` / `rate_limit` with key
`demand:<venue>:<table>:<client_key>` and a 24-hour window (only the keyed hash of the address is stored, as today).
Retention: rows older than 400 days are deleted by the sweep (aggregate, so a year-on-year view stays possible).

### 4.4 Backfill (one-off, idempotent)

New command `python -m app.seed.backfill_table_ids`: for bookings with `table_ids = []`, take the tables from
`table_slots` (active bookings), else from the newest `audit_log` row for that booking among `booking.create`,
`booking.walkin`, `booking.change` (`detail.tables`) and `booking.move` (`detail.to`). Bookings with no trace stay
empty and count under "no longer on the plan". Safe to run twice. Documented in `docs/runbook.md`.

---

## 5. API endpoints

New router file `backend/app/routers/table_alerts.py` (registered in `main.py`), plus one staff route. Bodies use
`Strict` models (`extra="forbid"`), text uses `core/text.PlainText`. Errors use the existing
`{"error": {"code", "message"}}` shape.

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/r/{vid}/tables/{table_id}/alerts` | Anyone (published venue); an optional guest bearer (`g.` token) makes it start at once | `{date, earliest, latest, party, needs_accessible, high_chairs, name, email}` | 201 `{status: "pending" \| "waiting", position?, table_label, date, earliest, latest, email_masked, alert_path?, demo_alert_path?}`. `alert_path` only on the signed-in path. `demo_alert_path` only under the existing demo conditions (local SQLite and `DEMO_MODE=1`), for e2e. 409 `table_free` `{start}`; 409 `queue_full`; 422; 429 |
| GET | `/api/w/{token}` | Token holder | – | `{status, end_reason, position, restaurant: {name, public_id, slug, timezone}, table: {id, label, zone_kind, max_party}, date, earliest, latest, party, offer?: {hold_id, start, expires_at, table_ids}, booking_path?}`. Runs the venue-day sweep first. Unknown token: 404 `not_found` |
| POST | `/api/w/{token}/confirm` | Token holder | `{}` | `{status: "waiting", position}`; idempotent; 409 if ended |
| POST | `/api/w/{token}/book` | Token holder, alert must be `offered` and not expired | `{name, email, phone?, notes?, seat_id?}` (`email` must be the alert's mailbox, `security.mailbox`) | 201 same shape as `POST /r/{vid}/bookings` (`booking`, `manage_token`, `manage_path`, `manage_link`); 409 `hold_expired` / `seat_taken` with alternatives (`conflict_response`); 429 from `check_booking_caps` |
| POST | `/api/w/{token}/decline` | Token holder | `{}` | `{status: "ended", end_reason: "declined"}`; releases the hold and offers the next subscriber in the same transaction |
| DELETE | `/api/w/{token}` | Token holder | – | 204; status `ended`, reason `stopped`, name and email blanked, hold released, next offer made |
| GET | `/api/restaurants/account/alerts` | `CurrentGuestAccount` (read of the shared model only) | – | `[{alert_path: null, restaurant, table_label, date, earliest, latest, status, position}]` matched by `mailbox(account.email)`; tokens are never returned here (P2, see 12) |
| GET | `/api/staff/{vid}/table-insights?days=7\|30\|90` | `CurrentUser` + `venue_access.load_for_staff` | – | see 5.1 |
| — | `GET /api/staff/{vid}/floor` (existing) | unchanged | – | each table gains `alerts_waiting: int` (additive field) |
| — | `POST /api/internal/email/process` (existing) | `X-Cron-Secret` | – | unchanged shape; also runs `table_alerts.sweep_all(session, now)` (bounded, see 7) |

Rate limits (per client address, `security.rate_limit`, keys prefixed `b-alert-`): create 10 per minute and 20 per
day per `network_of(address)`; `/w/...` 30 per minute (same as `MANAGE_LIMIT`); insights 30 per minute per user.

### 5.1 `GET /staff/{vid}/table-insights` response

```json
{
  "range": {"from": "2026-10-18", "to": "2026-11-16", "days": 30},
  "open_minutes": 12600,
  "totals": {"bookings": 317, "covers": 812, "chosen": 186, "requests": 268, "alerts": 14},
  "few_bookings": false,
  "rooms": [{"id": 1, "name": "Main room", "outline": {...}}],
  "zones": [{"id": 3, "name": "Window", "kind": "window", "x": 0, "y": 0, "w": 1000, "h": 150}],
  "tables": [
    {"id": 7, "label": "W3", "room_id": 1, "zone_kind": "window", "shape": "rect",
     "x": 260, "y": 45, "w": 90, "h": 60, "rotation": 0, "max_party": 4,
     "booked": 38, "no_shows": 2, "covers": 101, "chosen": 29,
     "requests": 44, "chosen_holds": 33, "lost": 7, "alerts": 4,
     "seated_minutes": 3960, "empty_share": 0.69,
     "chosen_rank": 1, "premium_candidate": true}
  ],
  "removed_tables_bookings": 14
}
```

`range.to` is yesterday in the venue's time zone. Only active tables are listed (`occupancy.venue_tables`).

---

## 6. Backend modules and pure functions

Tests first for every pure function (section 9).

### 6.1 Table alerts

**`backend/app/restaurant_service/alert_rules.py` (new, pure, no database)**

```python
OFFER_MINUTES = 15            # how long an offer holds the table
LEAD_MINUTES = 30             # an offered start must be >= now + OFFER_MINUTES + LEAD_MINUTES
MAX_WINDOW_MINUTES = 180
MAX_QUEUE_PER_TABLE_DAY = 15
MAX_LIVE_PER_MAILBOX_VENUE = 3
MAX_LIVE_PER_MAILBOX = 6
MAX_TABLES_PER_MAILBOX_DAY = 2
MAX_MISSED_OFFERS = 2
PENDING_MINUTES = 60
MAX_DAYS_AHEAD = 60

@dataclass(frozen=True)
class AlertView:  # what matching needs, copied out of a row
    id: int; queued_at: datetime; earliest_slot: int; latest_slot: int; party: int

def check_window(earliest: time, latest: time, period_end: time) -> str | None  # error text or None
def queue_order(alerts: Iterable[AlertView]) -> list[AlertView]                  # (queued_at, id)
def candidate_starts(alert: AlertView, allowed: set[int], earliest_ok: int) -> list[int]
def match_offer(alerts, free: set[int], freed: tuple[int, int], allowed_starts: set[int],
                turn: Callable[[int], int], earliest_ok: int) -> tuple[int, int, tuple[int, int]] | None
    # first alert in queue order with a start s such that window_for(s, turn(party)) is inside `free`,
    # overlaps `freed` (the cancellation created the space) and s >= earliest_ok; returns (alert_id, s, window).
    # Earliest feasible start wins for that alert.
def freed_slots(before: Busy, after: Busy) -> Busy   # slots per table present before and gone after
def position(alerts: list[AlertView], alert_id: int) -> int
def hold_id_for(secret: bytes, public_id: str, offer_seq: int) -> str
    # HMAC-SHA256, url-safe base64, 43 chars. Recomputed on GET /w/{token}; never stored.
def after_missed(missed: int) -> tuple[str, str | None]  # ("waiting", None) or ("ended", "missed_offers")
```

**`backend/app/restaurant_service/table_alerts.py` (new, database)**

- `create(session, venue, table, request, proven_email: bool) -> tuple[TableAlert, str]` – checks party
  (`availability.check_party_size`), fit (`map_view.fit_problem`), date range, window
  (`alert_rules.check_window` + `schedule.check_bookable` for both ends, same period), "free now" (any start in the
  window where `occupancy.is_free` on booked+held and `check_bookable` passes → raise 409 `table_free` with that
  start), caps (counts of live rows per mailbox, venue, table-day), then inserts with a new token
  (`security.new_token`, stored hashed). Signed-in: status `waiting`, `queued_at = now`, demand `alerts += 1`.
  Otherwise `pending`. Queues the confirm or started email.
- `confirm(session, alert)` – `pending` → `waiting`, `queued_at = now`, demand `alerts += 1`.
- `offer_freed(session, venue, day, before: Busy) -> list[TableAlert]` – the single hook. Reads `after =
  occupancy.booked_slots(...)`, computes `alert_rules.freed_slots(before, after)`, and for each freed table with live
  `waiting` alerts: builds `free` from booked+held, `allowed_starts` from `schedule.start_times` of the day's periods
  minus blackout, `earliest_ok` from `clock.now_local` + `OFFER_MINUTES + LEAD_MINUTES`; calls `match_offer`; on a
  match writes the hold rows (below), sets `offered`, `offer_seq += 1`, `offer_start_slot`, `offer_expires_at`, and
  records the change. Does not commit. Returns the offered alerts so the caller can send the email after commit.
- `_hold_for_offer(session, venue, day, table_id, window, hold_id)` – inside `session.begin_nested()`: delete
  expired `Hold` rows for those (scope, table, slot) keys, insert one `Hold` per slot with
  `holder_key = f"alert:chosen:{hash_token(hold_id)}"` and `expires_at = now + OFFER_MINUTES`. An
  `IntegrityError` rolls back the savepoint and the engine tries the next alert. (We cannot call
  `core/holds.take_hold`: it commits and has a fixed 5-minute expiry, and `core/holds.py` is shared with events.)
- `send_offers(session, alerts)` – after the caller's commit: `emails.queue_table_alert_offer` already queued the
  row in the transaction; this calls `mail/outbox.send_now` per row (never raises).
- `release_offer(session, venue, alert)` – deletes the alert's hold rows by holder key, `offer_* = None`.
- `expire_offer(session, venue, alert)` – `release_offer`, `missed_offers += 1`, `after_missed` → back of the queue
  (`queued_at = now`) or ended; then `offer_freed` again for that table and window (cascade to the next person).
- `stop(session, venue, alert, reason)` – `release_offer`, status `ended`, `end_reason`, `name = email = ""`, then
  `offer_freed` for an offered alert.
- `mark_booked(alert)` – status `booked`, `name = email = ""` (the booking has its own copy).
- `sweep_venue_day(session, venue, day)` – expire offers with `offer_expires_at <= now`; end `waiting` alerts whose
  latest start is past (`window_passed`); end alerts whose table is gone or inactive (`table_removed`); delete
  `pending` older than `PENDING_MINUTES`.
- `sweep_all(session, now, limit=50)` – the cron entry: the 50 oldest due items across venues (expired offers first),
  then deletes ended rows whose date is more than 30 days ago and `table_demand_days` older than 400 days. Bounded so
  the Vercel function stays well under 30 s.
- `waiting_counts(session, venue, day) -> dict[int, int]` – for the staff floor.

**Hooks (one line each, plus a `before = occupancy.booked_slots(...)` snapshot taken before release):**

| Function | Change |
|---|---|
| `manage_flow.cancel_booking` | snapshot, then after `session.flush()` call `table_alerts.offer_freed` **before** `waitlist.offer_freed_tables` (alerts first; the generic waitlist then sees the held slots as busy). Audit detail gains `offered_to_alert`. |
| `manage_flow.change_booking` | snapshot for the old day; after `write_slots` call `offer_freed(session, venue, old_day, before)` |
| `staff_floor.move_booking` | snapshot; after `write_slots` call `offer_freed` |
| `service_plan.apply_proposal` | snapshot; after the loop of `write_slots` call `offer_freed` |
| `staff_floor.set_status` (`no_show`, `completed`) | **not hooked in v1** (open decision 4) |

Callers that commit (`routers/bookings.cancel_booking`, `staff.py` status/move/optimise routes,
`manage_flow.change_booking` via `commit_or_seat_taken`) call `table_alerts.send_offers` after the commit. Staff
routes add `{"offered_to_alert": {"table": "W3", "held_until": "13:56"}}` to their response for the toast.

**`POST /w/{token}/book`** reuses `holding.read_hold(session, venue, hold_id_for(...))`,
`booking_caps.check_booking_caps`, and `diner_flow.confirm_booking`. It calls `table_alerts.mark_booked(alert)` before
`confirm_booking`, so the alert change and the booking commit together (a `SeatTaken` rolls both back).
`PartyNeeds` comes from the alert (party, accessible, high chairs), so `_check_hold_fits` sees the same window.

**`backend/app/restaurant_service/table_demand.py` (new)**

- `count(session, venue, table_ids, field, client)` – the guarded increment from 4.3.
- Called from `diner_flow.take_table_hold` after its commit when `choice == "chosen"` (`chosen_holds`), from the
  `hold` route in `routers/restaurants.py` in the `SeatTaken` branch when the diner named a table (`lost`), and from
  `table_alerts.create` / `confirm` (`alerts`).

**Emails:** `restaurant_service/emails.py` gains `queue_table_alert_confirm`, `queue_table_alert_started`,
`queue_table_alert_offer`, `queue_table_alert_ended`, idempotency keys `table-alert-confirm-<public_id>`,
`table-alert-offer-<public_id>-<offer_seq>`, `table-alert-ended-<public_id>`. Templates in `mail/templates.py`
(additive functions, built with the existing `_compose`). `mail/outbox._PERSONAL_LINK` widens from `[abej]` to
`[abejw]` so `/w/<token>` is redacted in logs and scrubbed after 30 days like the other personal links.

### 6.2 Table heatmap

**`backend/app/restaurant_service/insight_rules.py` (new, pure)**

```python
COUNTED = ("seated", "finishing", "completed", "no_show")   # "booked" in the past
SEATED = ("seated", "finishing", "completed")               # dashboard.SEATED_STATUSES
FEW_BOOKINGS = 20

@dataclass(frozen=True)
class BookingFact: table_ids: tuple[int, ...]; status: str; party: int; minutes: int; chosen: bool
@dataclass(frozen=True)
class DemandFact: table_id: int; chosen_holds: int; lost: int; alerts: int

def date_range(today: date, days: int) -> tuple[date, date]          # (today - days, today - 1)
def open_minutes(periods_by_day: Iterable[list[tuple[time, time]]]) -> int
def table_stats(facts, demand, table_ids: set[int], open_min: int) -> dict[int, TableStat]
    # booked, no_shows, covers, chosen, seated_minutes, requests (= chosen_holds + lost + alerts), lost, alerts,
    # empty_share = 1 - min(1, seated_minutes / open_min); a booking on two tables counts on both;
    # facts on tables not in table_ids add to removed_tables_bookings.
def chosen_ranking(stats) -> list[int]          # chosen desc, then requests desc, then label
def premium_candidates(stats) -> set[int]
    # booked >= 10 AND booked >= 1.5 x median booked of tables with the same max_party band
    # AND (chosen / booked >= 0.6 OR lost + alerts >= 5)
```

**`backend/app/restaurant_service/table_insights.py` (new, database)** – `insights(session, venue, days)`: one query
for bookings in range (`venue_id`, `date` between, status in `COUNTED`, columns only: `table_ids`, `status`,
`party_size`, `start_at`, `end_at`, `table_choice`), one for `table_demand_days`, `schedule.periods_for_day` and
`schedule.blackout_on` per day for open minutes, `occupancy.venue_tables` + `occupancy.zone_kinds` + `Room` rows
for geometry. Assembles the response of 5.1. A 90-day range for a busy room (about 10,000 bookings) is one indexed
query plus a Python pass; the target is under 500 ms (performance test in 9).

Seated time is the booked stay (`end_at - start_at`, from `turn_minutes`), not a measured time: the app does not
record when a party really leaves. The page says so.

---

## 7. Frontend components and routes

Read first: `frontend/READ_ME_FIRST.md`, `frontend/src/api/READ_ME_FIRST.md`,
`frontend/src/pages/restaurant/READ_ME_FIRST.md`, `frontend/src/pages/owner/READ_ME_FIRST.md`,
`frontend/src/pages/discover/READ_ME_FIRST.md`, `frontend/src/design/READ_ME_FIRST.md`,
`frontend/src/seatmap/READ_ME_FIRST.md` (reused helpers only), `frontend/e2e/READ_ME_FIRST.md`.

| File | New / changed | Job |
|---|---|---|
| `frontend/src/App.tsx` | changed | route `/w/:token` → `AlertPage` (`vercel.json`'s catch-all rewrite already serves it) |
| `frontend/src/api/restaurant.ts` | changed | `createTableAlert`, `getAlert`, `confirmAlert`, `bookFromAlert`, `declineAlert`, `stopAlert`, `getTableInsights`; `Server...` types and `to...` converters; `alerts_waiting` on floor tables |
| `frontend/src/pages/restaurant/TablePanels.tsx` | changed | "Booked at 20:00" card with **Tell me if it frees up** |
| `frontend/src/pages/restaurant/StepTable.tsx` | changed | opens `TableAlertDialog`; on `table_free` re-runs the hold for that time |
| `frontend/src/pages/restaurant/TableAlertDialog.tsx` | new | 3.2 |
| `frontend/src/pages/restaurant/alertView.ts` | new, pure | window options from the services, default window, state → copy, countdown text, masked email |
| `frontend/src/pages/restaurant/AlertPage.tsx` | new | 3.3; reuses `HoldCountdown`, `ChooseSeat`, `Confirmation`, `BookingSummary`, `validation.ts` |
| `frontend/src/pages/restaurant/SelectionPanel.tsx` | changed | "Table alerts tonight: 2 waiting" |
| `frontend/src/pages/restaurant/StaffFloor.tsx` | changed | toast from `offered_to_alert` after cancel / move |
| `frontend/src/pages/restaurant/StaffPage.tsx` | changed | new tab **Tables** after Dashboard; reads `?tab=` so the owner menu can deep-link |
| `frontend/src/pages/restaurant/StaffTables.tsx` | new | 3.6 layout, filters, tiles, ranking, premium note, table view |
| `frontend/src/pages/restaurant/TableHeatmap.tsx` | new | SVG plan: room outlines (`roomScene.outlinePath`), tables (`tableCentre`), layout and quarter turn (`floorPlanScene.planLayout`, `viewBox`, `shouldTurn`, `project`); keyboard focus per table (`seatmap/mapKeyboard.handleMapKey`), tooltip on hover and focus |
| `frontend/src/pages/restaurant/heatmapModel.ts` | new, pure | bin edges, step per value, label colour per step, tooltip sentence, metric formatting, table-view rows, sort |
| `frontend/src/pages/restaurant/table-insights.css` | new | `.hm-step-0` to `.hm-step-5`, legend, ranking bars |
| `frontend/src/pages/owner/OwnerShell.tsx` | changed | menu link **Table insights** → `/owner/:venueId/dashboard?tab=tables` |
| `frontend/src/pages/discover/DinerAccountPage.tsx` | changed (P2) | "My table alerts" list when signed in |

### 7.1 Heatmap encoding (dataviz rules)

- Form: the data's job is magnitude per table, placed where the table really is, so a floor-plan heatmap with a
  **sequential, single-hue** scale; the ranking is a separate horizontal bar list (one hue, no legend box: the card
  title names it). No dual axes, no rainbow, no red/green.
- Scale: six steps, light to dark, in the restaurant purple hue (checked with the dataviz validator: lightness is
  monotone, adjacent ΔL ≥ 0.06, hue spread 7°):
  `0 = #FFFFFF` (dashed outline, "none"), `1 = #E9E5F6`, `2 = #C9BFEA`, `3 = #A08FD6`, `4 = #7563BC`,
  `5 = #4F3F8F`. Darker always means "more of the chosen metric" (for **Left empty**: more empty).
- The two lightest steps are below 2:1 against white (validator WARN), so every table also has a 1.5 px `#5F5A75`
  outline (6.6:1) and its value as text, and a table view exists. Identity never depends on colour alone.
- Label ink inside a table: `#1F1B33` on steps 0 to 3 (≥ 5.8:1), white on steps 4 and 5 (≥ 4.9:1). Text is never the
  scale colour.
- Bins: equal-width steps from 1 to the maximum, rounded to whole numbers (hours for seated time, 10-point bands
  for Left empty), zero always its own step. The legend prints each range.
- Hover layer: a tooltip on hover and keyboard focus with every metric for that table; hit target is the whole table
  plus 6 px.
- Filters in one row above the plan; changing the metric keeps the table geometry and only repaints.
- Text alternative: **Show as table** renders a sortable `<table>` (Table, Area, Seats, Bookings, Chosen by guest,
  Requests, Alerts, Seated time, Left empty). The SVG has `role="img"` with an `aria-label` summary
  (*"Floor plan coloured by bookings. Most booked: W3 with 38. Least booked: B3 with 2."*), and each table is a
  focusable `role="button"` with its full tooltip sentence as its name.
- Forced colours / print: steps also carry a 45° hatch density (none, sparse … dense) under
  `@media (forced-colors: active)` and `@media print`.
- The restaurant theme is always light, so no dark ramp is shipped; the tokens are defined so a later dark theme can
  add its own validated steps.

---

## 8. Security, privacy and abuse limits

**Possession tokens.** The `/w/{token}` token is 32 random bytes (`security.new_token`), stored only as SHA-256; a
wrong token and an ended-and-purged alert both answer 404. The offer hold id is never stored: it is
`HMAC(SECRET_KEY, public_id:offer_seq)`, returned only to the token holder, and rotates with every offer.

**Nobody signs up someone else.** Without a proven guest account, an alert does nothing until the person presses
**Start my alert** on the page (a POST, so email link scanners that prefetch GET cannot start it). Unconfirmed alerts
are deleted after 60 minutes.

**Fair ordering.** Strict first come, first served on `(queued_at, id)`. Signed-in diners get no priority; there is
no paid priority. A missed offer sends the alert to the back of the line; two missed offers end it. A decline ends it.

**Caps (all 429 `rate_limited` or 409 `queue_full`):**

| Cap | Value |
|---|---|
| Create attempts per address | 10 per minute, 20 per day per `network_of` |
| Live alerts per mailbox at one venue | 3 |
| Live alerts per mailbox across SeatPlan | 6 |
| Tables per mailbox per venue-date | 2 |
| Live alerts per table per date | 15 |
| Days ahead | 60 |
| Window length | 3 hours, inside one service |
| Offer hold | 15 minutes; one live offer per alert; an offered start is at least 45 minutes away |
| Booking from an offer | the usual `check_booking_caps` (4 upcoming per mailbox, 10 attempts per address per day) |

Offer holds are ordinary `holds` rows, so they count towards the existing half-of-tables cap in
`holding.check_hold_caps`. That is intended: a flood of offers cannot lock the room either.

**GDPR.**

- Purpose and legal basis: running the alert the diner asked for (Art. 6(1)(b), steps at the data subject's
  request). No marketing use; no consent checkbox needed, but a clear notice (3.2).
- Minimisation: name and email only; no phone; no account link; no IP address (keyed hashes only, as today). Staff see
  counts, never names, until a booking exists.
- Retention: name and email blanked the moment an alert ends (stopped, declined, booked, missed, window passed,
  table removed); unconfirmed alerts deleted after 60 minutes; ended rows deleted 30 days after the date; outbox rows
  scrubbed after 30 days (existing `scrub_expired`, now also matching `/w/` links).
- Deletion: **Stop this alert** deletes at once. A deleted guest account leaves no alert behind that it is linked to
  (there is no link); alerts by the same email can be stopped from their emails.
- Heatmap: aggregate counts per table, no personal data, owner and demo staff only (`load_for_staff`, 404 for others).
  `table_demand_days` holds no identifiers.
- Docs to update: `docs/security.md` (new section S-alerts), privacy text on the booking page footer, `docs/data-model.md`.

**Other abuse.** Demand counting is deduplicated per client per table per day, so a script cannot paint a table dark
on the heatmap. The emails go only to the address that started the alert. Rate limits apply before any write
(router rule).

---

## 9. Tests to add

Backend (pytest, `backend/tests/`), written before the code for the pure modules and the security rules:

`test_alert_rules.py` (pure)
- `test_queue_order_is_first_come_first_served_with_id_tiebreak`
- `test_match_offer_picks_first_alert_whose_stay_fits_the_freed_table`
- `test_match_offer_skips_alert_whose_window_does_not_overlap_the_freed_time`
- `test_match_offer_skips_starts_before_lead_time`
- `test_match_offer_uses_earliest_feasible_start_in_window`
- `test_match_offer_respects_turn_time_of_the_alert_party`
- `test_freed_slots_is_before_minus_after_per_table`
- `test_check_window_rejects_reversed_and_longer_than_three_hours`
- `test_after_missed_requeues_once_then_ends`
- `test_hold_id_for_is_stable_per_seq_and_changes_with_seq`

`test_table_alerts_flow.py`
- `test_create_alert_unsigned_is_pending_and_queues_confirm_email`
- `test_create_alert_signed_in_with_proven_email_starts_waiting`
- `test_create_alert_on_free_table_returns_409_table_free_with_start`
- `test_create_alert_table_too_small_is_422`
- `test_confirm_needs_post_and_get_never_starts_alert`
- `test_cancel_offers_table_to_first_waiting_alert_and_holds_it_15_minutes`
- `test_cancel_offers_alert_before_generic_waitlist`
- `test_diner_change_and_staff_move_and_replan_trigger_offers`
- `test_offer_hold_is_readable_by_read_hold_and_books_with_existing_confirm`
- `test_book_from_offer_marks_alert_booked_and_blanks_personal_data`
- `test_book_from_offer_with_other_mailbox_is_422`
- `test_expired_offer_cascades_to_next_alert_on_sweep`
- `test_two_missed_offers_end_the_alert_and_send_ended_email`
- `test_decline_ends_alert_and_offers_next_in_same_commit`
- `test_stop_blanks_name_and_email_and_releases_hold`
- `test_table_removed_by_room_save_ends_alert_on_sweep`
- `test_window_passed_ends_waiting_alerts`
- `test_offer_email_is_sent_immediately_with_send_now`
- `test_concurrent_cancellations_offer_one_table_to_one_alert` (threads, like `test_holds.py`)

`test_table_alerts_security.py`
- `test_unknown_token_is_404_and_rate_limited`
- `test_caps_per_mailbox_venue_table_and_queue`
- `test_create_rate_limit_per_address_and_network`
- `test_alert_routes_refuse_unknown_fields`
- `test_hold_id_is_not_derivable_without_secret`
- `test_w_links_are_redacted_in_outbox_log_and_scrubbed` (also asserts `/a/ /b/ /e/ /j/` still redacted)
- `test_staff_floor_shows_counts_never_names`
- `test_draft_venue_alert_is_404`

`test_insight_rules.py` (pure)
- `test_date_range_excludes_today`
- `test_open_minutes_skip_blackouts_and_closed_days`
- `test_table_stats_counts_combined_bookings_on_each_table`
- `test_empty_share_is_one_minus_seated_over_open_and_clamped`
- `test_requests_dedupe_inputs_add_chosen_lost_and_alerts`
- `test_chosen_ranking_tiebreaks`
- `test_premium_candidates_rule`
- `test_removed_tables_are_counted_apart`

`test_table_insights_api.py`
- `test_insights_owner_only_and_demo_staff_on_demo`
- `test_insights_days_must_be_7_30_or_90`
- `test_write_slots_persists_table_ids_after_release`
- `test_demand_counter_once_per_client_per_table_per_day`
- `test_insights_90_days_under_budget` (in `test_restaurant_performance.py` style)

`test_migrate_table_alerts.py`
- `test_migrate_adds_bookings_table_ids_and_new_tables_twice_safely`
- `test_backfill_table_ids_from_slots_then_audit_log`

Existing suites that must stay green unchanged: `test_restaurant_booking_flow.py`, `test_bookings_manage.py`,
`test_staff_endpoints.py`, `test_staff_optimise.py`, `test_holds.py`, `test_mail_outbox.py`,
`test_outbox_retention.py`, `test_forbidden_paths.py`, all event tests.

Frontend (vitest):
- `alertView.test.ts`: `defaultWindow`, `windowOptions stay inside one service`, `stateCopy for every state and reason`, `countdownText`, `maskEmail`.
- `heatmapModel.test.ts`: `binEdges with zero step`, `stepFor`, `labelInk meets contrast`, `tooltipSentence`, `tableRows sort`, `empty metric darker means emptier`.
- `TableAlertDialog.test.tsx`: validation messages, `table_free` offers Hold it now, signed-in path shows position.
- `AlertPage.test.tsx`: each state renders its H1 and actions; Stop asks first; countdown announces.
- `StaffTables.test.tsx`: period and metric radio groups, legend ranges, Show as table, empty and few-bookings notices.

Playwright (`frontend/e2e/`):
- `table-alerts.spec.ts`: diner taps a Booked table → sets alert (demo path) → Start my alert → staff cancels that
  booking → alert page shows the offer with countdown → books → confirmation; second subscriber stays in line.
- `table-insights.spec.ts`: owner opens Table insights, switches 7/30/90 and metrics, legend updates, Show as table,
  keyboard focus on a table shows its tooltip; axe check (like `accessibility.spec.ts`); 390 px viewport has no
  horizontal scroll.

Also: `npm run contrast` gains the six heatmap pairs; `scripts/check_forbidden_paths.py --base main` passes.

---

## 10. Files touched

Backend (new): `backend/app/restaurant_service/alert_rules.py`, `table_alerts.py`, `table_demand.py`,
`insight_rules.py`, `table_insights.py`; `backend/app/routers/table_alerts.py`;
`backend/app/seed/backfill_table_ids.py`, `backend/app/seed/demo_table_history.py`; the test files in 9.

Backend (changed):

| File | Change | Shared with |
|---|---|---|
| `backend/app/models.py` | `Booking.table_ids`, `TableAlert`, `TableDemandDay` | everything (additive only; event models untouched) |
| `backend/app/seed/migrate.py` | `NEW_COLUMNS`, `RESTAURANT_INDEXES` | every feature adding columns (merge conflicts likely: append at the end) |
| `backend/app/main.py` | register `table_alerts.router` | every new router |
| `backend/app/restaurant_service/booking_rows.py` | `write_slots` sets `table_ids` | all booking features |
| `backend/app/restaurant_service/manage_flow.py` | hooks in cancel and change | diner manage features |
| `backend/app/restaurant_service/staff_floor.py` | hook in move; `alerts_waiting` | staff features |
| `backend/app/restaurant_service/service_plan.py` | hook in apply | optimiser features |
| `backend/app/restaurant_service/diner_flow.py` | demand count after chosen hold | booking flow features |
| `backend/app/restaurant_service/emails.py` | four queue functions | all restaurant emails |
| `backend/app/routers/restaurants.py` | `lost` count in hold's `SeatTaken` branch | diner routes |
| `backend/app/routers/bookings.py` | `send_offers` after cancel commit | manage link |
| `backend/app/routers/staff.py` | `table-insights` route; `offered_to_alert` in responses; `send_offers` | staff routes |
| `backend/app/routers/emails.py` | call `table_alerts.sweep_all` | **events too** (shared cron endpoint; event email processing unchanged) |
| `backend/app/mail/templates.py` | four new template functions | **events too** (additive) |
| `backend/app/mail/outbox.py` | `_PERSONAL_LINK` `[abej]` → `[abejw]` | **events too** (only widens redaction) |
| `backend/app/seed/demo_restaurant.py` | set `table_ids` on past bookings | demo |
| `backend/app/seed/run.py` | call `demo_table_history.seed` | demo (events seeding unchanged) |
| `backend/app/config.py` | `TABLE_ALERTS_ENABLED` (on when set to 1, or on local SQLite with `DEMO_MODE=1`; off otherwise) | config |

Read-me files to update: `backend/app/READ_ME_FIRST.md`, `backend/app/restaurant_service/READ_ME_FIRST.md`,
`backend/app/routers/READ_ME_FIRST.md`, `backend/app/seed/READ_ME_FIRST.md`, `backend/app/mail/READ_ME_FIRST.md`,
`frontend/src/pages/restaurant/READ_ME_FIRST.md`, `frontend/src/pages/owner/READ_ME_FIRST.md`,
`frontend/e2e/READ_ME_FIRST.md`.

Frontend: the files in section 7, plus `frontend/src/pages/restaurant/__tests__/` and `frontend/e2e/` files in 9, and
`frontend/scripts/contrast.mjs` (pairs).

Docs: `docs/api.md`, `docs/data-model.md`, `docs/security.md`, `docs/ux-restaurant.md`, `docs/user-guide-diner.md`,
`docs/user-guide-owner.md`, `docs/user-guide-staff.md`, `docs/runbook.md`, `docs/email.md`, `docs/CHANGELOG.md`.

Not touched: anything under `frontend/src/pages/{events,editor,join,account,room-editor}/`,
`backend/app/events_service/`, `backend/app/routers/{events,attendee,guest_accounts,guest_events,visitor}.py`,
`backend/app/core/holds.py`, `frontend/src/pages/restaurant/FloorPlan.tsx`, `vercel.json`.

---

## 11. Rollout and demo data

Order of work (each step one verified commit):

1. `Booking.table_ids` + `write_slots` + migrate + backfill command + tests.
2. `insight_rules` (tests first) → `table_insights` → route → `StaffTables` / `TableHeatmap` → e2e.
3. `table_demand_days` + counting.
4. `alert_rules` (tests first) → `TableAlert` model + migrate → `table_alerts` engine + hooks → router → emails →
   sweep in cron.
5. Diner UI (dialog, `/w/` page) → staff toast and counts → e2e.
6. Docs and read-mes.

Production: back up the database, run `python -m app.seed.migrate`, then `python -m app.seed.backfill_table_ids`,
then merge (per the team's Vercel workflow). Ship alerts behind `TABLE_ALERTS_ENABLED` (env var on Vercel; off until
Martim switches it on); the heatmap has no flag.

Demo seeding (`DEMO_MODE=1` only), new `seed/demo_table_history.py`, `random.Random(2026)` like the other seeds:

- Casa Lumen: 90 days of past lunches and dinners on its 18 tables, with realistic bias: window tables W1 to W4 and
  terrace T2/T3 chosen by the guest about 70% of the time; the bar stools B1 to B3 rarely chosen; Q4 (10 seats) mostly
  empty; `table_choice="chosen"` on the biased picks; `table_demand_days` rows matching (more `lost` on W3, T2).
- The four showcase restaurants (`demo_showcase.py`): 30 days of the same.
- Two waiting alerts on Casa Lumen W3 for tomorrow 19:30 to 21:00, `@example.com` addresses, so the staff count and
  the e2e flow have data.
- The 20 Lisbon catalogue restaurants get no history (their pages already say the floor plan and availability are
  simulated).

---

## 12. Open decisions for Martim

| # | Question | Recommended default |
|---|---|---|
| 1 | How long does an offer hold the table? | **15 minutes** (offer email is sent at once with `send_now`) |
| 2 | Keep the cron at every 15 minutes or move to 5? | **Keep 15.** Expired offers also cascade on decline, on the alert page and on any diner hold at that venue. If the repository is private, every-5-minutes costs about 8,640 billed Actions minutes a month (over the 2,000 free); at 15 it is about 2,880, already over the free minutes on a private repo, so check the repo's visibility. |
| 3 | Who goes first on a cancellation: table alerts or the generic waitlist? | **Table alerts first**, generic waitlist gets what is left |
| 4 | Also offer tables freed by a no-show or an early finish? | **No in v1** (the lead time is too short for an email to be useful) |
| 5 | Must anonymous diners confirm by email, or require sign-in? | **Confirm by email** for anonymous; signed-in diners with a proven email start at once |
| 6 | Missed offers: back of the line, or keep the place? | **Back of the line once, ended after two** |
| 7 | Can the offer be booked under another email? | **No**, same mailbox as the alert (stops resale of offers) |
| 8 | Should the heatmap be visible to staff too, or owners only? | **Owners and demo staff** (aggregate data, no names) |
| 9 | "Worth a premium?" note: show it? | **Yes**, worded as a hint, with the rule explained on hover |
| 10 | `table_demand_days` retention | **400 days** (no personal data; allows a year-on-year view later) |
| 11 | "Swap my booking to this table" alerts for diners who already booked | **Later phase** |
| 12 | "My table alerts" on `/restaurants/account` | **P2**, after the core flow ships |

## 13. External services, cost and legal steps

No new external service and no new dependency. Email goes through the existing provider interface
(`mail/providers.Provider`: `ConsoleProvider` by default, `ResendProvider` over httpx when `EMAIL_PROVIDER` and the
API key are set on Vercel: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`; while `EMAIL_ALLOWLIST` is set,
only listed addresses receive alert emails, which is the safe demo setting). Steps for Martim:

- **Email volume:** each alert sends at most 1 confirm + 1 to 3 offers + 1 ended email. Check that the Resend plan's
  monthly and daily limits cover it once real email is switched on (Resend's free tier has a daily cap); the
  provider stays Console until the env vars are set.
- **GitHub Actions:** no change needed; see decision 2 for minutes if the cron moves to 5 minutes.
- **Legal:** add table alerts to the privacy notice (purpose, data, 30-day retention, how to stop), and to the record
  of processing activities if one is kept. No cookie or consent banner change (no tracking; the session stays in
  `sessionStorage` as today).

## 14. Size and effort

**L.** About 7 to 9 working days for one developer:

- Heatmap (column, backfill, insights, tab, model, e2e): 3 days.
- Alerts engine, hooks, router, emails, sweep and security tests: 3 to 4 days.
- Diner and staff UI, e2e, docs: 1.5 to 2 days.

Main risks: the five hooks touch busy shared booking code (merge conflicts with other restaurant features);
offer cascades depend on the 15-minute cron when nobody visits; seated time is planned, not measured; historical
heatmap data before the backfill is only as good as the audit log.
