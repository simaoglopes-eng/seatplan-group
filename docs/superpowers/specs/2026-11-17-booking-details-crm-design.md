# Booking details and guest profiles (CRM): design

Date: 2026-11-17. Status: design for review, not implemented. Branch it was designed on:
`codex/restaurantes-ux` (worktree `seatplan-rux`). Feature slug: `booking-details-crm`.
Mockup (session scratchpad, not in the repo):
`C:\Users\marti\AppData\Local\Temp\claude\51127802244b2e7b\048014bd-52bb-4f3b-b71e-3f8ba641286a\scratchpad\features\booking-details-crm.html`
(staff floor on desktop, the diner's details step on a 390 px phone).

## 1. Goal

Two linked additions to the restaurant vertical:

1. **Booking details.** A diner can say what the booking is for (birthday, anniversary, proposal,
   business, other, with a short note) and list allergies and dietary needs (the 14 EU allergens,
   five diets, free text). Staff see them on the live floor; the diner sees them on the
   confirmation, the manage link and in the confirmation email.
2. **Guest profiles ("CRM"), per restaurant, switched on by the owner.** Staff recognise a
   returning guest by their email address (trimmed and lower-cased, otherwise exact: a `+tag`
   address is a different guest, see 5.4) and, as a suggestion only, their phone: number of visits, no-shows, last
   visit, last table, staff notes and tags (VIP, Allergy ...). The card appears on the floor's
   booking panel and in a new **Guests** tab.
3. **GDPR built in.** Profiles belong to one restaurant and are never shared between restaurants.
   Health-related data (allergies and diets) needs explicit consent and is kept for a short time.
   A retention job removes old data. A diner with a proven email can see everything a restaurant
   keeps about them, download it and have it erased. Staff can erase a guest on request.

### User stories

Diner
- D1. While booking, I can say "It's a birthday: Ana turns 40" so the restaurant can prepare.
- D2. I can tick "Tree nuts" and write "Severe, carries an EpiPen", agree that the restaurant
  may use it, and optionally ask the restaurant to remember it for my next visits.
- D3. On my manage link I can change the occasion and dietary needs until the booking starts,
  or remove them.
- D4. Signed in with my SeatPlan account (proven email), I can see, per restaurant, what is kept
  about me (visits, notes, tags, remembered allergies), download it as JSON, make the restaurant
  forget my remembered dietary needs, erase everything, or ask not to be recognised at that
  restaurant again.

Staff (floor)
- S1. When I tap a booking I see at once: allergy warning first, then occasion, then "4th visit ·
  last time 12 Oct at table 7 · 0 no-shows", tags and the team's note.
- S2. In the arrivals list I see small badges: "Allergy", "Birthday", "VIP", "Returning".
- S3. I can add a tag or edit the team note from the card without leaving the floor.
- S4. When a new booking's phone matches an existing guest, I am asked "Same person?" and can
  link the two profiles or dismiss the suggestion.
- S5. In the Guests tab I can search by name, exact email or exact phone, open a profile with the
  visit history and erase a guest who asks us to.

Owner
- O1. I can switch guest profiles on for my restaurant (off until I do; switching on links my
  recent online bookings), switch them off again (everything is erased) and choose how long
  guest history is kept (12, 24 or 36 months).
- O2. I know which data my restaurant controls and that SeatPlan only processes it for me.

## 2. Non-goals

- No marketing: no newsletters, no birthday emails, no "we miss you" campaigns, no export of
  guest lists to CSV (guards against bulk extraction; data portability is the diner's JSON).
- No sharing of profiles, tags or no-show counts between restaurants, and no platform-wide
  "unreliable diner" score.
- No staff-to-guest messaging, no SMS, no external CRM integration (no external service at all).
- No guest profiles for walk-ins in v1 (walk-ins have no email; `staff_floor.seat_walkin` stores
  `email=""`). A later task may add an optional phone to `WalkinDialog`.
- No deposit, no cake upsell, no paid "occasion packages".
- No prefilling of the diner's remembered allergies in the booking form (the email is not
  verified at booking time, so prefill would leak data to anyone typing that email).
- No guest profiles built from bookings that real visitors make at demo restaurants (`is_demo`):
  the demo staff login is shared, so only seeded `@example.com` demo guests get profiles there
  (see 8.3).
- No staff-entered health information: there is no "Allergy" staff tag (Art. 9, see 8.1);
  allergy data comes only from the diner's own consented list.
- No change to the events vertical: `GuestAccount` is read, never changed; the account delete
  in `events_service/accounts.py` is not modified (see 8.6).
- Room editor (`frontend/src/pages/room-editor/`, Sergio) is not touched.

## 3. What exists today (verified in code)

| Fact | Where |
|---|---|
| `Booking` has `name, email, phone, notes(500), needs_accessible, high_chairs, prefs, chosen_seat_id, table_choice, status, source`; no link to an account or profile | `backend/app/models.py:479` |
| Free-text notes hint already says "Allergies, a birthday, a pram..." | `frontend/src/pages/restaurant/StepDetails.tsx:112` |
| Booking request is `BookingIn` (strict, `PlainText`), confirmed by `diner_flow.confirm_booking(session, venue, held, needs, contact, seat_id)` with one `commit_or_seat_taken` | `backend/app/routers/restaurants.py:85`, `backend/app/restaurant_service/diner_flow.py:136` |
| `booking_rows.describe()` is the single shape for diner (confirmation, `/b/`) and staff floor | `backend/app/restaurant_service/booking_rows.py:92` |
| The staff floor returns `describe()` for every active booking of the day | `backend/app/restaurant_service/staff_floor.py:82` |
| Closing a booking (`completed`, `no_show`, `cancelled`) deletes its `table_slots`, so past bookings no longer know their tables | `staff_floor.set_status`, `booking_rows.release_slots` |
| Staff access: owners see their restaurants, the demo `staff` role only demo restaurants, 404 otherwise | `restaurant_service/venue_access.load_for_staff` |
| Mailbox normalisation (lower case, `+tag` removed) and keyed HMAC hashing. `mailbox()` is right for booking caps but **not** for identity: on providers where `+` is a literal character, `ana+x@corp.pt` and `ana@corp.pt` are different people. Reviews already match the exact lower-cased email (`reviews.save`) | `security.mailbox`, `security.keyed_hash`, `restaurant_service/booking_caps.py`, `restaurant_service/reviews.py:100` |
| `bookings.email` has no index and is stored as typed; `booking_caps` filters by domain in SQL and decides in Python. A cross-restaurant lookup by email therefore needs its own indexed key (5.1 `email_key`) | `booking_caps._upcoming_for_email` |
| Email words for confirmed/changed/reminder come from `RestaurantBooking` facts; `_details(facts)` takes no `kind` today | `restaurant_service/email_facts.py`, `mail/restaurant_templates.py:103` |
| The staff floor reloads every 15 s and on every live bump of the venue-day scope, per open tab | `frontend/src/pages/restaurant/StaffFloor.tsx:35`, `:39` |
| The demo staff login is shared ("the demo accounts' passwords may be public"); demo staff see every `is_demo` restaurant | `routers/demo.py:36`, `seed/run.py:27` |
| The phone field's hint promises "Only used if we need to reach you on the day." | `StepDetails.tsx:111` |
| Event outbox erasure blanks `to_email` as well as the words | `events_service/mailer.forget_guest_emails` |
| Restaurant email keys use the booking's **public** id: `booking-confirmed-<public_id>`, `booking-changed-<public_id>-<n>`, `booking-reminder-<public_id>-<n>`, `booking-cancelled-<public_id>` | `restaurant_service/emails.py` |
| `docs/openapi.json` is exported from the app by a script | `scripts/export_openapi.py` |
| Outbox words are scrubbed 30 days after sending; links redacted when finished | `mail/outbox.scrub_expired`, `redact_links` |
| The only scheduler is `.github/workflows/email-cron.yml`, every 15 minutes, `X-Cron-Secret` | `routers/emails.py:58` |
| Security finding S23 (no retention, no diner erasure) is open | `docs/security.md:95`, section 6 |
| `GuestAccount.email_proven` is False only for demo accounts whose code was shown on screen | `models.py:403` |
| The forbidden-path check rejects `backend/app/routers/guest_*.py` | `scripts/check_forbidden_paths.py` |

Because of the last line, **no new file may be called `guest_*.py` in `routers/`**. This design
uses the word "diner" in file names (`diner_profiles.py`, `diner_data.py`).

## 4. UX flow and copy

All text below is final English copy. Restaurant theme: white and lavender surfaces, purple
`#4F3F8F` structure, one pink `#B0347A` main button per screen, bold sans-serif headings.

### 4.1 Diner: details step (`/r/:venueId`, step "Your details", and the side panel variant)

Below "Add a phone number or a note for the restaurant" a second folded section:

`<details>` summary: **Add an occasion or dietary needs**
(Opens by itself when anything inside is filled. On the "panel" variant it is the same fold.)

Inside, fieldset 1, legend **Anything to celebrate? (optional)**
- Chip radio group (one or none): `Birthday` `Anniversary` `Proposal` `Business` `Other`.
  A selected chip shows a tick; pressing it again clears it ("No occasion" for screen readers).
- When a chip is selected, field **Tell the restaurant more (optional)**, placeholder
  "e.g. Ana turns 40, a small candle would be lovely", 80 characters, counter "12/80".
- Hint under Proposal only: "Only the restaurant team sees this. Your guest will not see it
  in any email we send to you." (Copy is honest: we only email the booker.)

Fieldset 2, legend **Allergies and dietary needs (optional)**
- Sub-heading "Allergies" with checkboxes in this order: Gluten, Crustaceans, Eggs, Fish,
  Peanuts, Soy, Milk, Tree nuts, Celery, Mustard, Sesame, Sulphites, Lupin, Molluscs.
  On a phone the list shows the first six and a link button "Show all 14 allergens".
- Sub-heading "Diets": Vegetarian, Vegan, Pescatarian, Halal, Kosher.
- Field **Anything else? (optional)**, placeholder "e.g. Severe nut allergy, carries an
  EpiPen", 200 characters.
- On a demo restaurant (`is_demo`, from `GET /api/r/{vid}`), a muted line above the checkboxes:
  "This is a demo restaurant. Anyone trying the demo staff view can read this, so please use
  made-up details."
- As soon as any box is ticked or the field holds text, a consent box appears (required):
  `[ ]` **I agree that Casa Lumen may use this to prepare our meal.**
  Hint: "We delete it 30 days after your visit. You can change or remove it with your
  booking link."
- Then an optional box, shown only when the restaurant has guest profiles switched on:
  `[ ]` **Remember it for my next visits to Casa Lumen**
  Hint: "Casa Lumen remembers it after your visit. Only Casa Lumen sees it. You can see or
  delete it from your SeatPlan account."
- Error if the consent box is left empty on submit (focus moves to it):
  "Please agree, or remove the allergies and diets you ticked."

The general notes field hint changes from "Allergies, a birthday, a pram..." to
"A pram, a late arrival, a dog under the table..." (allergies now have their own place).

The phone field's hint today promises "Only used if we need to reach you on the day." Using the
phone for profile suggestions would break that promise (purpose limitation). When the
restaurant has guest profiles on, the hint becomes: "Used if we need to reach you on the day,
and to help Casa Lumen recognise you." When profiles are off it stays as today. (Decision 9
may drop phone matching altogether.)

