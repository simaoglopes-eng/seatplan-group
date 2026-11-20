# API guide

## Events parity: one account, venue team, public events (2026-11-18)

All paths have the `/api` prefix. Errors keep the usual `{"error": {"code", "message"}}`.
"Work session" is the organiser token (`<id>.<expiry>.<sig>`, from `/auth/login`, `/owner/verify`
or the routes below); "guest session" is the `g.<id>.<version>.<expiry>.<sig>` token. Neither ever
opens the other's routes (401).

**One account.**

- `POST /account/register` `{name, email, password, consent: true}` (unknown fields 422, password at
  least 10 characters and not the email) -> **202** `{status: "code_sent", sent_to, expires_in_seconds,
  signup_id, demo_code?}`, the same shape as `/j/{token}/register`. `demo_code` only under
  `may_show_code` (demo, console email, `@example.com`, not invited anywhere, not a venue member).
  An address that already has a guest account gets the same answer (and an email saying so).
  Limits: the guest code-send limits (429 `rate_limited`).
- `POST /guest/verify` (unchanged body `{email, code, signup_id}`) -> **201** `{token, account, join,
  work?}`. For a sign-up started by `/account/register`, `join` is `{status: "account_only",
  event_id: null}`, and `work: {token, user: {email, name, role: "organiser"}}` is present only when
  this verify created the work account (same email, name and password). When the address already had
  a work account it is left untouched and `work` is absent: sign in with `/account/login`.
- `POST /account/login` `{email, password}` -> **200** `{guest?: {token, account: {name, email,
  created_at}}, work?: {token, user: {email, name, role}}}`, only the identities this password opens.
  Neither: **401** `unauthorised` "Email or password is not correct.". Limits: the work login's and the
  guest login's per-address limits (10 a minute each), and the guest failed-login caps, checked before
  any password (**429** `rate_limited`). A guest account from before one sign-up (no work account
  with that address) whose address is proven and is on a venue's team gets its work account here, with
  the same name and password, and the answer then carries `work` too. Without a team, such an
  account still signs in with `guest` only.
- One password. A new password (`POST /guest/password/reset`) also becomes the password of the work
  account with the same address and ends every older work session (401 on the next call). Deleting
  the account (`POST /guest/me/delete`, answer unchanged `{deleted: true}`) also deletes the work
  account with that address when it runs nothing (no venue, no event, no team member added) and the
  guest account proved its address or has the very same password hash (its own sign-up); one that
  runs something stays, with its password, and the venue teams that list the address stay too.
- Work session tokens keep their shape `<id>.<expiry>.<sig>`; the signature now also covers the
  account's session version, so tokens made before this change still work until the first new
  password.
- `GET /account/work` (work session, any role) -> `{user: {email, name, role}, restaurants: [{public_id,
  name, slug, status, role}], event_venues: [{public_id, name, slug, status, role, venue_type}],
  events: [{public_id, name, starts_at, ends_at, event_type, event_type_label, listed,
  venue_public_id, venue_name, role}]}`. Venue `role` is `owner` or `staff`; event `role` is
  `organiser` (their own) or `staff` (at a member venue). Owner rows first, then by id; events:
  their own first, then those at member venues, each part by start. A `staff`-role account (the demo staff) sees every demo restaurant as `staff` and no events.

**Venue team (owner only).** `vid` is a restaurant's or an event venue's `public_id`; anyone but its
owner (work session, role organiser) gets **404** `not_found`, as for a missing venue.

- `GET /owner/venues/{vid}/members` -> `{items: [{id, email, role: "staff", created_at}]}` (oldest first).
- `POST /owner/venues/{vid}/members` `{email}` -> **201** `{id, email, role, created_at}`. The address
  is trimmed and lower-cased; adding it again returns the same row; your own address is **422**; at most
  50 per venue (**422**). The answer never says whether an account exists for the address.
- `DELETE /owner/venues/{vid}/members/{member_id}` -> `{removed: true}`, or **404** when that id is not on
  this venue's list. Access ends at once.

