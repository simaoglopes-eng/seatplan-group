# Changelog

What changed in SeatPlan, newest first. Each line comes from an entry in
[`decisions-log.md`](decisions-log.md) (named in brackets), where the reasons
are written out in full. Two short names: "platform fixes" means the section
"fixes after the adversarial review (platform)", and "events and restaurants
fixes" means "fixes after the adversarial review (events, restaurants,
frontend, verification)". The version number is `APP_VERSION` in
`backend/app/config.py`.

Format: one section per version, with the groups Added, Changed, Fixed and
Security. "Not released" means it has not been deployed anywhere.

## [Unreleased]

Things planned but not done yet: the first Vercel deployment, real email
through Resend, usability sessions with real users.

### Fixed (2026-11-19, review of events parity and the Layout tab)

- Every event write reads the event's room again once it holds the event lock (`lock_event` reloads
  `venue_id`); assigning, holding and confirming look the seat up after the lock. A request that had
  loaded the event before a room setup committed could put a guest on a seat of the old room.
- Room setups: the confirm step (409 `guests_seated`) adds `accessible_needed`, `accessible_seats` and
  `holding` to `details`; the message and the dialog say how many guests who need a step-free seat at
  least will lose theirs, and that people choosing a seat right now will choose again. Previews mark
  step-free seats. Applying the setup already in use is a 409 `conflict` (nothing moves, nobody is
  emailed); a re-seat emails nobody whose table, number and place stay the same.
- Every Sign out (the `/my` bar, `/restaurants/account`, the owner menu) forgets both sessions of the
  tab, as `/account` does.
- A table booked while signed in, under the account's own address, shows under Booking at once
  (`POST /api/r/{vid}/bookings` reads the guest session; otherwise it books anonymously as before).
- An event venue's owner has a Team link under Staff; `/owner/:id/team` names the venue and drops the
  restaurant steps and words there. Staff who own no restaurant see "Open your own restaurant".
  `/demo` has the public header (Log in to `/account`, Plan an event).

### Security (2026-11-19, review of events parity and the Layout tab)

- `POST /api/events/{eid}/layout` is rate limited to 20 a minute per person (each apply can re-seat
  and email every seated guest).

### Added (2026-11-18, events parity)

- One account: `POST /api/account/register` signs up without an event; the emailed code then makes the
  booking identity (guest account) and the work identity (organiser) with the same address and
  password. `POST /api/account/login` opens both with one password; `GET /api/account/work` lists the
  restaurants, event venues and events the person runs, with their role.
- Venue teams: an owner adds staff to a restaurant or an event venue by email
  (`/api/owner/venues/{vid}/members`). A member works there like staff (restaurant floor, the events at
  an event venue) and nowhere else; owner pages stay with the owner.
- Public events: `GET /api/event-types`, `/api/public-events`, `/api/event-venues` and
  `/api/event-venues/{slug}`. Only listed events with the link on, upcoming, at published event venues
  appear. Events have an optional `event_type`; event venues a `venue_type` (`hall`, `quinta`).
- Demo: six invented event venues (three halls, three quintas) with drawn pictures and ten listed
  events covering every type; links `event_booking`, `event_staff` and four `showcase_venue_<slug>`;
  Rita Rossi (`rita@example.com`, `DEMO_MEMBER_PASSWORD`), staff at Casa Lumen and Quinta da Serra Azul,
  booking at Tagus Terrace and the Lisbon Product Conference.

- Event room layouts: `GET /api/events/{eid}/layouts` lists seven one-click setups (banquet, cabaret,
  theatre, classroom, U-shape, boardroom, cocktail) fitted to the hall, each with a preview and its
  capacity; `POST /api/events/{eid}/layout` puts the event on its own private copy of the hall laid out
  that way, re-seating seated guests (with `confirm`) and emailing whoever moved. Fine-tuning that copy
  in `/editor/<id>` is open to the event's organiser and the hall's team. The ten listed demo events
  each run on their own setup. New column `venues.parent_venue_id` (additive).