### 4.2 Diner: confirmation and manage link

`BookingSummary` rows (shared by Confirmation and ManageBookingPage) gain two rows when filled:
- **Occasion**: "Birthday · Ana turns 40"
- **Dietary needs**: "Tree nuts, Gluten · Severe nut allergy, carries an EpiPen"

Manage page (`/b/:token`): a new card **Occasion and dietary needs** with "Edit" (opens the
same two fieldsets as 4.1 in a form, button "Save details", secondary "Cancel") while
`can_change` is true. Success toast: "Saved. Casa Lumen will see the change on their floor."
When the booking has started: the card is read-only with "This booking has started, so the
details can no longer be changed."

At the bottom of the manage page, a muted line and link:
"Casa Lumen may keep a guest profile with your visits and notes. **See what they keep**"
(link to `/restaurants/account?data=<venue public id>`). Shown only when the restaurant has
guest profiles switched on; never shows profile content itself (see 8.2).

### 4.3 Diner: "Your data at restaurants" (`/restaurants/account`)

Signed-out: unchanged login (`SignInForm`). Signed-in: under "My account" a new section:

**Your data at restaurants**
Intro: "Each restaurant keeps its own guest profile. Restaurants never see each other's
profiles. Here is everything they keep about the email address you signed in with."

Per restaurant a card:
- Title: restaurant name; muted "Profile since 3 Mar 2026"
- Rows: "Visits: 4" · "Missed bookings: 0" · "Last visit: 12 Oct 2026, table 7"
- "Tags from the team: VIP, Likes the window"
- "Team note: Prefers still water. Likes table 7 by the window."
- "Remembered dietary needs: Tree nuts · Severe nut allergy (from your visit on 12 Oct 2026)"
  (or "None"), with a ghost link button **Forget my dietary needs** when not "None"
  (confirm: "Casa Lumen will no longer see these on your next bookings." Toast: "Done.
  Casa Lumen no longer remembers your dietary needs.")
- "Bookings kept: 6" with a fold listing date, time, party, status, occasion, dietary needs.
  Only bookings made with exactly this email address are listed (see 6.2).
- Buttons: secondary **Download my data** (JSON file `seatplan-casa-lumen-data.json`, built in
  the browser from the same answer), ghost-destructive **Erase my data at Casa Lumen**.

Erase dialog: title "Erase your data at Casa Lumen?", body: "Your guest profile, the team's
notes and tags, and the names and contact details on your past bookings there will be erased.
Upcoming bookings stay, so you can still go." Checkbox: "Also, do not recognise me at Casa
Lumen in the future". Buttons: pink **Erase my data**, secondary "Keep it". Done toast:
"Your data at Casa Lumen has been erased."

Unproven email (demo account whose code was shown on screen): "Confirm your email address to
see this. For the demo we only show the demo restaurants." (see decision 4).

### 4.4 Staff: floor booking card (`/staff/:venueId`, tab Floor, `SelectionPanel`)

Order in `BookingDetails`, top to bottom:
1. Name, time, people, tables (unchanged).
2. **Allergy banner** (amber warning tone, icon, first on purpose): "Allergies: Tree nuts,
   Gluten" then the diner's text in quotes. If the profile remembers others: "Remembered from
   earlier visits: Shellfish".
3. **Occasion**: chip "Birthday" + note "Ana turns 40".
4. **Guest** block: "4th visit · Last visit 12 Oct, table 7 · No missed bookings" or
   "New guest" or "2 missed bookings" (warning tone when 2 or more). Tags as chips. Team note
   (two lines, "Show more"). Buttons: ghost "Edit note and tags", ghost "Open profile".
5. Phone suggestion (only when present): "The phone number matches **Maria Costa** (4 visits).
   Same person?" buttons secondary "Yes, link them" and ghost "No, different people".
6. Existing badges, chair, wishes, notes, then `BookingActions` (unchanged).

The remembered line always names its source: "Remembered from the visit on 12 Oct: Shellfish",
so staff can tell a remembered list from tonight's own.

Edit popover "Edit note and tags": tag toggles (VIP, Likes a quiet table, Likes the window,
Friend of the house; no health tag, see 8.1), textarea "Team note" (500 characters) with the fixed
hint: "The guest can ask to see this note. Write only what you would be happy for them to
read, and no health details: use the guest's own allergy list." Buttons secondary "Save",
ghost "Cancel" (the floor's one pink button stays the booking action, e.g. "Seat now").
Toast: "Guest profile saved."

### 4.5 Staff: arrivals list badges (`FloorLists.ArrivalsList`)

After the existing badges, in this order: `Allergy` (warning), the occasion word ("Birthday"),
`VIP` (when tagged), `Returning` (1+ earlier visits) or nothing for new guests. Max four badges,
then "+1".

### 4.6 Staff: Guests tab (new 5th tab, after Schedule)

Heading **Guests**. Search field "Search by name, or type a full email or phone".
Filter chips: All, VIP, "Remembered dietary needs", Returning (the dietary chip filters on the
diner's own consented remembered list, never on a staff tag). Sort select: "Last visit",
"Most visits", "Name". The search field waits 300 ms after the last key before it asks.
Table columns: Name · Visits · Missed · Last visit · Tags. 20 rows, "Show more".
Empty: "No guests yet. Profiles appear after the first online booking."
Profiles off: "Guest profiles are switched off for this restaurant. The owner can switch them
on in the restaurant settings."

Profile dialog: name, "Profile since ...", the three numbers, tags, note (edit as in 4.4),
remembered dietary needs (read-only: "Only the guest can change this"), last 10 visits
(date, time, party, table, status, occasion). Footer: destructive ghost **Erase this guest**:
dialog "Erase Maria Costa's data at Casa Lumen? The profile, notes and tags are deleted and
past bookings are anonymised. Upcoming bookings stay. This cannot be undone." Reason radio:
"The guest asked us" / "Created by mistake". Pink **Erase**.

### 4.7 Owner: guest data settings (`/owner/:venueId/guests`, linked from the owner card)

Heading **Guest profiles**. Text: "SeatPlan can recognise returning guests at Casa Lumen by
their email address, so your team sees visits, missed bookings and its own notes. Casa Lumen
decides how this data is used; SeatPlan stores it for you."
- Switch **Recognise returning guests** (off until the owner switches it on, see decision 1).
- Select **Keep guest history for**: 12 months / 24 months (recommended) / 36 months.
- Fixed line: "Allergies and diets on a booking are always deleted 30 days after the visit,
  unless the guest asked you to remember them."
- Switching on opens: "Switch on guest profiles? SeatPlan will link your online bookings from
  the last 24 months to guest profiles, so your team sees returning guests. Guests can see
  and erase what you keep." Pink **Switch on**. Done toast: "Guest profiles are on. 132 guests
  recognised." (The months follow the select. At most the newest 2000 bookings are linked in
  this step; see 6.4.)
- Switching off opens: "Switch off guest profiles? All N guest profiles, notes and tags at
  Casa Lumen are erased now. Bookings stay." Pink **Switch off and erase**.

## 5. Data model

All changes in `backend/app/models.py` (shared; event tables untouched) and in
`backend/app/seed/migrate.py` (new columns appended in the same order as in models.py, as the
seed read-me requires).

### 5.1 New columns on `bookings`

| Column | Type | Rule |
|---|---|---|
| `occasion` | `VARCHAR(12)` null | `birthday`, `anniversary`, `proposal`, `business`, `other` |
| `occasion_note` | `VARCHAR(80) NOT NULL DEFAULT ''` | PlainText |
| `dietary` | `JSON NOT NULL DEFAULT '[]'` | sorted keys from `DIETARY_KEYS` |
| `dietary_note` | `VARCHAR(200) NOT NULL DEFAULT ''` | PlainText |
| `dietary_consent_at` | `TIMESTAMP` null | set when dietary is non-empty |
| `remember_dietary` | `BOOLEAN NOT NULL DEFAULT FALSE` | |
| `guest_id` | `INTEGER REFERENCES restaurant_guests (id)` null | the profile this booking counts for |
| `closed_tables` | `JSON NOT NULL DEFAULT '[]'` | table labels copied when the booking closes (slots are deleted then) |
| `anonymised_at` | `TIMESTAMP` null | set by erasure or retention |
| `email_key` | `VARCHAR(64)` null, indexed | `diner_keys.email_key(email)`; set at creation for diner bookings, null for walk-ins and after anonymising. Lets 6.2 find a diner's bookings across restaurants with one indexed lookup instead of scanning `bookings.email` |

### 5.2 New columns on `venues`

| Column | Type |
|---|---|
| `guest_profiles` | `BOOLEAN NOT NULL DEFAULT FALSE` (the owner, as controller, switches it on; existing restaurants are not profiled by a migration) |
| `guest_retention_months` | `INTEGER NOT NULL DEFAULT 24` (allowed 12, 24, 36) |

Event venues get the columns too and never read them. The demo seed sets `guest_profiles=True`
on Casa Lumen only.

### 5.3 New table `restaurant_guests` (one row per guest per restaurant)

```
id                  INTEGER PK (sqlite_autoincrement, like guest_accounts)
public_id           VARCHAR(32) UNIQUE        new_public_id()
venue_id            INTEGER FK venues ON DELETE CASCADE, indexed
display_name        VARCHAR(120)              name on the latest booking
tags                JSON '[]'                 subset of GUEST_TAGS
staff_note          VARCHAR(500) ''
dietary             JSON '[]'                 remembered, only with consent
dietary_note        VARCHAR(200) ''
dietary_consent_at  TIMESTAMP null
dietary_from        DATE null                 the date of the completed visit it was remembered from
dismissed_matches   JSON '[]'                 public ids staff marked "No, different people" (max 20)
opted_out           BOOLEAN FALSE             "do not recognise me": row keeps only its email key
last_booking_on     DATE null                 for retention: max(date) of its linked bookings
created_at, updated_at  TIMESTAMP
```

An opted-out row holds no name, note, tag or dietary data, only its keyed email hash. It is the
record of the diner's objection, so retention (step 3) and the owner's switch-off (`erase_all`)
keep it; otherwise the diner would be profiled again after the next booking.

No email, no phone in plain text here: the profile is found through keys (5.4). Staff never see
the guest's email or phone through this feature (data minimisation; the floor does not show
them today either).

### 5.4 New table `restaurant_guest_keys`

```
id          INTEGER PK
guest_id    INTEGER FK restaurant_guests ON DELETE CASCADE, indexed
venue_id    INTEGER FK venues ON DELETE CASCADE      (denormalised for the unique index)
kind        VARCHAR(8)                                 'email' | 'phone'
key_hash    VARCHAR(64)                                keyed_hash('diner-email|' + email.strip().lower()) or ('diner-phone|' + E.164)
created_at  TIMESTAMP
```

- The email key is the exact address, trimmed and lower-cased, **not** `security.mailbox()`:
  stripping `+tag` would let the owner of `ana+x@corp.pt` read the data of `ana@corp.pt` on a
  provider where `+` is an ordinary character (6.2). Two tagged addresses of one person become
  two profiles that staff can link.
- Partial unique index: one guest per email per restaurant. Phones are not unique (families
  share a number); a phone match is only ever a suggestion.
- Several email keys per guest are possible after staff link two profiles.
- The email key is the same at every restaurant (one HMAC), so `GET /api/diner/data` can find
  all of a diner's profiles with one indexed lookup on `key_hash`. Nobody outside the backend
  ever sees a key.

### 5.5 `migrate.py` entries

Append to `NEW_COLUMNS` (after `("bookings", "prefs", ...)`):

```python
("bookings", "occasion", "VARCHAR(12)"),
("bookings", "occasion_note", "VARCHAR(80) NOT NULL DEFAULT ''"),
("bookings", "dietary", "JSON NOT NULL DEFAULT '[]'"),
("bookings", "dietary_note", "VARCHAR(200) NOT NULL DEFAULT ''"),
("bookings", "dietary_consent_at", "TIMESTAMP"),
("bookings", "remember_dietary", "BOOLEAN NOT NULL DEFAULT FALSE"),
("bookings", "guest_id", "INTEGER REFERENCES restaurant_guests (id)"),
("bookings", "closed_tables", "JSON NOT NULL DEFAULT '[]'"),
("bookings", "anonymised_at", "TIMESTAMP"),
("bookings", "email_key", "VARCHAR(64)"),
("venues", "guest_profiles", "BOOLEAN NOT NULL DEFAULT FALSE"),
("venues", "guest_retention_months", "INTEGER NOT NULL DEFAULT 24"),
```

Append to `RESTAURANT_INDEXES` (not `NEW_INDEXES`, which keeps its historical contract):

```python
("ix_bookings_guest_id", "CREATE INDEX IF NOT EXISTS ix_bookings_guest_id ON bookings (guest_id)"),
("ix_bookings_email_key", "CREATE INDEX IF NOT EXISTS ix_bookings_email_key ON bookings (email_key)"),
("uq_guest_keys_email",
 "CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_keys_email "
 "ON restaurant_guest_keys (venue_id, key_hash) WHERE kind = 'email'"),
("ix_guest_keys_lookup",
 "CREATE INDEX IF NOT EXISTS ix_guest_keys_lookup ON restaurant_guest_keys (venue_id, kind, key_hash)"),
("ix_guest_keys_hash",
 "CREATE INDEX IF NOT EXISTS ix_guest_keys_hash ON restaurant_guest_keys (key_hash)"),
```

(`ix_guest_keys_lookup` leads with `venue_id`, so it cannot serve the cross-restaurant lookup of
6.2; `ix_guest_keys_hash` does.)

The models declare the same indexes (`Index(..., sqlite_where=..., postgresql_where=...)`) so
`create_all` and the upgrade produce the same schema. The two new tables are created by
`create_all` before `upgrade_schema`, so the `guest_id` foreign key resolves. Partial indexes
work on SQLite 3.8+ and Postgres. Server defaults match models.py word for word
(`server_default=text("FALSE")` for `guest_profiles`). The demo reset (`routers/demo._wipe`)
deletes in reverse `sorted_tables` order, so `bookings` goes before `restaurant_guests`.

`email_key` of existing rows cannot be filled by SQL (it needs `SECRET_KEY`). It is filled in
batches by step 0 of the retention job (6.6, 7) and on demand by the owner's switch-on backfill
for that restaurant (6.4). No one-off production script is needed: existing restaurants start
with profiles off (5.2), so nothing is linked until an owner asks for it.

## 6. API

All bodies use `extra="forbid"`; text uses `PlainText`. Errors are the usual
`{"error": {"code", "message"}}`.

### 6.1 Diner, no account

**POST `/api/r/{vid}/bookings`** (changed, `routers/restaurants.py` `BookingIn`). New optional
fields:

```json
{ "occasion": "birthday", "occasion_note": "Ana turns 40",
  "dietary": ["tree_nuts", "gluten"], "dietary_note": "Severe, carries an EpiPen",
  "dietary_consent": true, "remember_dietary": false }
```

- `occasion`: `Literal[...] | None`; `occasion_note` max 80 and only with an occasion.
- `dietary`: list of `DIETARY_KEYS`, max 19, no repeats; `dietary_note` max 200.
- 422 `validation` "dietary_consent: Please agree, or remove the allergies and diets." when
  dietary or its note is set without consent; same for `remember_dietary` without consent.
  `remember_dietary: true` at a restaurant with profiles off is stored as false.
- Response `booking` (from `describe`) gains `occasion`, `occasion_note`, `dietary`,
  `dietary_note`, `remember_dietary`.

**GET `/api/r/{vid}`** (changed): gains `"is_demo": bool` and `"guest_profiles": bool`, so the
details step can show the demo warning, the phone hint and the "Remember it" box (4.1).

**GET `/api/b/{token}`** (changed): the same five fields, plus
`"guest_profiles": true|false` (whether the restaurant keeps profiles). Never profile content.

**PUT `/api/b/{token}/details`** (new, `routers/bookings.py`). Auth: manage token. Limit:
`MANAGE_LIMIT` per address. Body: the six fields above, full replacement, and **every field is
required** (no defaults): a client that forgets a field gets 422 instead of silently deleting
a severe allergy. Clearing is explicit: `{"occasion": null, "occasion_note": "", "dietary": [],
"dietary_note": "", "dietary_consent": false, "remember_dietary": false}`. 409 `conflict` /
`deadline_passed` through `manage_flow.check_changeable`. 200: `describe(...)`. Bumps the
venue-day live scope (staff floor refreshes). No email is sent for a details change
(decision 8). It never writes to the guest profile (remembering happens at the visit, 7).

### 6.2 Diner with a SeatPlan account (`CurrentGuestAccount`), new `routers/diner_data.py`

**GET `/api/diner/data`**. Limit 20/min per account. 403 `forbidden` "Confirm your email
address to see this." when `email_proven` is false (demo exception, decision 4). 200:

```json
{ "email": "ma***@example.com",
  "restaurants": [ {
    "restaurant": {"public_id": "...", "name": "Casa Lumen", "slug": "casa-lumen"},
    "profile": { "since": "2026-03-03", "visits": 4, "missed": 0,
                 "last_visit": {"date": "2026-10-12", "tables": ["7"]},
                 "tags": ["vip", "window_table"], "staff_note": "...",
                 "dietary": ["tree_nuts"], "dietary_note": "...", "opted_out": false },
    "bookings": [ {"date": "2026-10-12", "time": "20:00", "party_size": 2, "status": "completed",
                   "occasion": "anniversary", "occasion_note": "", "dietary": [], "dietary_note": ""} ]
  } ] }
```

Found by `email_key(account.email)` (exact lower-cased address, never `mailbox()`): profiles
through `restaurant_guest_keys.key_hash` (index `ix_guest_keys_hash`), bookings through
`bookings.email_key` (index `ix_bookings_email_key`), so restaurants with profiles off are
covered too. The bookings list is always filtered by the account's own email key, never by
`guest_id`: after staff link two profiles (S4) a diner never sees the other person's bookings,
occasions or dietary lists. Max 50 bookings per restaurant, newest first, max 100
restaurants. No booking ids, no manage tokens, no key hashes. Bookings whose `email_key` is
still null (older than the batched fill, 7 step 0) are not found yet; the page says nothing
about them, and the retention job fills them within a few runs.

**POST `/api/diner/data/{venue_public_id}/erase`**. Limit 5/min per account. Body
`{"keep_out": false}`. Same proof rule. Venue through `venue_access.load_restaurant` (event
venues 404). Calls `diner_profiles.erase_guest(..., reason="diner_request", actor="diner")`
for the matching profile, and anonymises this email's finished bookings at that restaurant
even when there is no profile. `keep_out: true` leaves an opted-out row holding only the email
key. Public reviews (`restaurant_reviews`) are not touched: the diner deletes them on the
review itself. 200 `{"erased": true}`; 404 when nothing matches.

**DELETE `/api/diner/data/{venue_public_id}/dietary`**. Limit 5/min per account. Same proof
rule. Clears `dietary`, `dietary_note`, `dietary_consent_at`, `dietary_from` on the matching
profile (withdrawal of the "remember" consent) and sets `remember_dietary=false` on this
email's upcoming bookings there, so the next completed visit does not remember them again.
The upcoming bookings' own dietary lists stay (they serve that meal; the manage link changes
them). 200 `{"forgotten": true}`; 404 when there is no profile.