A member (signed in with a work account whose email is on the list) passes the same checks as staff:
`/staff/{vid}/...` for a restaurant, every `/events/{eid}/...` route for the events at an event venue
(organiser role), and `GET /venues/{vid}`. Still owner-only: owner profile, photos, rooms, payments,
publishing, the team list, `PUT /venues/{vid}/layout` (except on an event's setup copy, below) and
`POST /events` (creating events).
`GET /events` lists the organiser's events then those at member venues (each part by start); each row now also has
`event_type`, `event_type_label`, `listed`, `venue_name` and, in the list only, `role`.

**Event room layouts (work session, organiser role: the event's organiser or its hall's team).**
Each event can run on its own private copy of its hall or quinta (a "setup" venue: `kind` `event`,
`status` `draft`, no slug, `parent_venue_id` = the hall), so changing one event never changes
another at the same hall. Names, public pages, photos, emails and the venue team stay the hall's:
`venue_name` everywhere, `/public-events`, `/event-venues`, `/account/work`, `/guest/me` events,
`/j/{token}` and the attendee page show the parent. The copy is never listed (`GET /venues`,
`/account/work`), is no venue for `POST /events` (404) and has no team of its own
(`/owner/venues/{vid}/members` is 404). Events without a setup keep using the hall's own plan.

- `GET /events/{eid}/layouts` -> `{current, own_layout, venue_id, capacity, guests, seated, presets}`.
  `current` is the preset key the event's copy still matches by geometry (a save in the editor that
  moves nothing keeps it), else `"custom"` (always `"custom"` on the hall's own plan, `own_layout:
  false`). `venue_id` is the public id of the venue holding the event's map: open it in the editor.
  `capacity` counts its seats that are not blocked; `guests` the guests still coming; `seated` those
  with a seat. `presets` is `[{key, label, description, capacity, preview}]` in this order: `banquet`
  Banquet, `cabaret` Cabaret, `theatre` Theatre, `classroom` Classroom, `u_shape` U-shape, `boardroom`
  Boardroom, `cocktail` Cocktail, each fitted to the hall's width and height (cm, front at the top).
  `preview = {width, height, zones: [{kind, x, y, w, h}], tables: [{shape, x, y, w, h, rotation,
  seats: [{x, y, accessible?: true}]}]}` (only a step-free seat carries `accessible`), whole centimetres, enough for an SVG thumbnail (`x, y` the top-left of the
  unrotated box, `rotation` in degrees around its centre, as in the editor).
- `POST /events/{eid}/layout` `{preset, confirm?: false}` (unknown preset or field 422; **429**
  `rate_limited` past 20 a minute per person, each one can re-seat and email everyone). Checks, in this
  order, after taking the event lock and before writing anything:
  - **409** `conflict` "The Banquet setup is already in use. Nothing changed." when the event's room
    still is that setup (`current`): re-applying would only move everyone to identical seats;
  - **422** `too_small` when the room fits none of that setup;
  - **409** `guests_seated` when anyone has a seat and `confirm` is not true, with
    `error.details = {seated, capacity, guests, accessible_needed, accessible_seats, holding}` (the new
    setup's capacity; seated guests who need a step-free seat and the setup's step-free seats, a hard
    rule for the re-seat, so when the first is larger at least the difference lose their seat and the
    message says so; people holding a seat right now, whose holds are dropped);
  - **422** `not_enough_seats` when the setup has fewer seats than guests coming and `confirm` is not
    true, with the same `details`.
  Then, under the event lock: a new copy of the hall with the preset; every seated guest is re-seated
  on it by the optimiser (auto-fill's search: groups and acquaintances kept), anyone who cannot fit
  loses their seat; holds on the old seats are dropped; each guest whose seat changed gets the usual
  "seat changed" email (and its reminder moves; no email when the new seat has the old one's table,
  number and place), those who lost their seat the "seat cancelled" one;
  old scenarios and undo steps are retired (they name seats that no longer exist) and history starts
  again ("Room set up as Banquet"); the live scope is bumped and `event.layout` audited. A previous
  copy is removed and the new one takes over its public id, so the editor link stays. Re-seated
  guests who had chosen or been placed become `organiser` placements (auto-fill never moves them),
  the rest `optimiser`. Answer **200**: the `GET` body plus `{applied, reseated, unseated}`.
- Fine-tune: `GET /venues/{vid}` and `PUT /venues/{vid}/layout` on a setup copy are open to its
  owner, a member of the parent's team and the organiser of the event on it (others 404; the demo
  `staff` role 404 on read, 403 on write). On every other venue the editor stays owner-only. A save
  on a copy bumps the event's live scope.

**Public events (anyone, one read limit per address).**

- `GET /event-types` -> `[{key, label}]`: `wedding` Wedding, `conference` Conference, `birthday`
  Birthday, `gala_dinner` Gala dinner, `corporate_dinner` Corporate dinner, `christening` Christening.
- `GET /public-events?type=&venue=&limit=&offset=` (`type` one of the keys, else 422; `venue` a venue
  slug; `limit` 1 to 50, default 20) -> `{items: [PublicEvent], total}`, soonest first.
  `PublicEvent = {public_id, name, event_type, event_type_label, starts_at, ends_at, venue: {name, slug,
  venue_type, address, cover_url}, places_left, join_path}`; `join_path` is `/j/<token>`, the existing
  visitor flow (`GET /j/{token}`, then register or sign in and join).
- `GET /event-venues?type=hall|quinta` -> `{items: [{slug, name, venue_type, venue_type_label,
  description, address, lat, lng, cover_url, cover_alt, capacity, event_types: [key], upcoming_count}]}`
  by name.
- `GET /event-venues/{slug}` -> `{slug, name, venue_type, venue_type_label, description, address, lat,
  lng, phone, website, instagram, maps_url, timezone, photos: [{url, alt, is_cover}], capacity, tables,
  event_types: [{key, label}], upcoming: [PublicEvent]}`; **404** for anything not public.

An event is public only when it is `listed`, its shared link is on, it starts in the future, and its
venue is an event venue that is published and has a slug. A shared but unlisted event never appears.
`capacity` counts seats that are not blocked. `GET /photos/{id}` now also serves the pictures of a
published event venue with a slug. There is no route yet to set `listed` or `venue_type` (`PATCH
/events/{eid}` with `listed` is a 422), and event venue slugs also come only from the seed: today the
public pages show demo data only.

Known demo risks (only with `DEMO_MODE=1`, the console email provider and `@example.com` addresses;
never in production, where codes are only emailed):
- `demo_code` is present for a new address and absent for one that has an account, was invited or is
  on a venue team, so the answer tells whether an `@example.com` address is known. The same was
  already true of `/j/{token}/register` and `/owner/register`.
- A work account made with a code shown on screen proved no inbox, and membership matches the address
  only. So whoever first signs up `x@example.com` in the demo works at every demo venue whose owner
  adds `x@example.com`. Kept on purpose: in the demo no inbox can ever be proven, so requiring a
  proven address would switch the venue team off for everyone but the seeded Rita, including the
  acceptance path (sign up first, then be added).

## Finding restaurants and the public page

`GET /api/restaurants` is public (same read limit as the booking page). Query: `q` (name or cuisine, accents and capitals
ignored), repeatable `cuisine`, `price` (1 to 4) and `features` (`sun`, `view`, `accessible`, `terrace`, all required), `lat` and `lng`
(together; nearest first with `distance_m`), `date`, `time` and `party` (together; each card then has `next_times`, and
`available=true` keeps only restaurants with a free table within an hour), `limit` (1 to 50) and `offset`. The answer is
`{items, total}`. `GET /api/restaurants/{slug}` is the public page; a draft is a 404 for everyone but its own owner, who gets
`preview: true`. `GET /api/r/{id}/map` now also carries `rooms` and, per table, `ambience`; `GET /api/r/{id}/ambience` gives the light
at a moment; `GET /api/r/{id}/seats` lists the chairs of held tables; `PATCH /api/b/{token}` takes `seat_id`. The owner routes
`PUT /api/owner/restaurants/{vid}/rooms`, `.../ambience-preview`, `.../publish-check`, `.../publish` and `.../unpublish` are in
`CONTRACT.md` section 10.

## Restaurant owner accounts

POST /api/owner/register accepts name, email, password and consent=true.
It returns 202 with signup_id, and code_shown only in approved local demo
conditions. Existing accounts receive the same response shape. POST
/api/owner/verify accepts email, six-digit code and signup_id and returns 201
with token and user. Codes expire after 15 minutes, allow five attempts and
can be consumed once. The session works with the existing /api/auth endpoints.
Bodies reject unknown fields. Staff access to restaurant endpoints and
the shared /api/venues endpoints is restricted to is_demo restaurants.

GET /api/owner/restaurants requires an organiser session and lists only that
owner's restaurants, with public_id, slug, name, status, cover_url and
setup containing done, total and missing step codes.

The full, exact list of endpoints and request and answer shapes is
[`openapi.json`](openapi.json). This page is the short version a person can
read. The design agreement is section 5 of [`CONTRACT.md`](CONTRACT.md).

## Where the OpenAPI file comes from

`docs/openapi.json` is exported from the real FastAPI app, not written by
hand. It was last made on 2026-11-13 (after the ambience, discovery and email work) with this command (run from `backend/`; the
temporary SQLite file goes in `$TMPDIR` so nothing is left in the repository):
hand. Last export: 2026-11-13, including the restaurant owner/room/ambience APIs.
Run from the repository root; the script uses and removes a temporary SQLite
database and does not touch the local application database:

```powershell
.\.venv\Scripts\python.exe scripts/export_openapi.py
```

What the last run (2026-11-18, after the event room layouts) reported: OpenAPI `3.1.0`, title
`SeatPlan API`, version `0.1.0`, **123 paths, 144 operations, 72 schemas**. Run the command again after
changing any router, so the file never drifts from the code.

## Restaurant platform API implemented on this branch

All paths below have the `/api` prefix. Owner routes require an organiser's
Bearer session and return the same 404 for missing and foreign restaurants.

| Path | Behaviour |
|---|---|
| `POST /owner/restaurants` | Owned draft, unique ASCII slug; profile GET/PATCH at `/owner/restaurants/{vid}/profile` |
| `/owner/restaurants/{vid}/photos` | Private gallery metadata/upload, order/cover/alt/delete; draft bytes require owner auth at `/photos/{photo_id}` |
| `GET/PUT /owner/restaurants/{vid}/rooms` | Whole nested layout, optimistic `base_version`, IDs preserved, atomic save; answer adds `version`, `status`, `problems` |
| `GET /owner/restaurants/{vid}/ambience-preview` | Saved-draft preview, date/time/party and optional cursor moment |
| `GET /owner/restaurants/{vid}/publish-check` | Required problems and recommended photo tip, with fix URLs |
| `POST /owner/restaurants/{vid}/publish` and `/unpublish` | Server validation, or draft; existing booking links survive |
| `GET/PUT /staff/{vid}/schedule` | Owner edits opening hours through the existing schedule API; staff limited to demo restaurants |
| `GET /r/{vid}/map` and `/ambience` | Published restaurants only; additive rooms/light/phrases; map/hold accept optional wishes |
| `GET /r/{vid}/seats?table_ids=…` | Usable chairs and facing phrases, at most three tables from this venue |
| `POST /r/{vid}/bookings` | Optional `prefs` and indicative `seat_id`; choice validated before consuming the table hold. With a valid guest session (`Authorization: Bearer` guest token) and the account's own address as `email`, the booking belongs to that account at once (`account_id`, listed by `GET /diner/bookings`); any other token or none books anonymously, never 401 |

Room writes reject malformed clocks, unknown sides, opening overlap/out-of-wall
spans, partial glass walls and unknown/duplicate view tags with 422. Foreign
object IDs return 404. A stale version returns 409 `stale_layout`; a protected
table deletion returns 409 with `error.tables: [{id,label}]`. Geometric draft
errors remain saveable, including the 4–5000 m² area rule, and prevent publication.
Counterclockwise outlines are reversed with opening side/offset remapping.
Combine groups are scoped by room in the service adapter.

For explicitly published venues, an invalid room/profile/schedule edit saves
atomically as draft and closes new diner requests; existing management links
remain usable. Legacy venues defaulted to published before these fields existed
and retain that compatibility path until first explicit publication. A slug is
fixed after first publication, including after unpublish. A one-table restaurant
can hold its only table; larger venues retain the half-of-tables hold cap.

**Still absent:** discovery `/restaurants`, public profile by slug, management
`Change seat`, and the new restaurant email picture/profile integration. The
publish answer reserves `/restaurants/{slug}`, but the frontend page is not yet
implemented. Use the existing `/r/{public_id}` booking route for the working
journey. See [final review and acceptance matrix](restaurant-final-review.md).

While the backend is running you can also read it live:

- <http://127.0.0.1:8000/api/docs> (Swagger UI, try requests in the browser)
- <http://127.0.0.1:8000/api/openapi.json> (the same JSON)

## Basics

- **Base path:** every endpoint starts with `/api`.
- **Format:** JSON in and out. Two exceptions: the guest CSV import takes the
  raw CSV as the body (`Content-Type: text/csv`), and `export.csv` returns CSV.
  The live stream returns `text/event-stream`.
- **Unknown fields are refused.** Every body is a Pydantic model with length
  limits, so a typo in a field name gives 422 `validation`.
- **Ids in URLs** are random public ids or secret tokens, never the integer
  database id. Scenario ids are the per-event number `seq`.
- **Times:** stored in UTC. Restaurant dates are `YYYY-MM-DD` and times
  `HH:MM` in the venue's own time zone.

## Who may call what

| Kind of caller | How they prove it | Endpoints |
|---|---|---|
| Anyone | Nothing (rate limited) | `/health`, `/r/{vid}/...` (diner), `/live/...`, `/demo/links` (only when `DEMO_MODE=1`) |
| Attendee | Secret token in the URL | `/a/{token}/...` |
| Visitor with the shared link | The event's shared token in the URL (read-only, one token for everyone) | `/j/{token}`, `/j/{token}/register` |
| Guest account holder | `Authorization: Bearer <guest session>` from `/guest/verify`, `/guest/login` or `/guest/password/reset` (5-part token starting `g.`, never accepted as an organiser session) | `/j/{token}/join`, `/guest/logout`, `/guest/me`, `/guest/me/delete`, `/guest/events/{eid}/...` |
| Diner with a booking | Secret manage token in the URL | `/b/{manage_token}` |
| Organiser or staff | `Authorization: Bearer <session>` from `POST /auth/login` | `/venues`, `/events/...`, `/staff/...`, `/emails/log`, `/auth/me` |
| The email cron | Header `X-Cron-Secret` equal to `CRON_SECRET` | `POST /internal/email/process` |
| Whoever resets the demo | Header `X-Demo-Key` equal to `DEMO_KEY` | `POST /demo/reset` |

A wrong token and a revoked token both answer 404, so a guesser learns
nothing. Sessions expire after 12 hours (`SESSION_HOURS` in `security.py`).

## Endpoint groups

Counted from `openapi.json` by tag:

| Tag | Operations | What it is for | Router file |
|---|---|---|---|
| `health` | 1 | Is the app and its database up? | `routers/health.py` |
| `auth` | 2 | Log in, who am I | `routers/auth.py` |
| `venues` | 4 | List, create, read venues; save a floor plan | `routers/venues.py` |
| `demo` | 2 | Demo links and demo reset | `routers/demo.py` |
| `events` | 26 | Organiser: guests, import and export, moves, auto-fill, re-plan, scenarios, what-if, undo and redo, exact check, and the shared link (read, switch and cap, make a new link) | `routers/events.py` |
| `attendee` | 9 | Personal link: page, people search, RSVP, "knows", privacy, recommendations, hold, confirm, release | `routers/attendee.py` |
| `visitor` | 3 | Shared link: the visitor's view, create an account (emails a code), join with an account | `routers/visitor.py` |
| `guest accounts` | 16 | Verify the code, sign in and out, forgotten password, my events, delete my account (`routers/guest_accounts.py`), and the account holder's event routes under `/guest/events/{eid}`, the same 9 as `attendee` (`routers/guest_events.py`) | `routers/guest_accounts.py`, `routers/guest_events.py` |
| `restaurants` | 8 | Diner: restaurant, slots, map, ambience, chairs, hold, give back a hold, book | `routers/restaurants.py` |
| `discovery` | 2 | Search restaurants, the public restaurant page | `routers/discovery.py` |
| `owners` | 10 | Owner sign-up, profile, publish and unpublish | `routers/owners.py` |
| `owner rooms` | 3 | The room layout and the light preview | `routers/owner_rooms.py` |
| `photos` | 6 | Owner gallery and public photo bytes | `routers/photos.py` |
| `bookings` | 4 | Manage or cancel a booking, join the waitlist | `routers/bookings.py` |
| `staff` | 10 | Floor, walk-ins, status, move, what-if, service optimiser, exact check, dashboard, schedule | `routers/staff.py` |
| `emails` | 2 | Process the outbox, read the email log | `routers/emails.py` |
| `live` | 2 | Version number and the live stream | `core/live.py` |
| **Total** | **110** | | |

## Errors

Every error has the same shape:

```json
{"error": {"code": "seat_taken", "message": "Seat B4 was just taken by someone else. ..."}}
```

An error may also carry `details` with facts the page needs (today only the
room setup errors above); without them the key is absent.

| Code | HTTP status | Usual cause |
|---|---|---|
| `validation` | 400, 413, 422 | A field is missing, too long, or unknown; a body too large |
| `unauthorised` | 401 | No session, an expired session, a wrong cron secret |
| `forbidden` | 403 | A staff account calling an organiser-only endpoint; a guest account the organiser removed trying to join again with the shared link |
| `link_closed` | 403 | The shared link is valid but the organiser switched it off |
| `event_full` | 409 | No place left for one more guest (join with the shared link, or "yes" again after "no") |
| `not_found` | 404 | Unknown id, a wrong or revoked token, or another organiser's event or venue (missing and not yours look the same on purpose) |
| `method_not_allowed` | 405 | Wrong HTTP method for this path |
| `seat_taken` | 409 | Someone else holds or owns the seat or table (the database said no) |
| `hold_expired` | 409 | The 5-minute hold ran out before confirming |
| `deadline_passed` | 409 | The event's change deadline has passed (also: joining with the shared link after it) |
| `conflict` | 409 | Any other clash, including "please try again" after a Postgres deadlock |
| `guests_seated` | 409 | Applying a room setup would re-seat guests: send `confirm: true` (`details: {seated, capacity, guests, accessible_needed, accessible_seats, holding}`) |
| `not_enough_seats` | 422 | The room setup has fewer seats than guests coming: send `confirm: true` to seat as many as fit (`details` as above) |
| `too_small` | 422 | The room fits none of that setup |
| `rate_limited` | 429 | Too many calls in this minute, too many live streams, too many held tables, or a booking cap (4 upcoming bookings per mailbox, 10 booking attempts per address and day at one restaurant) |
| `internal` | 500 | A bug; the message never shows a stack trace |

The frontend adds two of its own codes that never come from the server:
`network` (no answer) and `unknown` (an answer without this shape).

A restaurant 409 may also carry `alternatives` (other times and tables) inside
the error object (decisions log, "restaurants vertical API", item 5).

## Three worked examples

These run against a local backend after `python -m app.seed.run` (see
[`runbook.md`](runbook.md)). Replace the ids with the ones the seed printed.

Is it up?

```bash
curl http://127.0.0.1:8000/api/health
```

It answers `{"status", "database", "version", "time"}` with HTTP 200, or
`"status": "degraded"` with HTTP 503 when the database cannot be reached.

Log in as the demo organiser (local SQLite only; the default password is in
`backend/app/seed/run.py`):

```bash
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email": "organiser@example.com", "password": "demo-organiser-2026"}'
```

The answer has a `token`; send it as `Authorization: Bearer <token>` to the
organiser endpoints.

Hold and confirm a seat as an attendee (the seed prints the `/e/<token>`
links; the API path uses the same token after `/a/`):

```bash
curl -X POST http://127.0.0.1:8000/api/a/TOKEN/hold    -H 'Content-Type: application/json' -d '{"seat_id": 12}'
curl -X POST http://127.0.0.1:8000/api/a/TOKEN/confirm -H 'Content-Type: application/json' -d '{"seat_id": 12}'
```

The step-by-step picture of what happens inside is in
[`architecture.md`](architecture.md), section 3.