- Layout tab in the organiser workspace (`/organiser/:eventId`, second tab): a card per setup with a
  drawn thumbnail, its seats against the guests coming, preview on the map, Apply, a confirm dialog
  with the counts when guests are seated or seats run short, the re-seated and unseated counts after,
  and "Fine-tune in the editor" once the event has its own copy.

### Changed (2026-11-18, events parity)

- An error answer may carry `error.details` (today only the layout errors); without details the
  body is unchanged.

- `GET /api/events` and every event answer add `event_type`, `event_type_label`, `listed` and
  `venue_name`; the list adds `role` and includes the events at venues where the person is a member.
- `POST /api/guest/verify` answers `join.status = "account_only"` and `work` for an account-page sign-up.
- The demo seed needs `DEMO_MEMBER_PASSWORD` on Postgres, like the two other demo passwords.

### Security (2026-11-18, events parity)

- The demo never shows a sign-up code on screen for an address on a venue team.
- A member cannot edit the floor plan, create events, or open owner, photo, payment, publishing or team
  routes; removing the address ends access at once. Tests: `test_venue_members.py`, `test_one_account.py`,
  `test_public_events.py`.

### Added (2026-11-18)

- Deposits for restaurant bookings. The owner sets, per service, a deposit per person and a free-cancellation
  window; a diner accepts the terms, the booking waits as `pending` (it keeps its table) until the deposit is
  paid, and is then confirmed. Cancelling in time refunds it; after the deadline the restaurant keeps it; the
  restaurant cancelling always refunds. The default provider is a demo one (a clearly labelled pretend payment
  page, no money moves); Stripe is wired in behind `PAYMENT_PROVIDER=stripe` and only needs its keys
  (`backend/app/payments/READ_ME_FIRST.md`). Hosted Checkout only, so no card data reaches SeatPlan and the
  Content-Security-Policy is unchanged; webhooks are signature-checked, deduplicated and re-read from Stripe.
- Staff see each booking's deposit on the floor. New owner page "Deposits".

### Added (2026-11-10 to 11)

- Shared event link: one link per event (`/j/<token>`), switched on and off,
  copied and replaced from the organiser's Settings tab, with an optional cap
  ("guest accounts", D1 to D7).
- Visitors: anyone with the link sees the event and the live map, names
  filtered as for attendees, and cannot hold or confirm a seat.
- Guest accounts: sign-up checked by an emailed 6-digit code, sign-in and
  sign-out, forgotten password, "My events", the attendee steps under
  `/my/<event>`, and deleting the account (GDPR) ("guest accounts").
- Seat emails for account holders with a picture of the room drawn on the
  server (PNG inline with a content id, alt text, `.ics`), with no new
  dependency ("guest accounts", D5 and section 9).
- `python -m app.seed.migrate` now also adds the listed new columns and
  indexes to an existing database, safely and repeatably, tested from the
  old schema on SQLite and Postgres ("guest accounts", migration).
- Playwright: `guest-account.spec.ts` (7 steps), a phone sign-up and three
  more axe scans.

### Security (2026-11-10 to 11)

- Fixed S30 to S40 from the reviews of guest accounts: demo codes only for
  uninvited `@example.com` addresses, a sign-up id that ties the code to the
  browser, constant-time sign-up, limits that strangers cannot use up, no
  typed name in code emails, removed guests cannot rejoin, no id reuse on
  SQLite, no join after "Make a new link", fairer limits for one Wi-Fi and for
  failed logins, and code tries counted before the compare. S41 is open and
  accepted (`security.md`, section 9).

### Fixed (2026-11-10 to 11)

