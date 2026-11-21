# backend/app/seed: read me first

## Purpose

Restaurant platform additions use the same repeatable migration. New columns
are appended in the same order in models.py and NEW_COLUMNS. Restaurant indexes
live in RESTAURANT_INDEXES, preserving the historical NEW_INDEXES contract.
SQLite timestamp additions use DATETIME to match the fresh schema. Existing
layouts remain untouched and are interpreted as an implicit room by the service.

Commands, run from `backend/`:

- `python -m app.seed.migrate` creates any missing tables, then adds the
  columns and indexes listed in `NEW_COLUMNS` and `NEW_INDEXES` that the
  database lacks. Safe to run again. On Postgres it is the only place DDL
  runs; the app never does it itself.
- `python -m app.seed.run` creates the tables too, then the two demo accounts
  and the demo data for both verticals, and prints the links to open.
- `python -m app.seed.lisbon_catalogue` adds 20 Lisbon restaurants to a local
  SQLite database with `DEMO_MODE=1`. It can run on an empty database or after
  the regular seed. Re-running it keeps existing listings, bookings and
  galleries. Each restaurant has researched public details, a licensed cover,
  an approximate price band and a direct Google Maps link. The public page
  labels opening hours, floor plan and table availability as simulated.
- `python -m app.seed.demo_reviews` adds labelled fictional reviews to all
  published demo restaurants in local SQLite with `DEMO_MODE=1`. Re-running
  it preserves existing reviews and adds only missing entries.

`POST /api/demo/reset` (in `routers/demo.py`) wipes the data and calls the
same `seed_all()`.

## Key functions

| File | Function | Job |
|---|---|---|
| `migrate.py` | `main()` | `db.create_all()` under a Postgres advisory lock: missing tables, then `upgrade_schema()` |
| `migrate.py` | `upgrade_schema(connection)` | `ALTER TABLE ... ADD COLUMN` for each missing `NEW_COLUMNS` entry (checked with the inspector first, plus `IF NOT EXISTS` on Postgres), then `CREATE INDEX IF NOT EXISTS` |
| `run.py` | `demo_password(env_name, settings)` | The password from the environment; the public default only on local SQLite with `DEMO_MODE=1` |
| `run.py` | `ensure_demo_users(session, settings)` | Creates or updates `organiser@example.com`, `staff@example.com` and the member `rita@example.com` |
| `run.py` | `seed_all(session, settings, actor)` | Users plus both verticals; saves the links in `demo_links`; commits |
| `demo_events.py` | `seed(session)` | A wedding and a conference: venues, tables, guests, groups, who knows whom. Both have the shared link on (`wedding_share`, `conference_share`) |
| `demo_restaurant.py` | `seed(session)` | "Casa Lumen": 18 tables in four zones, opening hours, bookings for today and the next three days, two weeks of past dinners; since the discovery page it also has a slug, address, location, cuisines and a drawn photo |
| `demo_restaurant.py` | `free_slug(session, wanted)` | The slug, or `-2`, `-3`... when a restaurant already has it (a second seed) |
| `demo_showcase.py` | `seed(session)` | Four invented restaurants in real Lisbon neighbourhoods with real rooms (south glass wall and a terrace, an awned patio and a fireplace room, a curved room with west windows, a small quiet room), published, with opening hours, drawn photos and `features`; returns `showcase_<slug>` links to `/restaurants/<slug>` |
| `demo_event_venues.py` | `seed(session)` | Six invented event venues (three halls: theatre rows, round tables of ten, classroom; three quintas: round tables of eight) in real areas, published with a slug and drawn photos, and ten listed events (link on, a cap, some guests seated, 9 to 54 days ahead) covering every event type; returns `event_booking`, `event_staff` and four `showcase_venue_<slug>` links |
| `demo_member.py` | `seed(session, password)` | Rita Rossi (`rita@example.com`): staff at Casa Lumen and Quinta da Serra Azul, and, with a guest account of the same address and password, a dinner at Tagus Terrace and a seat at the Lisbon Product Conference |
| `demo_photos.py` | `scene(name)`, `add_photos(session, venue, [(scene, alt)])` | The default demo's pictures, drawn from plain shapes by this file (400 x 225, cached per process) |
| `lisbon_catalogue.json` and `lisbon_photos/` | Lisbon catalogue data and cover images | The manifest records the source for the listing, the map pin, the approximate price band, and the author, source page and licence of each cover. Images are the Commons web-size variants. |

## Data flow

```
seed_all()
  ensure_demo_users()            organisers table (passwords hashed with scrypt)
  demo_events.seed()      -> {"wedding_guest_choosing": "/e/<token>", "wedding_share": "/j/<token>", ...}
  demo_restaurant.seed()  -> {"restaurant_booking": "/r/<id>", ...}
  demo_showcase.seed()    -> {"showcase_<slug>": "/restaurants/<slug>", ...}
  demo_event_venues.seed() -> {"event_booking": "/events", "showcase_venue_<slug>": "/venues/<slug>", ...}
  demo_member.seed()      (no links: Rita's memberships, guest account, booking and seat)
  demo_links rows          <- those links, for GET /demo/links
  audit_log row            <- {"count": n}, never the links themselves
  commit
```

Each vertical seed makes its own `random.Random(SEED)` with `SEED = 2026`, so
every run builds the same people and the same seating for the same date. Only
the secret tokens are truly random: a predictable token would open anyone's
page.

## Three likely walkthrough questions

**Is any of this data real?**
The default demo uses fictional names and `@example.com` emails
(contract section 7). The optional Lisbon catalogue uses publicly listed
business names, addresses and photographs. Its reservations and layouts
belong to the SeatPlan demo.

**Why are the demo links not kept in the audit log?**
A link like `/e/<token>` holds a raw secret token, and the rule is that tokens
are stored only as SHA-256 hashes and never written into the audit log. The
demo is the one place that must hand links out, so they live in their own
small table, `demo_links`, which every reset wipes and which the API reads
only while `DEMO_MODE=1`.

**What stops a deployment from using the public demo passwords?**
`demo_password()` returns the defaults written in `run.py` only on a local
SQLite database with `DEMO_MODE=1`. On Postgres, which means any deployment,
the seed stops with an error unless `DEMO_ORGANISER_PASSWORD`,
`DEMO_STAFF_PASSWORD` and `DEMO_MEMBER_PASSWORD` are set.