### 6.3 Staff (`CurrentUser` + `load_for_staff`), new `routers/diner_profiles.py`

Every **new** route in the table below (not the changed floor route) calls
`rate_limit(session, f"crm-read:{user.id}|{client_ip(request)}", 120, 60)` or
`crm-write:{user.id}|{client_ip(request)}`, 30 per minute. The floor is not counted: it reloads
every 15 s and on every live bump per open tab (`StaffFloor.tsx`), and the demo staff login is
shared by every demo visitor, so a per-user floor limit would break the floor for everyone.
The address is part of the key for the same reason (one shared demo user). 409 `conflict`
"Guest profiles are switched off for this restaurant." when `venue.guest_profiles` is false
(except erase).

Every `guest_id` (path or body) is a profile **public id** resolved with
`venue_id == venue.id`; a profile of another restaurant answers 404 exactly like a missing one
(no IDOR across restaurants). `booking_id` is resolved with `staff_floor.load_booking` (same
venue rule).

| Method, path | Body / query | 200 answer |
|---|---|---|
| GET `/api/staff/{vid}/floor` (changed, `staff.py`) | unchanged | each booking gains `occasion`, `dietary`, ... and `guest` (card, 6.5) |
| GET `/api/staff/{vid}/guests` | `q` (max 120), `tag`, `sort=recent|visits|name`, `limit<=50`, `offset<=10000` | `{"items": [row], "total": n}` |
| GET `/api/staff/{vid}/guests/{guest_id}` | | profile + last 10 visits |
| PATCH `/api/staff/{vid}/guests/{guest_id}` | `{"tags": [...]? , "staff_note": "..."?}` | profile |
| POST `/api/staff/{vid}/guests/{guest_id}/erase` | `{"reason": "guest_request" | "mistake"}` | `{"erased": true}` |
| POST `/api/staff/{vid}/bookings/{booking_id}/guest-match` | `{"action": "link" | "not_same", "guest_id": "..."}` | the booking's floor card |