- Saying "no" and then "yes" again could make more guests than seats; places
  left counted seats reserved for a tag; a full event refused invited
  guests' sign-ups; an applied plan sent no email to account holders; tall
  rooms' pictures were stretched; several texts ("1 places left", the
  privacy text, the delete dialog) said more than was true ("guest
  accounts", review fixes).

## [0.1.0] - 2026-11-10 (not released: no deployment has been done)

### Added

- Shared core: FastAPI app factory, settings from environment variables,
  SQLAlchemy models for both verticals, scrypt passwords, signed sessions,
  database-backed rate limits ("backend foundation").
- Five-minute seat and table holds guarded by a UNIQUE constraint;
  `commit_or_seat_taken` turns a clash on the final insert into 409
  `seat_taken` ("backend foundation", item 8).
- Privacy mode `first_initial` shows first name plus last initial
  ("backend foundation", item 9).
- Events optimiser: greedy, simulated annealing, re-plan with a change
  penalty, recommendations and an exact solver (CP-SAT or branch and bound)
  ("events optimiser").
- Events API: guests, raw-CSV import (all rows or none, 200 KB and 1000
  rows), export, organiser moves, auto-fill, re-plan, scenarios, what-if, undo
  and redo, exact check, and the attendee endpoints including
  `GET /a/{token}/people` ("events vertical API").
- Restaurants API in the new `restaurant_service/` package: slots, map, holds
  (one row per table per 15-minute slot), bookings, manage-or-cancel links,
  waitlist with offers, staff floor, walk-ins, what-if, dashboard, schedule
  ("restaurants vertical API").
- Frontend: React and Vite app, hand-drawn SVG seat map with pan, zoom and
  keyboard, attendee and organiser screens, diner and staff screens, a
  floor-plan editor ("frontend foundation and seat map", "events screens",
  "restaurant screens").
- Email outbox with an idempotency key per email, a `sending` claim with a
  10-minute lease, retries, an allowlist, console and Resend providers, and a
  GitHub Actions cron every 15 minutes ("email system").
- Calendar invites on confirmation, change and cancellation emails, built by
  `mail/invites.py` ("integration", item 1).
- Event reminders, one per guest per event, kept in step with the seat
  (platform fixes, item 13; events fixes, item 12).
- Staff optimiser endpoints `POST /staff/{vid}/optimise/service` and
  `/optimise/exact-check` (events and restaurants fixes, item 7).
- `DELETE /r/{vid}/hold/{hold_id}` to give a held table back (events and
  restaurants fixes, item 5).
- Table `demo_links` for the demo entry links (platform fixes, item 4).
- Command `python -m app.seed.migrate` to create tables on Postgres
  (platform fixes, item 5).
- Opt-in Postgres test run with `SEATPLAN_TEST_POSTGRES` (events and
  restaurants fixes, item 16).
- CI runs `ruff format --check .` (platform fixes, item 15).

### Changed

- The backend is imported as `app` and run from `backend/`; the seed command
  is `cd backend && python -m app.seed.run` ("backend foundation", item 1;
  "integration", item 13).
- Recommendations return `rank` and `match`, never a raw score, and rank with
  the guest's own "knows" list only (events optimiser item 5, superseded by
  the events and restaurants fixes, item 1).
- Events exact check also returns `heuristic_seated`, `exact_seated` and a
  `note`; `gap_percent` is null when the two plans seat a different number of
  guests (events and restaurants fixes, item 2).
- Safety cut-off for both optimisers lowered to 15 s, under Vercel's 30 s
  `maxDuration` (events and restaurants fixes, item 3).
- Emails use the real templates in `mail/templates.py`; the temporary helpers
  are gone ("integration", item 1).
- The waitlist offer email no longer promises a hold ("integration", item 4).
- `max_party` is per venue and returned on `GET /r/{vid}` and `GET /b/{token}`
  (events and restaurants fixes, item 6).
- Staff what-if and walk-ins take an optional `date`; the dashboard adds
  covers seated (events and restaurants fixes, item 8).
- Error codes `method_not_allowed` (405) and `internal` (500) added to the
  contract; 400 and 413 map to `validation` (platform fixes, item 9).
- Contract wording on real time: the browser uses the stream first and polls
  only when it fails (events and restaurants fixes, item 15).
