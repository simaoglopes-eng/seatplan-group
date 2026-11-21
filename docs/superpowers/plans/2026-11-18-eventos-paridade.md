# Events parity, one account, venue sample (plan, 2026-11-18)

Owner: Simão. Branch: `simao/eventos-paridade` (from `origin/martim/restaurantes-ux` at 7282ef3).

**Override:** for this branch the owner explicitly asked to change the events side. The
event-path ban in `AGENTS.md` and `scripts/check_forbidden_paths.py` does not apply here.

All user-facing text is in English.

## Decisions taken with the owner

1. `/demo` Events card mirrors the Restaurant card: **Event booking**, **Event staff**, plus
   4 showcase venues (2 halls, 2 quintas), each with a public page. The 10 old event demo
   links stay in the backend (tests use them) and are hidden on the card by an explicit
   allow-list. The Restaurant card keeps its 6 links.
2. **Event booking** = a member of the public picks an event type (wedding, conference,
   birthday, gala dinner, corporate dinner, christening), sees upcoming events of that type at
   the sample halls and quintas, opens one and chooses a seat (existing `/j/<token>` flow:
   create or sign in to an account, then hold 5 minutes and confirm). An account is required to
   hold a seat (unlike restaurants, where booking needs no account).
3. **Event staff** = pick an event type, then an event you run, and open the organiser
   workspace (`/organiser/<id>`): guests, optimiser, share link, print.
4. Venue sample is **invented but realistic** (no licences): restaurants (existing), event
   halls and quintas, with drawn pictures.
5. **One account**: one sign-up creates the personal identity (bookings) and the work identity
   (staff). An owner grants staff access to a venue by email. One login can then be staff at
   venue A and book at venue B. The user panel `/account` has a Booking | Staff switch.

## Data (additive only, `seed/migrate.py`)

- `events.event_type VARCHAR(20)` NULL. Keys: `wedding, conference, birthday, gala_dinner,
  corporate_dinner, christening`.
- `events.listed BOOLEAN NOT NULL DEFAULT FALSE`. Only listed events appear publicly. A
  share-enabled but unlisted event never appears (test).
- `venues.venue_type VARCHAR(20)` NULL: `hall` or `quinta` for event venues. `kind` keeps its
  two values.
- New table `venue_members` (id, venue_id FK cascade, email lower-case, role `staff`,
  added_by organiser id, created_at, UNIQUE(venue_id, email)). Matched by the organiser's
  email, which is proven at sign-up.

## API contract

Accounts
- `POST /api/account/register {name,email,password,consent:true}` -> 202 like
  `/j/{token}/register` (`sent`, `signup_id`, `code` only when `may_show_code`). Pending row:
  `EmailCode(purpose="register", event_id=NULL)`.
- `POST /api/guest/verify` (existing) on a sign-up with no event also creates the
  `Organiser` (same email, name, password hash, role `organiser`) when none exists, and then
  returns `work: {token, user}` next to the guest session.
- `POST /api/account/login {email,password}` -> `{guest?: {token, account}, work?: {token,
  user}}`; 401 when neither matches. Token kinds stay separate. Existing rate limits and the
  guest failed-login caps apply.
- `GET /api/account/work` (work token, any role) -> restaurants, event venues and events the
  person can run, each with `role` (`owner`/`staff`/`organiser`).
- `GET|POST|DELETE /api/owner/venues/{vid}/members` (owner only) `{email}`.
- Access checks accept a member: `venue_access.load_for_staff`, `events_service/access.load_event`,
  `routers/venues.load_venue`. Owner-only routes stay owner-only. Demo `staff` role unchanged.

Events, public
- `GET /api/event-types` -> `[{key,label}]`.
- `GET /api/public-events?type=&venue=&limit=&offset=` -> upcoming listed events at published
  event venues with a slug: public_id, name, event_type(+label), starts_at, ends_at, venue
  {name, slug, venue_type, address, cover_url}, places_left, join_path.
- `GET /api/event-venues?type=hall|quinta`, `GET /api/event-venues/{slug}` (profile, photos,
  capacity, event types, upcoming listed events).
- Photos are served for published event venues too.
- `GET /api/events` and `event_dict` add `event_type`, `venue_name`; members also see the
  events at their venues.

Demo links added (old ones kept): `event_booking` -> `/events`, `event_staff` ->
`/events/staff`, `showcase_venue_<slug>` x4 -> `/venues/<slug>`.

## Frontend

- `/events` Event booking, `/venues/:slug` venue page, `/events/staff` Event staff,
  `/account` unified panel (sign in, create account, Booking | Staff), `/owner/:venueId/team`.
- `/demo` Events card allow-list; public header links to `/account` and `/events`.

## Acceptance (Playwright + Chrome)

One `@example.com` account signs up, is granted staff at restaurant A by its owner, runs A's
floor, books a table at B and sees it in Booking; joins a listed event as a guest and picks a
seat; is granted staff at an event venue and opens that event's organiser workspace from
Event staff. Real email addresses need a mail provider: the on-screen code stays demo-only
and `@example.com`-only.

## Out of scope (declared)

Clients booking a whole venue; event deposits; event reviews; real venue data.

## Later decisions (Simão, 2026-11-18)

- `/demo` cards start with few options: Restaurant = Restaurant booking, Restaurant staff and a
  small "Browse restaurants" link (to `/`). Events = Event booking, Event staff and a small
  "Browse halls and quintas" link (to `/venues`). All other demo links leave the cards.
- Event room layouts: a Layout tab for event staff with one-click setups (Banquet, Cabaret,
  Theatre, Classroom, U-shape, Boardroom, Cocktail), preview and capacity fitted to the hall or
  quinta, then fine-tune in the editor. Each event gets its own copy of the layout (a private
  child venue), so changing one event never changes another at the same venue. If guests are
  seated: warn with the count, apply only on confirm, re-seat with the optimiser (groups kept)
  and queue the existing seat-change email. Restaurants keep their room editor unchanged.
- Glass style: on a separate branch (`simao/glass`), variants to be chosen by Simão.
- Nothing is pushed to GitHub until Simão says so.