`link` merges the booking's profile into `guest_id` in one transaction (bookings, keys, tags
union, staff notes joined, remembered dietary union with the newer `dietary_from`), then deletes
the source profile. Refused (409) when either profile is opted out or when they are the same
row. `not_same` appends `guest_id` to the booking profile's `dismissed_matches` so the
suggestion does not come back on the next booking from the same family phone.

`q`: if it contains `@` it is turned into an email key (exact lower-cased); if it is mostly digits, a phone key;
otherwise a case- and accent-insensitive search on `display_name` (Python side, like
`discovery.py`, over the restaurant's profiles). An unknown email answers an empty list, never
"this email exists elsewhere".

### 6.4 Owner (`CurrentOrganiser` + `profiles.load`), same new router

| Method, path | Body | 200 |
|---|---|---|
| GET `/api/owner/restaurants/{vid}/guest-settings` | | `{"guest_profiles": true, "retention_months": 24, "profiles": 132}` |
| PUT `/api/owner/restaurants/{vid}/guest-settings` | `{"guest_profiles": bool, "retention_months": 12|24|36, "confirm_erase_all": bool}` | same shape |

Turning profiles off without `confirm_erase_all: true` is 422. Turning off erases every profile
of that restaurant except opted-out rows (bookings stay, `guest_id` set to null with one bulk
UPDATE before the bulk DELETE, because of the foreign key).

Turning profiles **on** (false to true) runs `diner_profiles.backfill(session, venue,
limit=2000)` in the same request: the newest 2000 `source="diner"` bookings with a non-empty
email, `anonymised_at` null and a date inside `guest_retention_months`, linked oldest first
with bulk inserts (one HMAC per booking, fills `email_key` too). This stays well inside
Vercel's 30 s. The answer gains `"linked": n, "more": bool`; when `more` is true the page says
"Older bookings were not linked." and nothing else happens (no background work). Bookings of a
mailbox that opted out stay unlinked. Owner actions are audited as `guest.settings` with the
old and new values only.

### 6.5 Floor card shape (`bookings[].guest`, staff only)

```json
{ "id": "k3J...", "name": "Maria Costa", "is_new": false, "visit_number": 4,
  "earlier_visits": 3, "missed": 0,
  "last_visit": {"date": "2026-10-12", "tables": ["7"]},
  "tags": ["vip", "window_table"], "staff_note": "Prefers still water...",
  "remembered_dietary": ["shellfish"], "remembered_dietary_note": "",
  "phone_match": {"guest_id": "x9...", "name": "Maria Costa", "visits": 4} }
```

`null` when the booking has no profile (walk-in, profiles off, opted out). Visits count only
bookings that ended before this booking starts, so tonight's booking is never its own history.

### 6.6 Internal, new `routers/data_retention.py`

**POST `/api/internal/retention/process`**, header `X-Cron-Secret` (same check as the email
route: empty secret refuses everyone, constant-time compare), limit 30/min per address.
200 `{"dietary_cleared": n, "bookings_anonymised": n, "profiles_deleted": n}`.

## 7. Backend modules

New files in `backend/app/restaurant_service/` (none named `guest_*`):

| File | Pure? | Functions |
|---|---|---|
| `booking_details.py` | yes | `OCCASIONS`, `ALLERGENS` (14, EU Regulation 1169/2011 Annex II), `DIETS` (5), `DIETARY_KEYS`, `GUEST_TAGS`; `clean_details(occasion, occasion_note, dietary, dietary_note, consent, remember) -> BookingDetails` (sorts, de-duplicates, raises `ApiError 422`); `dietary_words(keys) -> str` ("Tree nuts, Gluten"); `occasion_words(key) -> str`; `clean_tags(tags)` |
| `diner_keys.py` | yes (plus `security.keyed_hash`) | `normalise_phone(raw, country="351") -> str | None` (digits; `00` -> `+`; 9 digits starting 2 or 9 get `+351`; under 8 digits -> None); `email_key(email)` = `keyed_hash("diner-email|" + mailbox(email))`; `phone_key(e164)` |
| `diner_profiles.py` | no | `link_booking(session, venue, booking)` (find or create the profile by email key inside `session.begin_nested()`, catching `IntegrityError` and re-reading, so a race never surfaces as `SeatTaken`; adds the phone key; copies remembered dietary when asked); `cards_for(session, venue, bookings) -> dict[int, dict]` (one grouped query: earlier visits, missed, last visit date and `closed_tables`, phone matches); `profile(...)`, `search(...)`, `update(...)`, `link_match(...)`, `not_same(...)`, `erase_guest(session, venue, guest, reason, actor)`, `erase_all(session, venue, actor)` |
| `diner_data.py` | no | `my_data(session, account) -> dict`, `erase_mine(session, account, venue, keep_out)` |
| `data_retention.py` | no | `run(session, now, batch=500) -> Counts`: (1) clear `dietary`, `dietary_note`, `dietary_consent_at`, `occasion_note` on closed bookings that ended more than `DIETARY_KEEP_DAYS = 30` days ago; (2) anonymise bookings older than the venue's `guest_retention_months` (name "Former guest", email "", phone null, notes "", `guest_id` null, `anonymised_at` now) and blank their outbox rows; (3) delete profiles whose `last_booking_on` is older than retention and that have no active booking. Each step stops at `batch` rows, so one call stays well inside Vercel's 30 s |

Changed files:

| File | Change |
|---|---|
| `diner_flow.py` | `confirm_booking(..., details: BookingDetails = NO_DETAILS)`; sets the new columns; after `write_slots` calls `diner_profiles.link_booking` when `venue.guest_profiles` |
| `booking_rows.py` | `describe()` adds the five detail fields (the diner's own data, safe for `/b/`); never the profile |
| `staff_floor.py` | `floor()` adds `guest` from `diner_profiles.cards_for` to each booking row (staff only); `set_status()` copies `table_labels(...)` into `closed_tables` before `release_slots` for `completed` and `no_show`, and updates the profile's `last_booking_on` |
| `manage_flow.py` | `change_details(session, venue, booking, details)`: `check_changeable`, set fields, update remembered dietary (setting `remember=False` clears the profile's remembered list only if it came from this booking), `record_change(... action="booking.details", detail={"fields": [...names]})` |
| `email_facts.py` | `RestaurantBooking` gets `occasion_text` and `dietary_text` from `booking_details` words |
| `mail/restaurant_templates.py` | `_details()` adds rows "Occasion" and "Dietary needs" for `confirmed` and `changed`; `reminder` shows "Dietary needs: Noted. Check them with the link below." without details (a reminder is queued days ahead and must not go stale or repeat health data) |
| `seed/demo_restaurant.py` | demo guests (section 11) |

Audit rows (`changes.record_change`) carry ids and field names only, never the dietary list,
the notes or the occasion note.

Reused as is: `security.mailbox`, `security.keyed_hash`, `security.rate_limit`,
`venue_access.load_for_staff`, `profiles.load`, `booking_rows.table_labels`,
`manage_flow.check_changeable`, `changes.record_change`, `core.text.PlainText`,
`core.privacy.mask_email`, `db.insert_ignoring_duplicates`.

## 8. Security, privacy and abuse

### 8.1 Roles and GDPR position (our reading, not legal advice)

- Each restaurant is the **controller** of its guest profiles; SeatPlan is the **processor**.
  The owner terms need a data processing agreement (Art. 28). Lawful basis for profiles:
  legitimate interest of the restaurant (Art. 6(1)(f)) in recognising regulars, with an
  easy objection (opt-out, erasure). Booking details: performance of the booking (Art. 6(1)(b)).
- **Allergies and diets are special category data** (health; halal and kosher may reveal
  religion, Art. 9). Basis: explicit consent (Art. 9(2)(a)) given by the separate consent box,
  stored as `dietary_consent_at`. Remembering them for later visits is a second, separate
  consent. Withdrawal: remove them on the manage link or erase from the account.
- **Minimisation**: profiles hold no email or phone in clear; staff never see contact data
  through this feature; staff tags come from a fixed list (no free "bad guest" tags); the
  staff note warns that guests can read it; the floor card is built only for staff routes.
- **Transparency**: the details step says how long allergies are kept; the manage page says a
  profile may exist; the account page shows everything. The privacy notice must be updated
  (Martim, 13).

### 8.2 Who sees what

| Viewer | Sees |
|---|---|
| Anyone with the manage link | This booking's own details only, and whether profiles exist. Never visits, notes or tags (the email at booking time is not verified, so a stranger who typed someone's email must learn nothing) |
| Signed-in diner with a proven email | Every profile and booking matching their mailbox, at every restaurant |
| Staff / owner of the restaurant | That restaurant's profiles; never another restaurant's (`load_for_staff` 404) |
| Demo staff role | Demo restaurants only (existing rule) |
| Other diners, public pages, reviews, discovery | Nothing new |

### 8.3 Abuse limits and caps

- Diner routes: existing `BOOK_LIMIT` and `MANAGE_LIMIT`; account data 20/min, erase 5/min.
- Staff: 120 reads, 30 writes per minute per user; list `limit <= 50`, `offset <= 10000`;
  no CSV export (bulk extraction).
- Sizes: occasion note 80, dietary note 200, staff note 500, up to 19 dietary keys, up to 5
  tags. `PlainText` refuses control characters.
- A stranger who books with someone else's email: the booking links to that person's profile
  at that restaurant, and staff may see the history. Accepted risk; the stranger learns
  nothing (8.2) and the phone is never used to auto-link. A remembered allergy written this
  way is shown with its source date ("Remembered from the booking of 12 Oct").
- Erasure is always allowed, even with profiles off.

### 8.4 Retention

| Data | Kept until |
|---|---|
| Allergies, diets and the occasion note on a booking | 30 days after the visit (or cancellation) |
| Remembered allergies on a profile | as long as the profile, or until the diner removes them |
| Profile, notes, tags | `guest_retention_months` (default 24) after the last booking, then deleted |
| Booking name, email, phone, notes | anonymised after `guest_retention_months`; counts, party size and status stay for the dashboard |
| Outbox words | unchanged: 30 days (S9); erasure blanks the booking's queued and finished rows at once |

This closes the diner half of security finding S23; `docs/security.md` is updated.

### 8.5 Erasure

`erase_guest` in one transaction: null `bookings.guest_id`; anonymise the guest's closed
bookings; for upcoming bookings only clear the profile link (the booking stays a contract);
blank `email_outbox` rows whose key starts with `booking-confirmed-<id>` or
`booking-changed-<id>-` for the anonymised bookings (like `events_service/mailer.py` does for
event guests, without importing or changing it); delete the profile (keys cascade); with
`keep_out` insert an opted-out row with the email key only; `record_change` with
`action="guest.erase"`, `detail={"reason": ...}`.

### 8.6 Deleting a SeatPlan account

`POST /guest/me/delete` (events code, untouched) deletes the account but not the restaurants'
profiles, which belong to the restaurants. The account page says so before the diner deletes:
"Deleting your account does not erase what restaurants keep. Erase it below first." (copy on
`DinerAccountPage`, not on the events `AccountPage`).

## 9. Frontend

| File | Change |
|---|---|
| `src/api/restaurant.ts` | `BookingDetailsInput`, `BookingView`/`StaffBooking` gain `occasion`, `occasion_note`, `dietary`, `dietary_note`, `remember_dietary`; `StaffBooking.guest?: GuestCard | null`; `createBooking(..., details)`; `saveBookingDetails(token, details)` |
| `src/api/dinerProfiles.ts` (new) | staff `listGuests`, `getGuest`, `patchGuest`, `eraseGuest`, `guestMatch`; owner `getGuestSettings`, `putGuestSettings`; diner `getMyData`, `eraseMyData` (auth `"guest"`) |
| `pages/restaurant/bookingDetails.ts` (new, pure) | option lists and labels mirroring the server, `toggleDietary`, `detailsWords`, `needsConsent`, `validateDetails` |
| `pages/restaurant/BookingExtras.tsx` (new) | the two fieldsets of 4.1, reused by StepDetails and the manage form |
| `pages/restaurant/StepDetails.tsx` | second fold, consent focus on error, notes hint |
| `pages/restaurant/useBookingFlow.ts`, `BookingPage.tsx` | keep `details` beside `contact` so going back to the map keeps them |
| `pages/restaurant/BookingSummary.tsx`, `Confirmation.tsx` | two rows |
| `pages/restaurant/ManageBookingPage.tsx`, `ManageDetailsForm.tsx` (new) | card, edit form, data link |
| `pages/restaurant/SelectionPanel.tsx`, `GuestCard.tsx` (new), `GuestEditPopover.tsx` (new), `guestTags.ts` (new, pure) | floor card, allergy banner, phone match |
| `pages/restaurant/FloorLists.tsx` | arrivals badges (pure helper `arrivalBadges` in `guestTags.ts`) |
| `pages/restaurant/StaffPage.tsx`, `StaffGuests.tsx` (new), `GuestProfileDialog.tsx` (new) | fifth tab "Guests" |
| `pages/restaurant/staff.css`, `restaurant.css` | card and chip styles (theme tokens only) |
| `pages/discover/DinerAccountPage.tsx`, `MyRestaurantData.tsx` (new) | section 4.3 (imports `SignInForm` from `pages/account` as today; nothing in that folder changes) |
| `pages/owner/GuestSettingsPage.tsx` (new), `OwnerHomePage.tsx` | 4.7 and a "Guest profiles" link on the card |
| `src/App.tsx` | route `/owner/:venueId/guests` |

`/restaurants/account?data=<vid>` scrolls to and opens that restaurant's card.

## 10. Tests (written first for pure logic and security)

pytest (`backend/tests/`):
- `test_booking_details.py`: `test_known_occasions_and_allergens_accepted`,
  `test_unknown_dietary_key_refused`, `test_dietary_without_consent_refused`,
  `test_remember_without_consent_refused`, `test_occasion_note_needs_occasion`,
  `test_dietary_sorted_and_deduplicated`, `test_dietary_words_in_fixed_order`.
- `test_diner_keys.py`: `test_email_key_ignores_case_and_plus_tag`,
  `test_phone_spaces_dashes_and_00_prefix`, `test_portuguese_nine_digits_get_351`,
  `test_short_phone_is_none`, `test_keys_are_keyed_not_plain_sha256`.
- `test_diner_profiles.py`: `test_first_booking_creates_profile`,
  `test_same_mailbox_links_same_profile`, `test_profiles_are_per_restaurant`,
  `test_visits_and_missed_counted_from_closed_bookings`, `test_tonight_is_not_its_own_history`,
  `test_last_table_survives_closing`, `test_phone_match_is_only_a_suggestion`,
  `test_link_match_moves_bookings_and_keys`, `test_not_same_drops_phone_key`,
  `test_profiles_off_links_nothing`, `test_opted_out_mailbox_not_recognised`,
  `test_concurrent_first_bookings_make_one_profile` (threads),
  `test_key_race_never_reported_as_seat_taken`.
- `test_diner_profile_privacy.py` (security, first): `test_manage_view_has_no_profile`,
  `test_no_diner_route_returns_staff_note` (scans every public response of a seeded flow),
  `test_other_restaurant_staff_get_404`, `test_demo_staff_cannot_read_real_restaurant_guests`,
  `test_my_data_needs_proven_email`, `test_my_data_only_my_mailbox`,
  `test_audit_never_holds_dietary_or_notes`, `test_erase_anonymises_closed_bookings_and_outbox`,
  `test_erase_keeps_upcoming_booking_contact`, `test_staff_note_control_chars_refused`,
  `test_unknown_tag_refused`, `test_staff_guest_reads_rate_limited`,
  `test_unknown_email_search_reveals_nothing`.
- `test_data_retention.py`: `test_dietary_cleared_30_days_after_visit`,
  `test_remembered_dietary_kept_on_profile`, `test_old_bookings_anonymised_per_venue_months`,
  `test_profile_deleted_after_retention_without_active_booking`, `test_batches_are_bounded`,
  `test_run_twice_changes_nothing`, `test_endpoint_needs_cron_secret`,
  `test_empty_cron_secret_refuses_everyone`.
- additions: `test_restaurant_emails.py` (`test_confirmation_lists_occasion_and_dietary`,
  `test_reminder_says_noted_without_details`, `test_details_html_escaped`);
  `test_migrate_restaurants.py` (`test_migrate_adds_booking_details_and_guest_tables`, from the
  frozen old schema, run twice); `test_staff_endpoints.py`
  (`test_floor_bookings_carry_guest_card`, `test_closing_copies_table_labels`);
  `test_bookings_manage.py` (`test_put_details_bumps_floor`, `test_put_details_after_start_409`);
  `test_restaurant_seed.py` (`test_demo_has_returning_guests_and_an_allergy_tonight`).

vitest (`frontend/src/...`):
- `pages/restaurant/__tests__/bookingDetails.test.ts`: toggle, words, consent rule.
- `pages/restaurant/__tests__/bookingExtras.test.tsx`: consent box appears only after a
  choice; submit focuses consent; proposal hint; phone "Show all 14 allergens".
- `pages/restaurant/__tests__/guestCard.test.tsx`: allergy banner first, "New guest" vs
  "4th visit", missed warning from 2, phone match buttons, note hint text.
- `pages/restaurant/__tests__/staffGuests.test.tsx`: search, filter, erase dialog.
- `pages/restaurant/__tests__/manage.test.tsx` (extend): edit and save details.
- `pages/discover/MyRestaurantData.test.tsx`, `pages/owner/GuestSettingsPage.test.tsx`.

Playwright (`frontend/e2e/`):
- `restaurant-booking-details.spec.ts`: book with Birthday and Tree nuts (consent), see them on
  the confirmation; staff floor shows the allergy banner and "Birthday"; staff tags VIP; the
  manage link edits the occasion and the floor updates.
- `restaurant-diner-data.spec.ts`: sign in, see Casa Lumen's profile, download JSON, erase;
  staff card then shows "New guest" for the next booking.
- `restaurant-journey-mobile.spec.ts` (extend): the details fold at 390 px, no horizontal scroll.
- `accessibility.spec.ts` (extend): axe on the details step with the fold open and on the
  Guests tab.

Contrast: `npm run contrast` covers the new amber banner and chips (theme tokens only).

## 11. Files touched

Backend: `app/models.py`*, `app/seed/migrate.py`*, `app/main.py`* (register 3 routers),
`app/restaurant_service/{booking_details,diner_keys,diner_profiles,diner_data,data_retention}.py`
(new), `app/restaurant_service/{diner_flow,booking_rows,staff_floor,manage_flow,email_facts}.py`,
`app/mail/restaurant_templates.py`*, `app/routers/{restaurants,bookings,staff}.py`,
`app/routers/{diner_profiles,diner_data,data_retention}.py` (new),
`app/seed/demo_restaurant.py`, `app/seed/link_diner_profiles.py` (new), READ_ME_FIRST.md of
`app/`, `restaurant_service/`, `routers/`, `seed/`, `mail/`.
Tests: the files in section 10.
CI: `.github/workflows/email-cron.yml`* (second curl step to `/api/internal/retention/process`).
Frontend: the files in section 9, `frontend/e2e/*` above, READ_ME_FIRST.md of
`pages/restaurant/`, `pages/discover/`, `pages/owner/`, `api/`.
Docs: `docs/security.md` (S23, section 6), `docs/CONTRACT.md` (new routes), `docs/data-model.md`.

\* shared with other features or with events. Event behaviour must not change: the new Venue
columns are ignored by events; `main.py` only gains registrations; the workflow keeps its first
step unchanged. Files most likely to conflict with parallel restaurant features:
`models.py`, `migrate.py`, `booking_rows.describe`, `StepDetails.tsx`, `SelectionPanel.tsx`,
`StaffPage.tsx` (tabs), `api/restaurant.ts`, `restaurant_templates.py`. Not touched:
`pages/room-editor/`, any event path, `routers/guest_*.py`, `events_service/`.

## 12. Rollout and demo data

1. Merge behind nothing (no flag needed: all new fields are optional).
2. Production: back up the database, run `python -m app.seed.migrate`, then
   `python -m app.seed.link_diner_profiles`, then deploy (memory: back up and migrate before
   the merge). Add the second curl step to `email-cron.yml`; it uses the existing secrets.
3. Demo seed (`demo_restaurant.py`, Casa Lumen, fixed `random.Random(2026)`): 12 named regulars
   chosen from the existing name lists with 2 to 6 past completed visits each, 2 with one or two
   no-shows; past bookings get `closed_tables`; tags (2 VIP, 1 Allergy, 2 Likes the window);
   short neutral staff notes ("Prefers still water."); tonight: one birthday ("Ana turns 40"),
   one anniversary, one business dinner, one tree-nut allergy with consent and a remembered
   shellfish allergy, one new guest whose phone matches a regular (to show the suggestion).
   All emails stay `@example.com`. The 20 Lisbon catalogue restaurants get no profiles
   (their bookings are simulated); `demo_showcase.py` is unchanged.
4. Docs: security S23 moves to "Partly fixed" (diners), with the retention table.

## 13. What Martim must do (accounts, cost, legal)

- External services: **none**. No new account, no cost. Emails use the existing outbox and
  provider; the retention job uses the existing GitHub Actions cron and `CRON_SECRET`.
- Legal (before real restaurants use it): add a data processing agreement to the owner terms;
  update the diner privacy notice (profiles per restaurant, allergies with consent, retention
  periods, how to see and erase); keep a record of processing (Art. 30); a short DPIA is
  advisable because of health data; check the consent wording with someone qualified in
  Portuguese/EU data protection law (CNPD guidance).

## 14. Open decisions for Martim

1. Guest profiles on by default for new restaurants? **Recommended: on**, with the owner
   switch; the owner is the controller and sees the setting on the owner card.
2. Default history length? **Recommended: 24 months**, options 12/24/36.
3. Allergy data kept on a booking after the visit? **Recommended: 30 days.**
4. Demo accounts with an unproven email see their data? **Recommended: only for demo
   restaurants (`is_demo`)**, real restaurants require a proven email.
5. May staff set the "Allergy: ask first" tag themselves? **Recommended: yes, as a flag
   without details**; details only from the diner's own consented list.
6. Backfill existing production bookings into profiles? **Recommended: yes**, one-off script
   after migrate; otherwise every regular starts as "New guest".
7. Retention job: its own endpoint plus a second step in the email workflow, or inside the
   email route? **Recommended: own endpoint** (keeps the email route's tests and behaviour).
8. Email the diner when only the details change? **Recommended: no** (the manage page confirms
   on screen; no new email kind).
9. Phone matching: suggestion only, or auto-link? **Recommended: suggestion only.**
10. Daily "service notes" email to the owner with tonight's allergies? **Recommended: not in
    v1** (health data by email; the floor already shows it).

## 15. Size

**L**, about 7 to 9 working days for one developer: backend models, migration, profiles and
retention 3 days; API and security tests 1.5 days; diner UI 1.5 days; staff floor card and
Guests tab 2 days; owner settings, account page, e2e and docs 1 to 1.5 days.

Main risks: shared-file conflicts (`describe`, `StepDetails`, `SelectionPanel`, `models.py`);
special-category data handled wrongly if consent is skipped in a later refactor (guarded by
tests); visit counts depend on staff closing bookings as completed or no-show (a past booking
left "confirmed" counts as neither); rotating `SECRET_KEY` changes every key, so profiles stop
matching until `link_diner_profiles` is re-run (old notes stay on orphaned profiles until
retention); the new Guests tab adds a fifth staff tab on narrow laptops.
