# My bookings, favourites, rebooking and per-table ratings: design

Date: 2026-11-17. Status: design, not implemented. Branch for the work: a new branch off
`codex/restaurantes-ux` (never `main`). Slug: `my-bookings`.

Mockup (static, desktop + 390 px phone, not part of the repository):
`C:\Users\marti\AppData\Local\Temp\claude\51127802244b2e7b\048014bd-52bb-4f3b-b71e-3f8ba641286a\scratchpad\features\my-bookings.html`

---

## 0. What the code does today (verified, and why it shapes this design)

| Fact | Where | Consequence for this feature |
|---|---|---|
| A booking has no link to a person, only `email`, `name`, `phone`, `notes`, `prefs`, `chosen_seat_id`, `table_choice` (`auto`/`chosen`), `status`, `source` | `backend/app/models.py` `class Booking` | New column `bookings.account_id` |
| The manage token is returned once by `POST /r/{vid}/bookings` and only its SHA-256 hash is stored (`manage_token_hash`); `booking_rows.load_by_token` finds it | `routers/restaurants.py` `book`, `restaurant_service/booking_rows.py` | My bookings cannot hand out `/b/{token}` links for old bookings. Signed-in diners get account-scoped manage routes that call the same `manage_flow` functions |
| The tables of a booking live only in `table_slots`; `occupancy.tables_of` reads them; every closing status (`completed`, `no_show`, `cancelled`, `staff_floor.CLOSING_STATUSES`) calls `booking_rows.release_slots`, which deletes them | `occupancy.py`, `staff_floor.py` line 29 and 193-200, `manage_flow.cancel_booking` | A past booking does not know its table any more. "Same table as last time" and per-table ratings need a durable snapshot: new column `bookings.seated_tables`, written by `booking_rows.write_slots` and never cleared |
| Diner accounts are `GuestAccount` rows (name, email, scrypt password, `email_proven`, `session_version`, consent). Sign-in is email + password (`SignInForm`, `/guest/login`); the 6-digit email code is only used at sign-up and password reset | `models.py` `GuestAccount`, `events_service/accounts.py`, `pages/account/SignInForm.tsx` | Reuse `CurrentGuestAccount` (`security.require_guest_account`) for every new diner route |
| There is **no diner sign-up**. The only sign-up is `POST /j/{token}/register` (an event's shared link, `visitor.py`), which needs an event. `/restaurants/account` (`pages/discover/DinerAccountPage.tsx`) only signs in | `routers/visitor.py`, `DinerAccountPage.tsx` | This feature adds a restaurant-side sign-up with its own code purpose `diner`, copying the approved owner pattern (`restaurant_service/owner_accounts.register/verify`, decisions-log 2026-11-13 items 6 and 12) |
| `email_proven` is false when the sign-up code was shown on screen (demo, `accounts.may_show_code`: `DEMO_MODE=1`, console provider, `@example.com`) | `accounts._create_account` | Claiming old bookings by email requires `email_proven`. A second claim path uses the manage token as proof |
| Account deletion is `events_service/accounts.delete_account` (`POST /guest/me/delete`): it detaches event guest rows, then `session.delete(account)`. `restaurant_reviews.account_id` already has `ON DELETE CASCADE`. SQLite runs with `PRAGMA foreign_keys=ON` (`db._enable_sqlite_foreign_keys`) | events code, protected | We cannot edit deletion. Every new reference to `guest_accounts` must carry a database-level `ON DELETE SET NULL` / `CASCADE`, so the existing deletion keeps working unchanged |
| Reviews: one per account and restaurant (`RestaurantReview`, PK `(venue_id, account_id)`), score 0-10, `table_type` chosen by the reviewer, `verified` when a completed diner booking at that restaurant has the same email and the account is `email_proven` | `restaurant_service/reviews.py` `save`, `summaries`, `list_reviews`; `routers/discovery.py` | Per-table ratings use only verified reviews and take the table and party from the booking, never from the reviewer |
| New columns on existing databases go in `NEW_COLUMNS` (same order as `models.py`), restaurant indexes in `RESTAURANT_INDEXES`; Postgres never auto-creates | `backend/app/seed/migrate.py` | Section 5 lists the exact entries |
| Discovery links already prefill the booking flow: `/restaurants/<slug>?date=&time=&party=` → `useLinkedTime` checks the time once and jumps to the table step | `pages/restaurant/useLinkedTime.ts`, `useBookingFlow.ts` `LinkAnswers` | "Book again" and "Same table as last time" are links of the same kind, plus `table=` and `again=` |
| Booking caps: 4 upcoming per mailbox per restaurant, 10 attempts per address per restaurant per day | `restaurant_service/booking_caps.py` | Unchanged; signed-in diners are not exempt |

No external service is needed: everything runs on the existing database, outbox and Vercel function.

---

## 1. Goal and user stories

**Goal.** A diner with a SeatPlan account sees every booking in one place, books a favourite place
again in two taps, can ask for the exact table they liked, and sees how other verified guests rated
each table before choosing.

### Diner
1. As a diner who is signed in, when I book, the booking appears in My bookings without any extra step.
2. As a diner who booked before I had an account, I can add those bookings by proving the email (my account email is verified) or by opening the manage link from the email.
3. As a diner, I see my upcoming bookings first (date, time, party, table, restaurant) and can change or cancel them from there.
4. As a diner, I see my past visits and can "Book again" (same party, same time, next same weekday) or "Same table as last time" (also asks for the same table).
5. As a diner, I can save restaurants (a heart on cards and on the restaurant page) and find them under Saved.
6. As a diner choosing a table, I see "Table 12 · 9.4 from couples" when enough verified guests rated that table, and a "Last time" marker on the table I had before.
7. As a diner, I can create an account from the restaurant side (not only through an event link).
8. As a diner, deleting my account removes my saved restaurants and unlinks my bookings.

### Staff
9. As staff, I see on the floor that a guest "Asked for the same table as last time", so I do not move them without a reason.

### Owner
10. As an owner, I see a "Table ratings" card on the dashboard: average verified score per table, with how many reviews and which kind of party liked it most.

---

## 2. Non-goals

- No social login, no phone/SMS login, no passwordless magic links (sign-in stays email + password).
- No loyalty points, visit counts shown to staff, or guest profiles/CRM for restaurants.
- No hiding or deleting a single booking from My bookings in v1 (decision D4).
- No "Download my data" export in v1 (decision D6).
- No notifications for favourites (new times, offers). No public favourite counts.
- No per-seat ratings (only per table). No ratings on combined tables (they count for the restaurant only).
- No change to event pages, event accounts, `/my` pages or the account deletion code.
- No change to `pages/room-editor/` (Sergio) or `restaurant_service/rooms.py`.
- No new emails. Change and cancellation emails sent after an account-side change are the existing ones (`emails.queue_change`, `queue_cancellation` with `token=""`, which link to the restaurant page as staff changes do).

---

## 3. UX flow per screen, with exact copy

The restaurant theme applies (`frontend/src/design/restaurant-theme.css`): white surfaces on lilac
`--c-bg`, purple `--c-primary` #4F3F8F for structure, links and secondary buttons, **one** pink
`--c-cta` #B0347A button per screen, bold sans-serif headings. Flat cards, no shadows beyond the
existing card token.

### 3.1 Public header (`PublicHeaderActions.tsx`)

- Signed out: primary button `Log in` (unchanged).
- Signed in: primary button `My bookings` (was `My account`), still to `/restaurants/account`.

### 3.2 `/restaurants/account`, signed out (`DinerAccountPage.tsx`)

Heading `Your SeatPlan account`. A two-option segmented control: `Log in` | `Create an account`.

**Log in** (existing `SignInForm`, unchanged), link `Forgot your password?` → `/my/forgot`.

**Create an account** (new `DinerSignUpForm`):
- Intro: `Keep all your bookings in one place, book again in two taps and save the restaurants you love.`
- Fields: `Your name`, `Email` (hint `We send a 6-digit code to check it is yours.`), `Password` (hint `At least 10 characters.` — the rule is `accounts.check_new_password`).
- Checkbox (required): `I agree that SeatPlan keeps my bookings, saved restaurants and reviews in my account. I can delete my account at any time.` + a `<details>` below it, summary `How we use your data`, body: `We keep your name, email, password (scrambled), the bookings you add, your saved restaurants and your reviews. Restaurants see your bookings as they do today, never your saved list. Delete your account in Account settings and we remove all of it from your account at once.` (There is no `/privacy` route today; decision D7.)
- Pink button: `Send my code`.
- Errors: `Please enter your name.`, `Please enter a valid email.`, `Please agree so we can keep your bookings in your account.`

**Code step**: heading `Check your inbox`; text `We sent a 6-digit code to m***@gmail.com. It expires in 15 minutes.`; field `Code`; pink button `Create my account`; link `Send a new code`. Demo (`demo_code` returned): grey note `Demo: your code is 482913.` Wrong code: `That code is not right. You have 4 tries left.` Existing address: the same "Check your inbox" screen (the email says the account exists), so nobody learns who has an account.

After success: toast `Welcome, Marta. Your account is ready.` and the signed-in page (3.3). If the
diner came from a Confirmation or manage page with a manage token in router state, that booking is
claimed first (3.9) and the toast is `Welcome, Marta. Your booking at Tagus Terrace is in My bookings.`

### 3.3 `/restaurants/account`, signed in: My bookings (`MyBookingsPage`)

Desktop: two columns (bookings 2/3, Saved 1/3). Phone: one column, tabs.

- Heading `My bookings`, sub-line `Signed in as Marta Silva · marta.silva@gmail.com`.
- Tabs (`role="tablist"`): `Upcoming (2)` · `Past (3)` · `Saved (4)` (Saved is a tab on phones only; on desktop it is the right column).
- **Claim banner** (only when `claimable > 0`): `We found 3 earlier bookings made with marta.silva@gmail.com.` Pink button `Add them to My bookings`. Secondary text link `Not now` (hides it for this browser session). After success: toast `3 bookings added.`
- Unproven email (demo or old account) and nothing linked: muted note `Booked before you had an account? Open the link in your confirmation email and choose "Save to My bookings".`

**Upcoming card** (one per booking, soonest first):
- Line 1 (bold): restaurant name. Line 2: `Saturday 21 November · 19:45 · 2 guests`. Line 3: `Table 4 · Panorama room` (labels from `seated_tables`; `Table 4 + 5` for combined). Chip: `Confirmed` / `Seated`.
- Optional chips: `Seat 2 · Facing the window` (chosen chair), `1 high chair`, `Wheelchair access`.
- Buttons (purple secondary): `Change or cancel` → `/restaurants/account/bookings/{id}`; text link `Directions` (existing `maps_url`).

**Past card** (most recent first):
- Line 2: `Friday 30 October · 20:30 · 2 guests`; Line 3: `Table 12 · Quay terrace`. Status chip: `Visited` (completed), `Cancelled`, `Missed` (no_show).
- If visited and no review: text link `Rate your table` → `/restaurants/{slug}#reviews`. If reviewed: `You rated 9/10`.
- Buttons (purple secondary): `Book again`, `Same table as last time` (only when `rebook.same_table` is true; otherwise no button, and if the table is gone a muted line `Table 12 is no longer available here.`).
- Restaurant not bookable (draft/unpublished): muted line `Tagus Terrace is not taking bookings on SeatPlan right now.` and no rebook buttons.
- `Show more` at the end (20 per page).

**Saved column/tab**: heading `Saved restaurants`. Each row: cover thumbnail, name, `Seafood · Cais do Sodré`, filled heart button (`aria-pressed="true"`, label `Remove Tagus Terrace from saved`), text link `Book`. Empty: `Tap the heart on a restaurant to save it here.`

**Empty states**: Upcoming: `No upcoming bookings.` + link `Find a table` → `/`. Past: `Your past visits will appear here.`

**Footer**: `Account settings` → `/my/account` (existing page; password and deletion) · `Sign out`.
Note under it: `Deleting your account removes your saved restaurants and takes your bookings out of it. Restaurants keep their own booking records.`

### 3.4 `/restaurants/account/bookings/:bookingId` (`AccountBookingPage`)

Same content as the manage page (`BookingSummary`, `ChangeBookingForm`, `ChangeSeat`, cancel),
reached with the session instead of the token. Back link `← My bookings`. Heading `Your booking at
Miradouro 7`. Not found / not yours: `We cannot find this booking in your account.` + link
`Back to My bookings`. Signed out: redirect to `/restaurants/account` with the target kept in router state.

Cancel confirmation dialog copy (existing): `Cancel this booking?` / `Yes, cancel` / `Keep it`.

### 3.5 Book again / Same table as last time

`Book again` opens `/restaurants/{slug}?date=2026-11-20&time=20:30&party=2&again=book`.
`Same table as last time` opens the same plus `&table=12&again=table` (several ids for combined:
`table=12,13`).

- Date: the next same weekday after today (`next_same_weekday`), so Friday → next Friday.
- The existing `useLinkedTime` checks the time. Free → straight to the table step. Not free → the
  times list with `20:30 is not free any more. Please pick another time.` (existing copy).
- At the table step with `again=table`:
  - Table free: the plan opens on that table's room, the table is pre-selected (not held), the
    card shows a purple info line `Same table as last time` and the pink button `Hold 12 & continue →`.
  - Table taken at that time: banner `Table 12 is taken at 20:30 on Friday 20 November. It is free at 19:00 and 21:45.` Each time is a button that switches the time (`pickTime`). If it is free at no time that day: `Table 12 is not free that day. Choose another table or another day.`
  - Table no longer bookable for this party: `Table 12 cannot take 5 guests. Here is our suggestion instead.`
- The created booking stores `rebook_kind = "same_table"` (or `"again"`), only when signed in.

### 3.6 Table step additions (`StepTable`, `TableCard`, `FloorPlan`)

- Rating line on the table card (only from `GET /r/{vid}/table-ratings`):
  - Party kind of the current search has ≥ 3 verified reviews at that table: `★ 9.4 from couples` + muted `8 verified reviews`.
  - Else table has ≥ 3 verified reviews: `★ 8.9 from 11 verified reviews`.
  - Else nothing (no "no reviews yet" noise).
  - Kinds and words: party 1 `solo diners`; 2 `couples`; any high chair `families`; 3-4 `small groups`; 5+ `groups`.
  - `Why this table` gets nothing new.
- "Your table last time" (signed in, `GET /diner/restaurants/{vid}/last-table`):
  - On the plan, a small purple pin with the text `Last time` above that table (on a dark night plan the pin is white with purple text). Screen readers: the table's description ends with `, your table last time`.
  - On the card: purple info line `You sat here on Friday 30 October.`
- A screen with nothing to show for these looks exactly as today.

### 3.7 Details step when signed in (`StepDetails`)

- Name and email prefilled from `GET /guest/me` (editable). Line above the fields: `Signed in as Marta Silva. This booking will be saved in My bookings.`
- If the diner changes the email: hint `Confirmation emails go to this address. The booking still appears in your account.`

### 3.8 Confirmation (`Confirmation.tsx`)

- Linked (`linked: true`): line `Saved in My bookings.` with link `See My bookings`.
- Signed out: card `Keep track of this booking` / `Create a free account to see all your bookings, book again in two taps and save restaurants.` Purple button `Create an account` (the pink button on this screen stays the existing main action). Opens `/restaurants/account` in sign-up mode with the email prefilled and the manage token in router state (never in the URL).

### 3.9 Manage link page (`ManageBookingPage.tsx`, `/b/:token`)

- Signed in and booking not linked: purple button `Save to My bookings` → `POST /diner/bookings/claim-link`; success toast `Saved in My bookings.`; linked to another account: nothing is shown (the server answers 409 `conflict` with `This booking is in another account.`, shown as toast).
- Signed out: text link `Have a SeatPlan account? Log in to save this booking.`

### 3.10 Favourite heart (`RestaurantCard.tsx`, `RestaurantPage.tsx`)

- Outline heart button, label `Save Tagus Terrace`; filled when saved, label `Remove Tagus Terrace from saved`, `aria-pressed`.
- Signed out: tapping it goes to `/restaurants/account` with `state.saveSlug`; after log-in the restaurant is saved and the diner returns to where they were; toast `Saved Tagus Terrace.`
- Cap reached: toast `You can save up to 200 restaurants. Remove one first.`

### 3.11 Review form note (`RestaurantReviews.tsx`)

When `GET /restaurants/{slug}/reviews/mine` returns `table_label`: muted line under the score
`Your score also counts for Table 12, where you sat on 30 October.` Nothing else changes.

### 3.12 Staff floor (`SelectionPanel.tsx`) and dashboard (`StaffDashboard.tsx`)

- Selection panel line under the guest name, only when `rebook_kind == "same_table"`: badge `Asked for the same table as last time`; `"again"`: badge `Booked again`.
- Dashboard card `Table ratings` / sub `Verified reviews only. A score shows after 3 reviews.` Table rows: `Table 12 · Quay terrace` — `9.2` — `11 reviews` — `Best with couples (9.4)`. Under 3: `2 reviews · too few for a score`. Empty: `No verified table reviews yet.`

---

## 4. Data model changes

All new columns are appended at the end of their class in `models.py`, in the same order as in
`NEW_COLUMNS`, with server defaults written word for word the same (seed `READ_ME_FIRST.md` rule).

### 4.1 `bookings` (class `Booking`)

| Column | Type (models.py) | NEW_COLUMNS DDL | Why |
|---|---|---|---|
| `account_id` | `Mapped[int \| None] = mapped_column(ForeignKey("guest_accounts.id", ondelete="SET NULL"))` | `("bookings", "account_id", "INTEGER REFERENCES guest_accounts (id) ON DELETE SET NULL")` | Owner of the booking in My bookings. SET NULL so the protected `delete_account` keeps working and unlinks |
| `seated_tables` | `Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, server_default=text("'[]'"))` | `("bookings", "seated_tables", "JSON NOT NULL DEFAULT '[]'")` | `[{"id": 12, "label": "12"}]`: the tables the booking last held, kept after `release_slots` |
| `rebook_kind` | `Mapped[str \| None] = mapped_column(String(12))` | `("bookings", "rebook_kind", "VARCHAR(12)")` | `"again"`, `"same_table"` or null; for the staff badge |

### 4.2 `restaurant_reviews` (class `RestaurantReview`)

| Column | Type | NEW_COLUMNS DDL | Why |
|---|---|---|---|
| `table_id` | `Mapped[int \| None] = mapped_column(Integer)` (no FK on purpose: `rooms.py` bulk-deletes tables and must not be touched) | `("restaurant_reviews", "table_id", "INTEGER")` | The single table of the verified visit; null for combined tables or unverified reviews |
| `table_label` | `Mapped[str \| None] = mapped_column(String(40))` | `("restaurant_reviews", "table_label", "VARCHAR(40)")` | Label at the time of the visit, for the owner card when a table was renamed |
| `party_kind` | `Mapped[str \| None] = mapped_column(String(12))` | `("restaurant_reviews", "party_kind", "VARCHAR(12)")` | `solo`, `couple`, `family`, `small_group`, `group`; derived from the booking, never typed |

Note: on a very old SQLite database `upgrade_schema` first adds the columns (`_add_missing_columns`),
then `_upgrade_review_scale` renames the table, recreates it from `RestaurantReview.__table__` (now
with the new columns) and copies rows with an explicit column list, so the new nullable columns end
up null. The order stays as it is; `test_review_scale_upgrade_still_works_with_new_columns` covers it.

### 4.3 New table `diner_favourites` (class `DinerFavourite`, made by `create_all`)

```python
class DinerFavourite(Base):
    __tablename__ = "diner_favourites"
    account_id: Mapped[int] = mapped_column(ForeignKey("guest_accounts.id", ondelete="CASCADE"), primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utc_now)
```

### 4.4 Indexes (`RESTAURANT_INDEXES` in `migrate.py`, and `Index(...)` in the models' `__table_args__`)

```python
("ix_bookings_account_id", "CREATE INDEX IF NOT EXISTS ix_bookings_account_id ON bookings (account_id)"),
("ix_bookings_email_lower", "CREATE INDEX IF NOT EXISTS ix_bookings_email_lower ON bookings (lower(email))"),
("ix_restaurant_reviews_venue_table",
 "CREATE INDEX IF NOT EXISTS ix_restaurant_reviews_venue_table ON restaurant_reviews (venue_id, table_id)"),
```
(`lower(email)` expression indexes work on SQLite ≥ 3.9 and Postgres; it serves the claim query
and the existing `reviews.save` lookup.)

### 4.5 `email_codes`

No schema change. New purpose value `"diner"` (fits `String(10)`), like `"owner"`.

### 4.6 Backfill of `seated_tables`

`python -m app.seed.backfill_seated_tables` (new, idempotent, run once after migrate):
1. bookings with `seated_tables = '[]'` and live `table_slots` rows → ids from `table_slots`, labels from `tables`;
2. closed bookings → the latest `audit_log` row with `entity="booking"`, `entity_id=public_id` and `detail.tables` (written today by `record_change` for `booking.create`, `booking.change` and staff moves), labels from `tables` when the table still exists.
Bookings it cannot resolve keep `[]` (no "Same table" button, no table rating). See decision D3.

---

## 5. API endpoints

All under `/api`. Errors use the existing envelope `{"error": {"code", "message"}}`. All bodies are
Pydantic `Strict` (unknown fields 422). Guest auth = `Authorization: Bearer g....` (`CurrentGuestAccount`).

### 5.1 New router `backend/app/routers/diner.py` (`tags=["diner"]`)

| Method, path | Auth | Request | Response | Limits |
|---|---|---|---|---|
| `POST /diner/register` | none | `{name: PlainText 1-120, email: EmailStr ≤254, password: str 1-200, consent: Literal[True]}` | 202 `{signup_id, sent_to: "m***@gmail.com", expires_in_seconds: 900, demo_code?: "482913"}` (same shape for existing accounts) | `accounts.count_code_send(..., "diner")`, `accounts.count_app_send` |
| `POST /diner/verify` | none | `{email, code: ^\d{6}$, signup_id: 10-100}` | 201 `{token, account: {name, email, created_at}, email_proven: bool}` | `accounts.count_code_check`; 5 tries per code |
| `GET /diner/bookings?when=upcoming\|past&limit=1..50&offset≥0` | guest | — | 200 `{items: [MyBooking], total, claimable}` | `diner-read:{account.id}` 120/min |
| `GET /diner/bookings/{booking_id}` | guest | — | 200 `MyBooking` + `booking_rows.describe(..., with_phrase=True)` fields + `can_change`, `max_party` (as `GET /b/{token}`) | read limit; 404 `not_found` when not this account's |
| `PATCH /diner/bookings/{booking_id}` | guest | `{date?, time?, party_size?, seat_id?}` (same rules as `bookings.ChangeIn`) | as `PATCH /b/{token}`; 409 with alternatives on conflict | `diner-write:{account.id}` 30/min |
| `DELETE /diner/bookings/{booking_id}` | guest | — | as `DELETE /b/{token}` | write limit; 409 when not `confirmed` |
| `POST /diner/bookings/claim` | guest | `{}` | 200 `{added: n}`; 403 `forbidden` `Please verify your email first.` when `email_proven` is false | `diner-claim:{account.id}` 5/hour |
| `POST /diner/bookings/claim-link` | guest | `{manage_token: 10-100}` | 200 `{added: 0\|1, booking_id}`; 404 unknown token; 409 `This booking is in another account.` | `b-manage:{ip}` (shares `bookings.MANAGE_LIMIT`, 30/min) + claim limit |
| `GET /diner/bookings/{booking_id}/rebook` | guest | — | 200 `{slug, public_id, name, bookable, party, time, date, tables: [{id, label, usable}], same_table: bool, link_again, link_table}` | read limit |
| `GET /diner/restaurants/{venue_public_id}/last-table` | guest | — | 200 `{last: {date, table_ids, labels} \| null}` (last completed or past-seated booking with one+ usable table) | read limit |
| `GET /diner/favourites` | guest | — | 200 `{items: [{slug, name, cuisines, address, cover_url, price_level}], slugs: [..]}` (published only) | read limit |
| `PUT /diner/favourites/{slug}` | guest | — | 200 `{saved: true}` (idempotent); 404 draft/unknown; 409 `limit` at 200 | write limit |
| `DELETE /diner/favourites/{slug}` | guest | — | 200 `{saved: false}` (idempotent) | write limit |

`MyBooking`:
```json
{
  "id": "Xq9…", "status": "confirmed", "date": "2026-11-21", "time": "19:45", "end_time": "21:15",
  "party_size": 2, "high_chairs": 0, "needs_accessible": false,
  "tables": ["4"], "room": "Panorama room", "seat": {"label": "2", "phrase": null} ,
  "restaurant": {"slug": "miradouro-7", "public_id": "…", "name": "Miradouro 7",
                 "address": "…", "maps_url": "…", "cover_url": "/api/photos/…", "bookable": true},
  "can_change": true,
  "rebook": {"again": true, "same_table": true},
  "my_review": {"score": 9} 
}
```
No phone, no notes, no email in list items (minimisation; the detail route shows notes like `/b/{token}`).

### 5.2 Changed existing endpoints

| Endpoint | Change |
|---|---|
| `POST /r/{vid}/bookings` (`routers/restaurants.py` `book`) | Optional `Authorization` header read with `security._bearer` + `verify_guest_session` (as `discovery._optional_user` does for organisers). A valid guest session sets `booking.account_id`; a missing/invalid one books anonymously. New optional body field `rebook: Literal["again", "same_table"] \| None` (ignored when anonymous). Response adds `"linked": bool` |
| `GET /r/{vid}/table-ratings?party=1..MAX` (new, public) | `{tables: {"12": {"score": 9.2, "count": 11, "kind": "couple", "kind_score": 9.4, "kind_count": 8}}}`; only tables with ≥ 3 verified reviews; `kind` = the party kind of `party` if that bucket has ≥ 3, else omitted. Read limit `r-read` |
| `GET /r/{vid}/table-times?table_ids=12[,13]&date=&party=&near=HH:MM` (new, public) | `{times: ["19:00", "21:45"]}`: up to 3 start times that day, nearest to `near`, when all those tables are free for the turn time. Read limit. Reveals nothing the map does not already show |
| `GET /restaurants/{slug}/reviews/mine` (`routers/discovery.py`) | Adds `table_label` and `visit_date` for the author only (not in the public list) |
| `PUT /restaurants/{slug}/reviews/mine` | Unchanged request. `reviews.save` now also verifies through `Booking.account_id == account.id`, and snapshots `table_id`, `table_label`, `party_kind` from the latest completed booking |
| `GET /staff/{vid}/table-ratings` (new, `routers/staff.py`) | Staff/owner (`load_for_staff`): every table with ≥ 1 verified review: `{tables: [{table_id, label, room, score \| null, count, best_kind, best_kind_score}]}` |
| `GET /staff/{vid}/floor` and staff booking payloads | `booking_rows.describe` adds `"rebook_kind"` (additive) |

---

## 6. Backend modules and functions

### 6.1 New `restaurant_service/diner_accounts.py`
Copy of the owner pattern, purpose `"diner"`, creating a `GuestAccount`:
- `register(session, name, email, password) -> dict` — like `owner_accounts.register`: `new_token()` signup id, `keyed_hash(f"diner-signup:{id}")`, `hash_password`, six random digits, `accounts.may_show_code`, existing account → `templates.account_exists(existing.name, "SeatPlan restaurants", link)` with link `/restaurants/account`; else `EmailCode(purpose="diner", ...)`, email `Your SeatPlan code` / `Your code is 482913. It expires in 15 minutes.`; `enqueue`; commit; `accounts.send_at_once`.
- `verify(session, email, code, signup_id) -> dict` — like `owner_accounts.verify` (atomic attempt count, 5 tries, `_retire_email`), then `GuestAccount(email, name, password_hash, consent_at=row.created_at, consent_version=DINER_CONSENT_VERSION, last_login_at=utc_now(), email_proven=not row.code_shown)`; IntegrityError → 409 `Please try again.`; returns `{"token": create_guest_session(account), "account": accounts.account_out(account), "email_proven": ...}`.
- `DINER_CONSENT_VERSION = "diner-2026-11"`.
Reused, not edited: `accounts.normalise_email`, `check_new_password`, `count_code_send`, `count_app_send`, `count_code_check`, `may_show_code`, `send_at_once`, `account_out`; `security.create_guest_session`, `keyed_hash`, `hash_password`, `tokens_match`.

### 6.2 New `restaurant_service/my_bookings.py`
- Pure: `is_upcoming(status: str, end_at: datetime, now: datetime) -> bool` (status in `occupancy.ACTIVE_STATUSES` and `end_at > now`).
- Pure: `party_kind(party_size: int, high_chairs: int) -> PartyKind`.
- Pure: `status_word(status: str) -> str` (`confirmed`→`Confirmed`, `seated`/`finishing`→`Seated`, `completed`→`Visited`, `cancelled`→`Cancelled`, `no_show`→`Missed`); mirrored in TS for display.
- `list_for_account(session, account, when, limit, offset, now) -> dict` — one query on `account_id` (index), venues and covers batched (`discovery._covers` made public as `discovery.covers`; it already defers bytes), reviews of the account batched.
- `claimable_count(session, account, since) -> int`, `claim_by_email(session, account, since, cap=500) -> int` — `account.email_proven`, `account_id IS NULL`, `source == "diner"`, `func.lower(Booking.email) == account.email` (same rule as `reviews.save`), `created_at >= since` (24 months, D5). One `UPDATE ... WHERE account_id IS NULL` so two claims cannot steal from each other.
- `claim_by_token(session, account, token) -> Booking` — `booking_rows.load_by_token`; 409 when linked to another account; idempotent for the same one.
- `load_for_account(session, account, booking_public_id) -> tuple[Venue, Booking]` — 404 `Booking not found.` unless `booking.account_id == account.id`.
- `item(session, venue, booking, ...) -> dict` — builds `MyBooking`, using `booking.seated_tables` for labels (not `tables_of`, which is empty after closing).

### 6.3 New `restaurant_service/rebook.py`
- Pure: `next_same_weekday(last: date, today: date) -> date` (strictly after today, same weekday).
- Pure: `nearest_times(candidates: list[int], wanted: int, limit: int = 3) -> list[int]` (slots, ties earlier first).
- Pure: `usable_tables(snapshot: list[dict], current: dict[int, TableSpec-like], party: int) -> tuple[list[int], str | None]` — same ids exist, `is_active`, combined capacity fits `party` (min/max as `booking_rows.check_tables` reasons).
- `prefill(session, venue, booking, today) -> dict` — party = `booking.party_size` capped at `availability.max_party`, time = local start `hhmm`, date = `next_same_weekday`.
- `table_free_times(session, venue, table_ids, day, party, near) -> list[str]` — `schedule.periods_for_day`, `start_times`, `turn_minutes`, `window_for`, `occupancy.merge(booked_slots, held_slots)`, `is_free`, `clock.is_past`, then `nearest_times`.
- `last_table(session, venue, account) -> dict | None`.

### 6.4 New `restaurant_service/table_ratings.py`
- `MIN_TABLE_REVIEWS = 3`.
- Pure: `aggregate(rows: Iterable[tuple[int, str, int]], min_count: int) -> dict[int, TableRating]` (table_id, party_kind, score) → overall and per-kind averages rounded to one decimal, buckets under `min_count` dropped.
- `public_ratings(session, venue, party) -> dict` (verified, `table_id IS NOT NULL`, current active tables only).
- `staff_ratings(session, venue) -> list[dict]` (min_count 1, score null under 3).

### 6.5 New `restaurant_service/favourites.py`
`MAX_FAVOURITES = 200`; `save(session, account, venue)` with `db.insert_ignoring_duplicates` after a count check; `remove`; `list_for_account` (published only, `venue_access`-equivalent filter `status == "published"`).

### 6.6 Changed modules
- `booking_rows.write_slots(session, booking, table_ids, window)`: after the flush succeeds, `booking.seated_tables = [{"id": t, "label": l} for t, l in zip(table_ids, table_labels(session, table_ids))]`. Every caller (confirm, change, staff move, walk-in, service plan apply) goes through it, so no caller changes. `release_slots` is unchanged and leaves the snapshot.
- `booking_rows.describe`: adds `"rebook_kind": booking.rebook_kind`.
- `diner_flow.confirm_booking(..., account_id: int | None = None, rebook_kind: str | None = None)`: sets both on the new `Booking`. `Contact` unchanged.
- `reviews.save`: verified when a completed diner booking at the venue has `account_id == account.id`, or (`email_proven` and same email) as today; picks the latest such booking (`order_by(Booking.start_at.desc())`) and sets `table_id`/`table_label` (only when `len(seated_tables) == 1`) and `party_kind`. `payload` unchanged for the public list; new `mine_payload` adds `table_label`, `visit_date`.
- `discovery.py`: rename `_covers` → `covers` (keep `_covers = covers` alias to avoid touching other callers).
- `routers/restaurants.py`: `book` as in 5.2; new `table_ratings`, `table_times` routes.
- `routers/staff.py`: new `GET /staff/{vid}/table-ratings`.
- `main.py`: register `diner` router.

---

## 7. Frontend components and routes

### 7.1 Routes (`frontend/src/App.tsx`, shared)
- `/restaurants/account` → `DinerAccountPage` (existing route; page grows).
- New `/restaurants/account/bookings/:bookingId` → `AccountBookingPage` (placed before `/restaurants/:slug`; no clash since it has more segments).

### 7.2 New folder `frontend/src/pages/my-bookings/` (with its own `READ_ME_FIRST.md`)
| File | Job |
|---|---|
| `MyBookingsPage.tsx` | Tabs, claim banner, lists, Saved column, footer |
| `BookingItem.tsx` | One upcoming/past card with its actions |
| `ClaimBanner.tsx` | "We found 3 earlier bookings…" + claim call; `Not now` in `sessionStorage` (try/catch) |
| `SavedList.tsx`, `SaveButton.tsx`, `useSaved.ts` | Favourites list; heart button used by `RestaurantCard` and `RestaurantPage`; one shared cache of saved slugs per tab |
| `DinerSignUpForm.tsx`, `DinerCodeForm.tsx` | Sign-up and code steps (pattern of `pages/owner/OwnerSignUpPage.tsx`) |
| `AccountBookingPage.tsx` | 3.4: composes `BookingSummary`, `ChangeBookingForm`, `ChangeSeat`, `BookingActions` with account-scoped calls |
| `myBookingsModel.ts` (+ `.test.ts`) | Pure: `statusWord`, `whenLine`, `tableLine`, `bookAgainLink`, `sameTableLink`, `nextSameWeekday`, `ratingLine(rating, party)`, `partyKind` |
| `my-bookings.css` | Restaurant theme tokens only |

### 7.3 Changed files
- `pages/discover/DinerAccountPage.tsx`: signed out → Log in / Create an account; signed in → `MyBookingsPage`. Keeps `state.reviewSlug`; adds `state.saveSlug`, `state.claimToken`, `state.mode`.
- `pages/discover/PublicHeaderActions.tsx`: label `My bookings`.
- `pages/discover/RestaurantCard.tsx`, `pages/restaurant-public/RestaurantPage.tsx`: `SaveButton`.
- `pages/restaurant-public/RestaurantReviews.tsx`: note 3.11.
- `pages/restaurant/useBookingFlow.ts`: `LinkAnswers` gains `table?: string | null`, `again?: "book" | "table" | null`.
- `pages/restaurant/useLinkedTime.ts`: unchanged logic; passes `preferredTables` on.
- `pages/restaurant/BookingPage.tsx` (`BookingEmbed`): reads `table` and `again` from the query.
- `pages/restaurant/StepTable.tsx`: loads `getTableRatings` once per (vid, party) and, when signed in, `getLastTable`; preferred table focus; "taken" banner with `getTableTimes`.
- `pages/restaurant/TableCard.tsx`: props `rating?: TableRatingView`, `lastVisit?: string`, `sameTable?: boolean`.
- `pages/restaurant/FloorPlan.tsx`, `floorPlanScene.ts`: prop `marks?: ReadonlyMap<number, "last">`, drawn as a pin; description suffix.
- `pages/restaurant/StepDetails.tsx`: prefill + signed-in line.
- `pages/restaurant/Confirmation.tsx`: linked line or create-account card.
- `pages/restaurant/ManageBookingPage.tsx`: `Save to My bookings`.
- `pages/restaurant/ChangeBookingForm.tsx` (calls `changeBooking(token, ...)` at line 33), `ChangeSeat.tsx` (calls `changeSeat(token, ...)` at line 53) and `ManageBookingPage.tsx` (calls `cancelBooking(token)` at line 153): lift each call into an optional prop (`submitChange`, `submitSeat`, `submitCancel`) that defaults to today's token call, so `AccountBookingPage` can pass the `/diner/bookings/{id}` versions. Pure refactor; existing tests unchanged.
- `pages/restaurant/SelectionPanel.tsx`, `StaffDashboard.tsx`: badge and Table ratings card.
- `api/restaurant.ts`: `createBooking` sends `"guest"` auth when `getGuestToken()` is set and the optional `rebook`; returns `linked`; new `getTableRatings`, `getTableTimes`, `getStaffTableRatings`.
- New `api/diner.ts` (+ `diner.test.ts`): every `/diner/...` call with `"guest"` auth; `registerDiner`, `verifyDiner` (stores the token with `setGuestToken`).

### 7.4 Not touched
`pages/events/`, `pages/editor/`, `pages/join/`, `pages/account/` (only imported: `SignInForm`, `account.css`, as today), `pages/room-editor/`.

---

## 8. Security, privacy and abuse limits

### 8.1 Authorisation
- Every `/diner/...` booking route loads by `public_id` **and** `account_id == account.id`; mismatch is the same 404 as unknown (no enumeration).
- Account-scoped change/cancel call `manage_flow.change_booking`, `change_seat`, `cancel_booking` exactly as the token routes do (same `check_changeable`, same caps, same audit `actor="diner"`).
- Claim by email only when `account.email_proven` (the code reached the inbox). A demo account with a shown code cannot claim other people's bookings typed with an `@example.com` address.
- Claim by link needs the raw manage token (proof of possession) and is rate limited with the manage limit.
- Linking at booking time: only the holder of a valid guest session; the booking email may differ (booking for a friend). The email owner still controls the booking through the manage link.
- `rebook_kind` from an anonymous request is ignored.
- `POST /r/{vid}/bookings` never fails because of a bad guest token; it books unlinked and answers `linked: false` (frontend shows `We could not save this booking in your account. Log in again and use "Save to My bookings" from the email link.`).

### 8.2 Privacy (GDPR)
- **Consent and purpose**: explicit checkbox at diner sign-up (`consent_version = "diner-2026-11"`); the claim of old bookings is a separate explicit action (banner button), never automatic.
- **Minimisation**: list items carry no phone, notes or email; per-table ratings are aggregates with ≥ 3 verified reviews; the public review list never shows table labels or visit dates; `party_kind` is a coarse bucket, not the size; staff see `rebook_kind` only, not the account.
- **Retention**: My bookings shows bookings up to 24 months back (D5); favourites live as long as the account; review snapshot columns live with the review.
- **Deletion**: the existing `POST /guest/me/delete` deletes the account row; the database then sets `bookings.account_id` to NULL, deletes `diner_favourites` rows (CASCADE) and reviews (existing CASCADE). Restaurants keep the booking (their record of a reservation). Tested on SQLite and in the migration test.
- **Transparency**: the inline "How we use your data" text at sign-up (3.2), the footer note in 3.3, and a privacy page before real launch (D7).
- **Processors**: none new.

### 8.3 Abuse limits (all via `security.rate_limit`, keyed hashes)
| Key | Limit |
|---|---|
| `diner-read:{account_id}` | 120 / min |
| `diner-write:{account_id}` | 30 / min |
| `diner-claim:{account_id}` | 5 / hour; ≤ 500 bookings per claim |
| sign-up | `count_code_send` (network/hour, network/day, mailbox/hour, purpose `diner`), `count_app_send`, `count_code_check`; 5 tries per code; codes 15 min |
| favourites | 200 per account |
| `table-ratings`, `table-times` | shared `r-read:{ip}` 120 / min; ≤ 3 table ids; ≤ 3 times |
| booking caps | unchanged (`booking_caps.check_booking_caps`) |

**Rating integrity**: a table score only counts a review whose verification came from a completed
booking at that restaurant; table and party kind come from the booking. One review per account per
restaurant (existing PK). Combined-table visits never feed a single table.

---

## 9. Tests (tests first for pure logic and security)

### 9.1 pytest (`backend/tests/`)
`test_my_bookings_pure.py` (pure, written first):
- `test_party_kind_buckets_solo_couple_small_group_group`
- `test_party_kind_high_chair_means_family`
- `test_next_same_weekday_is_strictly_after_today`
- `test_next_same_weekday_across_month_and_year`
- `test_nearest_times_orders_by_distance_then_earlier`
- `test_aggregate_drops_buckets_under_three`
- `test_aggregate_rounds_to_one_decimal`
- `test_is_upcoming_uses_status_and_end`
- `test_usable_tables_rejects_inactive_missing_or_too_small`

`test_diner_accounts.py` (security, first):
- `test_register_same_answer_for_existing_account`
- `test_verify_needs_signup_id_from_same_browser`
- `test_wrong_code_counts_tries_and_drops_after_five`
- `test_demo_shown_code_creates_unproven_account`
- `test_emailed_code_creates_proven_account_with_diner_consent`
- `test_diner_sign_up_never_creates_guest_rows_or_touches_events`
- `test_register_rate_limited_per_mailbox`

`test_my_bookings_api.py`:
- `test_booking_with_guest_session_is_linked`
- `test_booking_with_bad_guest_token_books_unlinked`
- `test_rebook_kind_ignored_when_anonymous`
- `test_list_upcoming_and_past_only_own_bookings`
- `test_list_items_have_no_phone_notes_or_email`
- `test_other_account_gets_404`
- `test_claim_refused_when_email_not_proven`
- `test_claim_links_only_unlinked_matching_diner_bookings_within_24_months`
- `test_concurrent_claims_link_each_booking_once`
- `test_claim_link_needs_valid_token_and_refuses_other_account`
- `test_account_change_uses_manage_flow_and_conflict_alternatives`
- `test_account_cancel_releases_slots_and_offers_waitlist`
- `test_rebook_prefill_next_weekday_and_same_table_flag`
- `test_rebook_same_table_false_when_table_inactive_or_removed`
- `test_rebook_not_offered_for_unpublished_restaurant`
- `test_claim_rate_limited`

`test_seated_tables.py`:
- `test_write_slots_records_ids_and_labels`
- `test_closing_statuses_keep_seated_tables`
- `test_staff_move_and_diner_change_update_seated_tables`
- `test_backfill_from_slots_and_audit_log_is_idempotent`

`test_table_ratings.py`:
- `test_review_snapshots_table_and_party_kind_from_latest_completed_booking`
- `test_review_verified_through_account_link_without_proven_email`
- `test_combined_tables_do_not_rate_a_single_table`
- `test_unverified_review_has_no_table`
- `test_public_ratings_hide_tables_under_three`
- `test_public_ratings_ignore_inactive_tables`
- `test_staff_table_ratings_requires_staff_of_that_restaurant`
- `test_public_review_list_has_no_table_label`

`test_favourites.py`:
- `test_save_and_remove_are_idempotent`
- `test_cap_of_200`
- `test_draft_restaurant_cannot_be_saved_and_is_hidden_from_list`

`test_migrate_my_bookings.py`:
- `test_migrate_adds_my_bookings_columns_to_frozen_restaurant_schema` (from the 2026-11-13 fixture)
- `test_migrate_twice_changes_nothing`
- `test_fresh_and_upgraded_schema_match`
- `test_review_scale_upgrade_still_works_with_new_columns`

`test_account_deletion_restaurants.py`:
- `test_deleting_account_unlinks_bookings_and_drops_favourites_and_reviews`
- `test_event_account_deletion_behaviour_unchanged` (an event member is detached as before)

Existing suites must stay green untouched: `test_restaurant_booking_flow.py`, `test_bookings_manage.py`, `test_reviews.py`, `test_booking_cap.py`, `test_migrate_guest_accounts.py`, `test_migrate_restaurants.py`, `test_owner_accounts.py`.

### 9.2 vitest (`frontend/src/`)
- `pages/my-bookings/myBookingsModel.test.ts`: `bookAgainLink keeps party and time and picks next weekday`, `sameTableLink adds table ids and again=table`, `ratingLine prefers the party kind bucket`, `ratingLine falls back to overall and hides under three`, `statusWord maps every status`.
- `pages/my-bookings/MyBookingsPage.test.tsx`: `shows upcoming first with tabs counts`, `claim banner adds bookings and hides`, `past card hides Same table when not usable`, `empty states`.
- `pages/my-bookings/DinerSignUp.test.tsx`: `requires consent`, `code step shows demo code`, `claims the booking from router state after verify`.
- `pages/discover/DinerAccountPage.test.tsx` (new): `signed out shows Log in and Create an account`.
- `pages/restaurant/StepTable` tests (new file `rebook.test.tsx`): `preselects the same table when free`, `shows free times when the same table is taken`.
- `pages/restaurant/TableCard.test.tsx` (new): `rating line and last-time line`.
- `pages/restaurant/floorPlanScene` test: `last-time mark adds the spoken suffix`.
- `api/diner.test.ts`: guest auth on every call; `verifyDiner` stores the token.

### 9.3 Playwright (`frontend/e2e/`)
- `my-bookings.spec.ts`: `diner signs up with the demo code, books while signed in, sees it in Upcoming, cancels it from My bookings`; `staff completes a visit, diner uses Same table as last time and the plan shows Last time`; `manage link Save to My bookings`; `save a restaurant from the card and see it under Saved`.
- `my-bookings-mobile.spec.ts` (mobile project, 390 x 844): `My bookings tabs and cards without sideways scrolling`.
- `accessibility.spec.ts`: add `/restaurants/account` signed in.

---

## 10. Files touched

New:
- `backend/app/routers/diner.py`
- `backend/app/restaurant_service/diner_accounts.py`, `my_bookings.py`, `rebook.py`, `table_ratings.py`, `favourites.py`
- `backend/app/seed/backfill_seated_tables.py`, `backend/app/seed/demo_my_bookings.py`
- `backend/tests/test_my_bookings_pure.py`, `test_diner_accounts.py`, `test_my_bookings_api.py`, `test_seated_tables.py`, `test_table_ratings.py`, `test_favourites.py`, `test_migrate_my_bookings.py`, `test_account_deletion_restaurants.py`
- `frontend/src/api/diner.ts`, `frontend/src/api/diner.test.ts`
- `frontend/src/pages/my-bookings/` (all files in 7.2, plus `READ_ME_FIRST.md`)
- `frontend/src/pages/restaurant/rebook.test.tsx`, `TableCard.test.tsx`
- `frontend/e2e/my-bookings.spec.ts`, `my-bookings-mobile.spec.ts`

Changed (★ = shared with other features, coordinate merges):
- ★ `backend/app/models.py` (Booking, RestaurantReview columns; DinerFavourite)
- ★ `backend/app/seed/migrate.py` (NEW_COLUMNS, RESTAURANT_INDEXES)
- ★ `backend/app/main.py` (router list)
- ★ `backend/app/routers/restaurants.py` (`book`, two read routes)
- ★ `backend/app/routers/staff.py` (table ratings)
- `backend/app/routers/discovery.py` (`reviews/mine` payload)
- ★ `backend/app/restaurant_service/booking_rows.py` (`write_slots`, `describe`)
- ★ `backend/app/restaurant_service/diner_flow.py` (`confirm_booking` args)
- `backend/app/restaurant_service/reviews.py`
- `backend/app/restaurant_service/discovery.py` (`covers` alias)
- `backend/app/seed/run.py` (call `demo_my_bookings.seed`), `backend/app/config.py` (`DEMO_DINER_PASSWORD` read, D8)
- READ_ME_FIRSTs: `backend/app/restaurant_service/`, `backend/app/routers/`, `backend/app/seed/`, `backend/app/`, `frontend/src/api/`, `frontend/src/pages/discover/`, `frontend/src/pages/restaurant/`, `frontend/src/pages/restaurant-public/`, `frontend/e2e/`
- ★ `frontend/src/App.tsx`
- ★ `frontend/src/api/restaurant.ts`
- `frontend/src/pages/discover/DinerAccountPage.tsx`, `PublicHeaderActions.tsx`, ★ `RestaurantCard.tsx`
- ★ `frontend/src/pages/restaurant-public/RestaurantPage.tsx`, `RestaurantReviews.tsx`
- ★ `frontend/src/pages/restaurant/StepTable.tsx`, ★ `TableCard.tsx`, ★ `FloorPlan.tsx`, ★ `floorPlanScene.ts`, `useBookingFlow.ts`, `useLinkedTime.ts`, `BookingPage.tsx`, `StepDetails.tsx`, `Confirmation.tsx`, `ManageBookingPage.tsx`, `ChangeBookingForm.tsx`, `ChangeSeat.tsx`, `SelectionPanel.tsx`, `StaffDashboard.tsx`
- Docs: `docs/api.md`, `docs/data-model.md`, `docs/security.md`, `docs/ux-restaurant.md`, `docs/user-guide-diner.md`, `docs/CHANGELOG.md`, `docs/decisions-log.md`, `docs/openapi.json` (regenerated)

Never touched: event paths listed in `AGENTS.md`, `events_service/accounts.py` (only imported),
`routers/guest_accounts.py`, `pages/account/` (only imported), `pages/room-editor/`,
`restaurant_service/rooms.py`, `vercel.json`, `.github/workflows/`.

---

## 11. Rollout and demo data

1. Branch from `codex/restaurantes-ux`. Order of work (each a verified commit):
   a. pure functions + tests; b. models + migrate + migration tests; c. `seated_tables` snapshot + backfill;
   d. diner sign-up; e. linking at booking time + My bookings list + claim; f. account-scoped manage;
   g. favourites; h. rebook + table-times; i. table ratings (reviews snapshot, public, staff);
   j. frontend in the same order; k. e2e; l. docs.
2. Production: back up the database, run `python -m app.seed.migrate` with `DATABASE_URL`, then
   `python -m app.seed.backfill_seated_tables`, **before** merging (memory: "backup + migrate before
   the merge"). The new columns are nullable/defaulted, so the old code runs fine on the new schema.
3. Feature switch: none needed; the UI only appears for signed-in diners and the rating line only
   appears with ≥ 3 verified reviews per table.
4. Demo seed (`seed/demo_my_bookings.py`, called from `seed_all` and safe to re-run):
   - Account `diner@example.com`, name `Marta Silva`, `email_proven=True`, `consent_version="demo"`,
     password from `demo_password("DEMO_DINER_PASSWORD", settings)` (public default only on local SQLite with `DEMO_MODE=1`; on Postgres the seed skips this account unless the variable is set).
   - Linked bookings: 2 upcoming (Casa Lumen and one showcase restaurant), 3 past (completed, one with `seated_tables` of a window table), 1 cancelled; 2 unlinked past bookings with the same email so the claim banner shows.
   - Favourites: 4 published demo restaurants.
   - Verified table reviews: for Casa Lumen and the four showcase restaurants (`demo_showcase.py`), 3-9 verified reviews per popular table from the existing `review-N@demo.seatplan.invalid` accounts, each backed by a completed demo booking with that email and `seated_tables`, so "Table 12 · 9.4 from couples" appears. Comments keep the `Demo review — ` prefix used by `demo_reviews.py`.
   - Demo link `my_bookings` → `/restaurants/account` in `demo_links`.
5. External services and accounts: **none**. No cost. Legal steps for Martim: approve the consent and
   "How we use your data" text in 3.2, and before real (non-demo) diners publish a privacy page (D7).

---

## 12. Open decisions for Martim (with recommended defaults)

| # | Question | Recommended default |
|---|---|---|
| D1 | Does this feature own diner sign-up, or does another feature? | Own it here (purpose `diner`, owner pattern). Without it only event guests can have accounts |
| D2 | Party-kind words: "couples" for every party of two? | Yes, "couples" (matches the product example); switch to "pairs" if users find it presumptuous |
| D3 | Backfill old closed bookings' tables from the audit log? | Yes, once, best effort; unresolved bookings simply have no "Same table" |
| D4 | Allow "Remove from My bookings" per booking? | Not in v1 (would need a "do not re-claim" flag); account deletion covers erasure |
| D5 | How far back can bookings be claimed/shown? | 24 months |
| D6 | "Download my data" export for diners? | Later, together with events (one export for the whole account) |
| D7 | The app has no `/privacy` route. Is the inline "How we use your data" text enough for launch? | Yes for the demo; before real diners, publish a privacy page (all verticals) reviewed by someone with GDPR knowledge, and link it from the sign-up forms |
| D8 | Seed a demo diner on the deployed demo? | Yes, only if `DEMO_DINER_PASSWORD` is set on Vercel |
| D9 | Minimum reviews before a table score shows | 3 |
| D10 | Should staff see a returning-guest visit count? | No (privacy); only the `rebook_kind` badge |

---

## 13. Size and effort

**Size: L.** Roughly 6-8 focused days for one developer with tests:
backend (sign-up, list/claim/manage, snapshot + backfill, favourites, rebook, ratings, migration) ≈ 3-3.5 days;
frontend (My bookings folder, sign-up, table step changes, hearts, staff/owner bits) ≈ 2.5-3 days;
e2e, docs, demo seed ≈ 1-1.5 days.
Biggest risks: merge conflicts in the shared booking-flow files (`StepTable`, `TableCard`, `FloorPlan`,
`api/restaurant.ts`, `models.py`, `migrate.py`) with parallel features; the `ON DELETE SET NULL`
reference added by `ALTER TABLE` must be verified on Postgres before release.