- Contract corrected: there is no Playwright suite and no `report/` folder
  (platform fixes, item 14). Reversed later the same day: see the next line.
- Browser tests with Playwright and axe-core in `frontend/e2e/`, run by
  `npm run e2e` and a new `e2e` job in CI ("documentation and verification",
  item 2).
- The documentation set in `docs/` and a documentation index in the README
  ("documentation and verification", item 7).

### Fixed

- Two cold starts on Postgres raced on `CREATE TABLE`; the app no longer
  creates tables there (platform fixes, item 5).
- Two scenario saves at once could get the same number: UNIQUE(event_id, seq)
  on `plan_snapshots`, and saves take the event lock first (platform fixes,
  item 6; events and restaurants fixes, item 11).
- A Postgres deadlock or serialization failure on any route now answers 409
  `conflict` "please try again" instead of 500; every write on an event takes
  the event lock first (events and restaurants fixes, item 4).
- Pooled Postgres URLs with options such as `pgbouncer=` failed to connect;
  unknown options are now dropped (platform fixes, item 7).
- Control characters (such as NUL) in free text gave a 500 on Postgres; they
  are now a 422 (events and restaurants fixes, item 9).
- A random test failure when slow logins crossed a minute boundary; the test
  now freezes the clock (platform fixes, item 10).
- On a phone, tapping a table panned the map so the tap missed (events and
  restaurants fixes, item 14).
- Staff heard their own actions read back as someone else's (events and
  restaurants fixes, item 13).
- What-if refusal is a 409, not a 500 ("integration", item 9).
- Frontend and backend restaurant shapes did not match; all conversions now
  live in `frontend/src/api/restaurant.ts` ("integration", item 5).
- An unknown venue time zone or a date such as 9999-12-31 gave a 500; both
  are now a 422 ("documentation and verification", item 1).
- Accessibility: the recommended-seat halo stops after two breaths, focus is
  kept clear of the sticky header and hold bars, and event dates are in
  British English ("documentation and verification", item 6).

### Security

- Demo reset needs the `X-Demo-Key` header; the organiser-session path was
  removed, because the demo password is public (platform fixes, item 1).
- No public demo passwords on Postgres (platform fixes, item 2).
- `SECRET_KEY` is required on Postgres, demo mode or not (platform fixes,
  item 3).
- Raw demo tokens moved out of the audit log (platform fixes, item 4).
- On Vercel a missing `DATABASE_URL` stops the app instead of falling back to
  SQLite (platform fixes, item 7).
- Live stream refused past 30 opens a minute per address or 50 open streams
  per instance (platform fixes, item 8).
- Restaurant holds capped at 3 per client per venue and date, and never more
  than half the tables of a slot (events and restaurants fixes, item 5).
- Security headers on the static frontend in `vercel.json`: CSP, no framing,
  `no-referrer`, `nosniff` (platform fixes, item 12).
- `tzdata` added so time zones do not depend on the host (platform fixes,
  item 11).
- The email processing endpoint is rate limited before the secret check, and
  an empty `CRON_SECRET` rejects every call ("email system", item 4).
- `X-Forwarded-For` is trusted only on Vercel; on Postgres a `SECRET_KEY`
  shorter than 32 characters stops the app; `rate_limits` stores a keyed hash
  instead of the IP address; the console email provider masks addresses;
  `Strict-Transport-Security` in `vercel.json` ("documentation and
  verification", item 1; details in [`security.md`](security.md)).
- Booking caps (S8): at most 4 upcoming diner bookings per mailbox and
  restaurant, and 10 booking attempts per client address (IPv6: per /64) and
  restaurant per UTC day; both answer 429 `rate_limited` ("booking caps and
  outbox links", items 1 and 2).
- Personal links leave the email outbox (S9): a finished row has every
  `/b/`, `/e/` and `/a/` link replaced, cancelled reminders are blanked, and
  finished rows are emptied after 30 days ("booking caps and outbox links",
  items 3 and 4).
