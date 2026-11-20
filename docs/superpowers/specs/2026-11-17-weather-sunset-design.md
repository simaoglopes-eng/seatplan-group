# Weather, rain plan and sunset tables: design

Date: 2026-11-17. Status: design for review (nothing implemented). Branch for the work: a new
branch off `codex/restaurantes-ux` (never `main`). Size: **L** (about 9 to 11 developer days).

Mockup: `weather-sunset.html` (desktop time step with the Sunset chip and the weather strip; phone
manage page with the rain plan card; staff banner and owner switch).

---

## 1. Goal

SeatPlan already knows where the sun is: `app/ambience/solar.py` (`sun_position`, `sun_times`),
`app/ambience/light.py` (`window_has_sun`, `sun_patches`, `table_light`) and
`app/ambience/table.py` (`table_ambience`, which already reports `sunset_at` and the `sunset`
feature). It does not know whether there will be any sun. This feature adds real weather and uses
it in three ways:

1. **Weather on top of the sun model.** A server-side forecast from Open-Meteo (httpx, no SDK),
   cached per restaurant location and hour, with a demo provider by default and a fallback when
   the forecast is not available. Combined with the sun patches it gives sentences such as
   "Tomorrow at 13:00 the terrace will be sunny" or "Rain expected at 20:00: indoor tables
   recommended".
2. **Rain plan.** When the forecast for a terrace or outdoor booking turns to rain, the existing
   15-minute cron offers the diner a similar indoor table: the table is held for them, and one tap
   moves the booking. Nothing is ever moved without the diner's tap.
3. **Sunset table.** A diner asks for "sunset". We compute the sunset time for the date and place,
   recommend the start times whose meal contains the sunset, and the tables by a west-facing
   window (or outdoors) from which the sun is visible as it sets. A "Sunset" chip appears in
   discovery and in the time step.

### User stories

Diner
- D1. As a diner choosing a time, I see whether lunch or dinner will be sunny, cloudy or rainy that
  day, so I can pick the terrace or not.
- D2. As a diner looking at the floor plan, a terrace or sunny table tells me what the weather will
  do to it ("Tomorrow at 13:00 the terrace will be sunny").
- D3. As a diner who booked the terrace, if rain is forecast I get one email with an indoor table
  already held for me, and I move inside with one tap, or keep my terrace table.
- D4. As a diner who wants to watch the sunset, I tap "Sunset" and SeatPlan tells me when the sun
  sets, which time to book and which tables see it. If no time works that day, it says why.
- D5. As a diner searching, I can filter for restaurants with sunset tables.

Staff
- S1. As staff, the floor shows the weather for the service and which terrace bookings were offered
  an indoor table, moved inside, declined, or could not be offered one (no indoor table free).
- S2. As staff, I can withdraw a rain offer (for example when we will put up the heaters).

Owner
- O1. As an owner, I switch the rain plan on or off for my restaurant.
- O2. As an owner, my restaurant appears under "Sunset" in discovery when my rooms support it,
  worked out from my saved rooms (no new setting).

## 2. Non-goals

- No change to the room editor (`frontend/src/pages/room-editor/`, Sergio's area). Outdoor rooms,
  north, window facing and sun rules already exist there; nothing new is needed from it.
- No automatic moves. The rain plan only ever offers; the diner taps or nothing happens.
- No weather on discovery cards in v1 (only the Sunset chip and the sunset time). Weather on cards
  is a phase 2 candidate.
- No weather inside the confirmation or reminder emails in v1 (the reminder body is written at
  booking time, days before a useful forecast exists).
- No forecasts beyond 7 days, no historical weather, no air quality, no UV.
- No push notifications or SMS. Email only (through `mail/outbox.enqueue`).
- No browser call to any weather service: the CSP in `vercel.json` (`connect-src 'self'`) stays as
  it is. All weather calls are server side.
- No changes to the events vertical (events pages, editor, join, account, `events_service`,
  `routers/events.py`, `attendee.py`, `guest_*.py`, `visitor.py`).

## 3. What exists and is reused

| Existing code | Reused for |
|---|---|
| `app/ambience/solar.py` `sun_times`, `sun_position` | Sunset time and the sun's azimuth at sunset |
| `app/ambience/light.py` `opening_facing`, `LIGHT_WINDOWS`, `SUNSET_FACING`, `SUNSET_WINDOW`, `table_light`, `sun_patches` | Which windows face the sunset; which tables are astronomically sunny |
| `app/ambience/table.py` `table_ambience`, `_sees_sunset`, `features` (`sun`, `shade`, `sunset`, ...) | Per-table light over the stay, the existing `sunset` feature |
| `app/ambience/phrases.py` `hhmm`, `light_phrase` | Same sentence style; new weather phrases live next to them |
| `restaurant_service/ambience_view.py` `load_rooms`, `LoadedRoom`, `ambience_payload`, `table_features` | Rooms and tables as engine values; features for the optimiser |
| `restaurant_service/map_view.py` `build_map`, `_recommendations` | Adds `weather` to the map; the `sunset` wish reorders the recommendation |
| `restaurant_service/availability.py` `PREF_KEYS`, `clean_prefs`, `slot_statuses`, `table_specs_for` | Adds the `sunset` wish; sunset times come from the real statuses |
| `optimiser/restaurant_assign.py` `recommend_table`, `restaurant_model.prefs_met` | Picking the similar indoor table and sunset tables. No optimiser change |
| `restaurant_service/holding.py` `client_key`, `_rows_for` pattern, `check_hold_caps`; `core/holds.py` `take_hold`, `confirm_hold`, `release_hold`, `commit_or_seat_taken` | The rain hold on the indoor table and its one-tap confirm |
| `restaurant_service/manage_flow.py` `check_changeable`, `needs_of`, `change_booking`, `cancel_booking` | Accepting the offer is a table move at the same time; changes/cancels withdraw the offer |
| `restaurant_service/booking_rows.py` `release_slots`, `write_slots`, `describe`, `load_by_token` | Moving the booking to the indoor table |
| `restaurant_service/emails.py` `_queue`, `queue_change`, `drop_reminder` | Rain offer email; change email after the move |
| `restaurant_service/features.py` `compute_features`, `refresh_features` | The new `sunset` feature for discovery |
| `restaurant_service/discovery.py` `FEATURES`, `_card` | The Sunset chip filter and the card's sunset time |
| `restaurant_service/changes.py` `record_change` | Live bump plus audit for every offer, accept, decline |
| `restaurant_service/clock.py` `venue_zone`, `local_datetime`, `slot_moment`, `is_past`, `hhmm` | Local time for forecasts and offers |
| `mail/providers.py` (`Provider` Protocol, `ConsoleProvider`, `ResendProvider`, `provider_from_settings`) | The pattern for the weather provider interface |
| `mail/outbox.py` `redact_links`, `_PERSONAL_LINK` | Removes personal links from finished outbox rows. Today's pattern `/[abej]/[A-Za-z0-9_-]+` would match only `/b/rain` in `/b/rain/<token>` and **leave the token behind**, so the pattern gets one additive change: `/[abej]/(?:rain/)?[A-Za-z0-9_-]+` (event links are redacted exactly as before; pinned by a test) |
| `routers/emails.py` `_check_cron_secret`, `rate_limit` | The weather cron endpoint uses the same secret and guard |
| `security.py` `rate_limit`, `client_ip`, `hash_token`, `new_token`, `tokens_match` | Limits and the offer token |
| `db.py` `insert_ignoring_duplicates` | Creating the cache row once per cell |

Verified facts that shape the design:

- The raw manage token is **not stored** (only `manage_token_hash`; see `emails._link`, which falls
  back to the restaurant page for staff changes). The cron therefore cannot build a `/b/{token}`
  link. The rain offer gets its own narrow token and link, `/b/rain/{offer_token}`, and the manage
  page `/b/{token}` shows the same offer when the diner opens it.
- `core/holds.take_hold` always uses `HOLD_MINUTES = 5`. A rain hold must last hours, so
  `take_hold` gets one optional keyword (`expires_at`), defaulting to today's behaviour. That file
  is shared with events: only the default path is used there, and a test pins it.
- `PREF_KEYS` is `("sun", "shade", "view", "quiet", "away_from_wc")`. The engine already emits a
  `sunset` feature per table for a stay (`table.py`), so adding `"sunset"` to `PREF_KEYS` is all
  the optimiser needs to prefer sunset tables.
- `_sees_sunset` in `table.py` accepts any window facing 200 to 340 degrees within 3 m, or any
  outdoor room. It does not check where the sun actually sets. In Lisbon the sun sets at azimuth
  about 245 degrees on 18 Nov 2026 (17:22) and about 301 degrees on 21 Jun 2027 (21:04)
  (computed with `solar.py`). A window facing 340 degrees does not see a 245-degree sunset.
- Lisbon demo services are Lunch 12:00-15:00 (Tue-Sun) and Dinner 19:00-23:00
  (`seed/demo_restaurant.py` `SERVICES`). From October to March the sun sets before dinner, so the
  sunset feature must explain "before opening" honestly, and the demo needs an early service at
  Miradouro 7 (section 13).
- Miradouro 7 (`seed/demo_showcase.py`) has a curved Panorama room with two west windows (side 3,
  north 0, facing 270 degrees) and tables M1, M2 (accessible), M3 next to them. Tagus Terrace has
  an outdoor "Quay terrace" (Q1 to Q5, partly under an awning) and an indoor "River hall" (R1 to
  R8). These are the demo stars.
- The only scheduler is `.github/workflows/email-cron.yml` (every 15 minutes,
  `POST /api/internal/email/process` with `X-Cron-Secret`). The backend is one Vercel Python
  function with a 30 s limit.

## 4. External service: Open-Meteo

Checked on 2026-11-17 at open-meteo.com/en/pricing and /en/terms:

- Free tier: **non-commercial use only**; 600 calls/minute, 5,000/hour, 10,000/day, 300,000/month,
  per IP and application. Apps with subscriptions or ads count as commercial.
- Paid tiers (API Standard 1M calls/month, Professional 5M, Enterprise): "fixed monthly price"
  (the page shows no amount without a currency choice; Martim must check it), commercial use
  included. Host `customer-api.open-meteo.com` with an `apikey` query parameter.
- Data licence **CC BY 4.0** on every tier: we must credit Open-Meteo wherever forecast data is
  shown. Copy: "Weather data by Open-Meteo.com" linking to `https://open-meteo.com/`.

### Provider interface (default: demo)

New package `backend/app/weather/` mirrors `mail/providers.py`:

```python
class WeatherProvider(Protocol):
    name: str  # "demo" | "open-meteo"
    def fetch(self, lat: float, lng: float) -> list[HourForecast]:
        """Hourly forecast for the next 7 days, UTC hours, or raise WeatherUnavailable."""
```

- `DemoWeatherProvider(scenario)`: deterministic, no network. Seeded by `random.Random(f"{cell}-{utc_date}")`
  with a plausible Lisbon pattern. `WEATHER_DEMO_SCENARIO` forces a pattern for demos and e2e:
  `clear`, `rain-evening` (rain 19:00-23:00 local, tomorrow, 80%), `showers`, `overcast`.
  Every answer from it is labelled "Simulated weather (demo)" in the UI.
- `OpenMeteoProvider(api_key, client)`: one GET with httpx, timeout 2.5 s (connect and read),
  `User-Agent: seatplan/<APP_VERSION>`. Free host `https://api.open-meteo.com/v1/forecast`, or
  `https://customer-api.open-meteo.com/v1/forecast` with `apikey` when `OPEN_METEO_API_KEY` is set.
  Query: `latitude`, `longitude` (the rounded cell, never a diner's position),
  `hourly=temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m`,
  `timezone=GMT`, `timeformat=unixtime`, `forecast_days=7`. `__repr__` hides the key; errors carry
  only the exception type or the HTTP status (never the URL, which contains the key).
- `provider_from_settings(settings)`: `WEATHER_PROVIDER=open-meteo` uses the real provider;
  anything else (including unset) uses the demo provider.

New settings in `app/config.py` (read there and only there): `weather_provider`
(`WEATHER_PROVIDER`, default `demo`), `open_meteo_api_key` (`OPEN_METEO_API_KEY`, default empty),
`weather_demo_scenario` (`WEATHER_DEMO_SCENARIO`, default empty), `weather_max_fetches_per_hour`
(`WEATHER_MAX_FETCHES_PER_HOUR`, default 200). Secrets only in Vercel environment variables.

## 5. UX flow and exact copy

All copy in English. Restaurant theme (`design/restaurant-theme.css`): white and lavender surfaces,
purple `#4F3F8F` for structure and selection, pink `#B0347A` only for the one main action. Weather
states are never shown by colour or icon alone: every icon has its words next to it.

### 5.1 Time step (`StepTime.tsx`), diner

Under the date line, a **weather strip** (component `WeatherStrip`), one row per service of the day:

| Case | Copy |
|---|---|
| Header | "Weather for Wed 18 Nov" (or "Weather today", "Weather tomorrow") |
| Clear | "Lunch · Sunny · 19°C" |
| Partly cloudy | "Lunch · Sun and clouds · 18°C" |
| Overcast | "Lunch · Cloudy · 17°C" |
| Showers (30-59%) | "Dinner · Showers possible from 20:00 (40%)" |
| Rain (60%+ or 0.5 mm+) | "Dinner · Rain expected from 21:00 (70%)" |
| Windy (35 km/h+) | appended: " · Windy" |
| Advice line under a wet service, only when the restaurant has a terrace | "Indoor tables recommended for dinner." |
| Beyond 7 days | "The forecast for this date comes later. Sun and sunset times are worked out from the sun's position." |
| Unavailable | "Weather forecast unavailable right now. Sun and sunset times are worked out from the sun's position." |
| Stale (served from a cache older than 2 h) | appended to the header: " · updated 14:00" |
| Demo source | small badge after the header: "Simulated weather (demo)" |
| Credit (always when any forecast is shown) | "Weather data by Open-Meteo.com" (link, opens in a new tab, `rel="noopener noreferrer"`) |
| Restaurant without coordinates | strip not shown |

Next to the heading "Choose a time", a **Sunset chip** (a real toggle button, `aria-pressed`):
label "Sunset". Shown only when the restaurant has the `sunset` feature. When pressed:

- The `SunsetPanel` opens above the times:
  - Title: "Sunset at 17:22"
  - Line: "Golden hour from 16:37. Book a time that puts the sunset inside your meal."
  - Best time row: "Best time: 16:30 · sunset 52 min into your meal" with a secondary button
    "Choose 16:30".
  - Other good times: "Also good: 16:15, 16:45".
  - Tables: "Tables that see the sunset: M1, M2 (wheelchair accessible), M3 · by the west windows
    of the Panorama room".
  - Weather at sunset (when known): "Clear sky expected at sunset." / "Some clouds expected at
    sunset (45% cover)." / "Clouds expected at sunset (85% cover): the sky may stay grey." /
    "Rain expected at sunset."
- Each eligible time in the list gets a tag "Sunset" (text, plus a small sun-on-horizon mark).
- The `sunset` wish is added to the party's prefs, so the table step recommends a sunset table
  first (map star) and the confirmation reads "sunset view".
- Empty reasons (copy exact):
  - before opening: "The sun sets at 17:22, before Dinner starts at 19:00. No time here catches
    the sunset on this day."
  - after closing: "The sun sets at 21:04, after the last booking time (20:45). Try an earlier
    service or another day."
  - no sunset table free at any eligible time: "Every table that sees the sunset is taken at those
    times. Try another day, or join the waitlist for 16:30."
  - not located: chip hidden.
  - polar: chip hidden (never in Lisbon; handled for correctness).
- Pressing the chip again: removes the wish, closes the panel, removes the tags.

### 5.2 Table step (`StepTable.tsx` / `TablePanels.tsx`), diner

The ambience card (already shows up to three phrases) gets one weather line on top, only for
outdoor tables and for tables the engine calls sunny for the stay:

- Outdoor, clear: "Tomorrow at 13:00 the terrace will be sunny" (`the terrace` is the outdoor
  room's name when the restaurant has more than one outdoor room, e.g. "Quay terrace").
- Indoor sunny window, clear: "Tomorrow at 13:00 the sun reaches this table".
- Sunny by astronomy but cloudy forecast: "Cloudy at 13:00: no direct sun expected".
- Outdoor, rain: "Rain expected at 20:00: indoor tables recommended".
- Outdoor, showers: "Showers possible at 20:00 (40%): an indoor table is the safer choice".
- Outdoor, windy: "Windy on the terrace at 20:00 (40 km/h)".
- Sunset table: existing "Sunset at 17:22 from your seat", plus the weather-at-sunset sentence.

Rule: weather may only **lower** a sun claim, never raise it. If the geometry says no sun, a clear
sky adds nothing.

On the details step (`StepDetails.tsx`), when a held table is outdoor and the venue has the rain
plan on, one plain line under the email field: "If rain is forecast for your terrace table, we may
email you once with an indoor table to switch to."

### 5.3 Rain plan email (diner)

Kind `rain_offer`, idempotency key `rain-offer-<offer public id>`.

- Subject: "Rain expected: an indoor table is held for you at Tagus Terrace"
- Body:
  > Hi Ana,
  >
  > Rain is expected from 20:00 on Wed 18 Nov (80% chance). You booked the Quay terrace, table Q4,
  > for 4 people at 20:00.
  >
  > We are holding table R4 in the River hall for you until 17:30. It is by the glass wall with the
  > view of the Tagus river.
  >
  > [Move me inside] (button; link `/b/rain/<offer token>`)
  >
  > Your time and party stay the same. Prefer the terrace? Open the link and choose "Keep my
  > terrace table", or do nothing: the indoor table is released at 17:30.
  >
  > Weather data by Open-Meteo.com
- In demo mode the forecast line ends with "(simulated weather, demo)".
- The link opens a page. Opening the link never changes anything (mail scanners prefetch links).

### 5.4 Rain offer page `/b/rain/:token` and manage page `/b/:token`, diner

Both show the same `RainPlanCard` (the manage page shows it above "Reservation details"):

- Eyebrow: "Rain plan"
- Title: "Rain expected at 20:00"
- Line: "80% chance of rain · 14°C · forecast updated 14:00"
- Comparison: "Now: Quay terrace · Table Q4 (outdoor)" → "Held for you: River hall · Table R4 ·
  View of the Tagus river"
- Held line: "Held for you until 17:30"
- Primary (pink): "Move me inside"
- Secondary: "Keep my terrace table"
- Note: "Same time, same party. Your chair request, if any, is removed when the table changes."
- After "Move me inside": toast "You're moved inside: River hall, table R4." and the card becomes
  "You're inside: River hall · Table R4. A confirmation email is on its way."
- After "Keep my terrace table": "You're keeping the terrace. We won't ask again for this booking."
- Expired: "This indoor table is no longer held. You can still change your booking below, or call
  the restaurant." (manage page) / "This offer has ended. Open your booking from your confirmation
  email to make changes." (offer page)
- Taken in the meantime (409): "That table was just taken. Your terrace booking is unchanged."
- Booking changed or cancelled after the offer: "This offer no longer applies because your booking
  changed."
- Offer page header shows only restaurant, date, time, party and tables: never the diner's name,
  email or phone.

### 5.5 Staff floor (`StaffFloor.tsx`, `FloorLists.tsx`)

- Banner above the floor when the service has a forecast:
  "Dinner · Rain expected from 20:00 (80%) · 3 terrace bookings: 1 moved inside, 1 offered, 1 with
  no indoor table free". Clear weather: "Lunch · Sunny · 19°C". Credit link at the end.
- Per booking badge (text, never colour alone) in the list: "Rain plan: offered R4 until 17:30",
  "Rain plan: moved inside", "Rain plan: keeping terrace", "Rain plan: no indoor table free",
  "Rain plan: expired", "Rain plan: withdrawn".
- Action on an offered booking: "Withdraw rain offer" (secondary), confirm dialog "Withdraw the
  rain offer? Table R4 is released for other guests. The guest is not emailed." Buttons "Keep
  offer" / "Withdraw".

### 5.6 Owner (`ProfileForms.tsx` / `ProfilePage.tsx`)

A section "Weather" in the profile, under the location:

- Switch: "Rain plan for terrace bookings"
- Hint: "When rain is forecast for a terrace booking, we hold a similar indoor table and email the
  guest once. They switch with one tap or keep the terrace. Tables are held for up to 4 hours and
  never for more than a quarter of your indoor tables at once."
- When the restaurant has no outdoor room: switch disabled with "Add an outdoor room in the room
  editor to use the rain plan."
- Read-only line: "Sunset tables: yes, by your west windows" / "Sunset tables: none. Tables need a
  window facing between south-west and north-west, or an outdoor room, with north set."

### 5.7 Discovery (`DiscoverBar.tsx`, `FilterDrawer.tsx`, `RestaurantCard.tsx`)

- New quick chip "Sunset view" (with `sun`, `view`, `terrace`), sends `features=sunset`.
- Card line when the restaurant has the feature: "Sunset 17:22" (for the searched date, else today).
  With a searched time whose meal does not contain the sunset: "Sunset 17:22, before your time".

## 6. Data model

### 6.1 New column

| Table | Column | DDL (`NEW_COLUMNS` in `seed/migrate.py`, appended in the same order as in `models.py`) |
|---|---|---|
| `venues` | `rain_plan_enabled` | `("venues", "rain_plan_enabled", "BOOLEAN NOT NULL DEFAULT FALSE")` |

Model: `rain_plan_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("FALSE"))`
appended to `Venue` after `published_at`.

`venues.features` is JSON already: the new `"sunset"` key needs no DDL.

### 6.2 New tables (created by `db.create_all()` in `migrate.main()`; no `NEW_COLUMNS` entry)

`weather_forecasts` (no personal data)

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `cell_key` | String(24), unique | `"38.72,-9.14"`: lat/lng rounded to 0.02 degrees (about 2 km) |
| `lat`, `lng` | Float | the rounded cell centre that is sent to the provider |
| `provider` | String(20) | `demo` or `open-meteo` |
| `fetched_at` | UtcDateTime, nullable | last success |
| `valid_until` | UtcDateTime, nullable | `fetched_at + 1 h` |
| `refresh_lease_until` | UtcDateTime, nullable | single-flight lease (20 s) |
| `failures` | Integer, default 0 | for back-off |
| `next_attempt_at` | UtcDateTime, nullable | back-off: 5, 10, 20, 40, 60 min |
| `hours` | JSON, default `[]` | list of `{t, p, mm, code, cloud, temp, wind}`, UTC unix seconds; at most 7 x 24 entries |
| `last_error` | String(200), nullable | type or HTTP status only |

`rain_offers`

| Column | Type | Notes |
|---|---|---|
| `id` | Integer PK | |
| `public_id` | String(32), unique | `new_public_id` |
| `venue_id` | FK venues.id, index | |
| `booking_id` | FK bookings.id **ondelete CASCADE**, **unique** | at most one offer per booking, ever (v1). The unique constraint makes two concurrent cron runs safe |
| `token_hash` | String(64), unique, nullable | SHA-256 of the offer token; set to NULL when the offer ends |
| `status` | String(12) | `offered`, `accepted`, `declined`, `expired`, `withdrawn`, `no_table` |
| `from_table_ids` | JSON | the booking's tables at offer time |
| `to_table_ids` | JSON, default `[]` | the held indoor tables (empty for `no_table`) |
| `date` | Date | the booking date at offer time |
| `start_slot`, `end_slot` | Integer | the booking window at offer time; accept refuses if it changed |
| `forecast` | JSON | `{"from": "20:00", "probability": 80, "mm": 1.4, "source": "open-meteo"}` |
| `created_at` | UtcDateTime | |
| `expires_at` | UtcDateTime | `min(now + 4 h, booking start - 60 min)` |
| `decided_at` | UtcDateTime, nullable | |

Index: `ix_rain_offers_status_expires (status, expires_at)` declared in `__table_args__` (created
with the table). `no_table` rows exist so staff see "no indoor table free" and the cron does not
retry every 15 minutes; they have no token and no hold.

### 6.3 Migration

`seed/migrate.py`: one line appended to `NEW_COLUMNS`. New tables come from `create_all`. Test
`tests/test_migrate_weather.py` starts from the current schema without the column and tables, runs
`upgrade_schema` twice, and checks the column default and that nothing changes the second time.
Production: back up, run `python -m app.seed.migrate` against Postgres **before** merging (team
rule), then `python -m app.seed.refresh_features` (section 13) once.

## 7. API

All bodies use `Strict` models (`extra="forbid"`). Errors keep the `{"error": {"code", "message"}}`
shape. New router file `backend/app/routers/weather.py`, registered in `main.py` under `/api`.

| Method, path | Auth | Request | Response |
|---|---|---|---|
| `GET /r/{vid}/weather?date=` | public, `r-read` limit (120/min/IP), `load_published` | `date` | `WeatherAnswer` (below) |
| `GET /r/{vid}/sunset?date=&party=` | public, `r-read` limit | `date`, `party` (1..30, `check_party_size`) | `SunsetAnswer` |
| `GET /r/{vid}/map` (existing) | unchanged | prefs may now include `sunset` | adds top-level `weather` (`WeatherAnswer` for the stay, `hours` trimmed to the stay) and per table `ambience.weather_phrase` (string or null) and `ambience.outdoor` (bool). Old clients ignore them |
| `GET /b/{token}` (existing, `bookings.py`) | manage token | | adds `rain_offer` (`RainOfferView` or null) |
| `POST /b/{token}/rain-offer/accept` | manage token, `b-manage` limit | `{}` | `200` booking `describe(...)` with `rain_offer`; `409 offer_expired`, `409 conflict` (booking changed), `409 seat_taken` |
| `POST /b/{token}/rain-offer/decline` | manage token | `{}` | `200` booking |
| `GET /b/rain/{offer_token}` | offer token, `b-rain` limit 30/min/IP | | `RainOfferPublic`; unknown, ended or wrong token: `404 not_found` "This offer does not exist." |
| `POST /b/rain/{offer_token}/accept` | offer token | `{}` | `200 RainOfferPublic` (status `accepted`); same 409s |
| `POST /b/rain/{offer_token}/decline` | offer token | `{}` | `200 RainOfferPublic` (status `declined`) |
| `POST /staff/{vid}/bookings/{booking_id}/rain-offer/withdraw` | `CurrentUser` + `venue_access` staff rule | `{}` | `200 StaffBooking` with `rain_plan` |
| `GET /staff/{vid}/floor` (existing) | unchanged | | adds `weather` (service summary + counts) and per booking `rain_plan` (`{status, to_tables, expires_at}` or null) |
| `GET/PATCH /owner/restaurants/{vid}/profile` (existing, `owners.py`) | owner | `ProfilePatch.rain_plan_enabled: bool | None` | profile adds `rain_plan_enabled`, `can_rain_plan` (has an outdoor room), `sunset_tables` (int) |
| `GET /restaurants` (existing) | unchanged | `features=sunset` now valid | card adds `sunset` (`"17:22"` or null) and `sunset_in_stay` (bool or null) |
| `POST /internal/weather/process` | `X-Cron-Secret` (same `_check_cron_secret`), limit 30/min/IP | none | `{"forecasts_refreshed": n, "offers_made": n, "no_table": n, "offers_expired": n, "stopped_early": bool}` |

```jsonc
// WeatherAnswer
{
  "date": "2026-11-18", "located": true,
  "status": "ok",            // ok | stale | unavailable | out_of_range | not_located
  "source": "open-meteo",    // open-meteo | demo | none
  "updated_at": "14:00",     // local time of fetched_at, or null
  "attribution": {"text": "Weather data by Open-Meteo.com", "url": "https://open-meteo.com/"},
  "sun": {"sunrise": "07:21", "sunset": "17:22"},
  "services": [
    {"name": "Lunch", "sky": "clear", "temperature_c": 19, "rain_from": null, "rain_probability": 10,
     "windy": false, "advice": null, "text": "Sunny · 19°C"},
    {"name": "Dinner", "sky": "rain", "temperature_c": 14, "rain_from": "21:00", "rain_probability": 70,
     "windy": false, "advice": "indoor", "text": "Rain expected from 21:00 (70%)"}
  ],
  "hours": [{"time": "12:00", "sky": "clear", "rain_probability": 10, "temperature_c": 19, "wind_kmh": 12, "cloud_cover": 15}]
}
// SunsetAnswer
{
  "date": "2026-11-18", "located": true, "sunset": "17:22", "golden_hour_from": "16:37",
  "reason": null,            // null | before_opening | after_closing | tables_taken | no_sunset_tables | polar | not_located
  "first_service": {"name": "Dinner", "start": "19:00"},  // for the before_opening copy
  "best_times": [{"time": "16:30", "minutes_to_sunset": 52, "status": "available", "best": true},
                 {"time": "16:15", "minutes_to_sunset": 67, "status": "available", "best": false}],
  "tables": [{"id": 31, "label": "M1", "room": "Panorama room", "accessible": false},
             {"id": 32, "label": "M2", "room": "Panorama room", "accessible": true}],
  "weather": {"sky": "clear", "cloud_cover": 15, "text": "Clear sky expected at sunset."}
}
// RainOfferView (manage) / RainOfferPublic (offer link: no name, email, phone, notes)
{
  "id": "…", "status": "offered", "expires_at": "17:30",
  "forecast": {"from": "20:00", "probability": 80, "temperature_c": 14, "source": "open-meteo", "updated_at": "14:00"},
  "from": {"room": "Quay terrace", "tables": ["Q4"], "outdoor": true},
  "to": {"room": "River hall", "tables": ["R4"], "phrases": ["View of the Tagus river"]},
  "booking": {"restaurant": "Tagus Terrace", "date": "2026-11-18", "time": "20:00", "party_size": 4}  // public only
}
```

## 8. Backend modules and pure functions

Tests first for every pure function below (marked P) and for every security rule.

### 8.1 `app/ambience/weather.py` (new, pure, no network: fits the ambience README rule)

- `HourForecast` (frozen): `at_utc`, `rain_probability`, `precipitation_mm`, `weather_code`,
  `cloud_cover`, `temperature_c`, `wind_kmh`. (P)
- Constants: `RAIN_PROBABILITY = 60`, `RAIN_MM = 0.5`, `SHOWERS_PROBABILITY = 30`,
  `CLEAR_CLOUD = 30`, `CLOUDY_CLOUD = 70`, `WINDY_KMH = 35`, WMO code sets for rain (51-67, 80-82)
  and storm (95-99).
- `sky_of(hour) -> Sky` with `Sky = Literal["clear","partly","cloudy","showers","rain","storm"]`. (P)
- `is_wet(hour) -> bool`: probability >= 60, or >= 0.5 mm, or a rain/storm code. (P)
- `stay_outlook(hours, start, end) -> StayOutlook | None`: the hours overlapping `[start, end)`;
  `sky` (worst), `rain_from` (first wet hour, local), `max_probability`, `temperature_c` (at start),
  `windy`, `wet`, `possibly_wet`; None when no hour covers the stay. (P)
- `sun_after_clouds(light, outlook) -> Literal["sun","cloudy","none"]`: astronomical `"sun"` stays
  `"sun"` under clear or partly cloudy, becomes `"cloudy"` when overcast or wet; anything else stays
  `"none"` (never raises a claim). (P)
- `service_summary(hours, name, start, end, has_terrace) -> dict` for `WeatherAnswer.services`. (P)

### 8.2 `app/ambience/sunset.py` (new, pure)

- `SUNSET_AZIMUTH_TOLERANCE = 70.0` degrees, `SUNSET_LEAD = timedelta(minutes=45)` (golden hour,
  same as `light.SUNSET_WINDOW`), `MIN_MARGIN = timedelta(minutes=15)`.
- `sunset_azimuth(lat, lng, sunset) -> float` via `sun_position`. (P)
- `window_sees_sunset(room, opening, azimuth) -> bool`: light window, north set, `sun_rule` not
  `"never"`, a `between` rule must include the sunset clock time, facing within 70 degrees of the
  azimuth (`opening_facing`). (P)
- `table_sees_sunset(room, table, azimuth, sunset_local) -> bool`: outdoor room, or a qualifying
  window within 3 m (`opening_distance`, `NEAR_WINDOW`). (P)
- `sunset_starts(sunset, starts, turn_minutes) -> list[(time, minutes_to_sunset)]`: a start is
  eligible when the sunset falls in `[start + 15 min, start + turn - 15 min]`; ordered by distance
  to `floor15(sunset - 45 min)`. (P)
- `empty_reason(sunset, starts, turn_minutes) -> "before_opening" | "after_closing" | None`. (P)

`table.py` `_sees_sunset` is tightened to also require `window_sees_sunset` for the real sunset
azimuth of the day (so "Sunset at 17:22 from your seat" is only promised when the sun sets in front
of that window). See open decision 7 and risk R6.

### 8.3 `app/ambience/phrases.py` (extended, pure)

- `day_word(day, today) -> str`: "Today", "Tomorrow", else "Wed 18 Nov". (P)
- `place_word(room_name, outdoor_rooms) -> str`: "the terrace" when there is one outdoor room,
  else the room's own name. (P)
- `weather_phrase(kind, *, day_word, at, place, probability, wind_kmh) -> str | None` returning
  exactly the copy of section 5.2. (P)
- `sunset_weather_phrase(sky, cloud_cover) -> str` (section 5.1 copy). (P)

### 8.4 `app/weather/` (new package, I/O)

- `providers.py`: `WeatherProvider` Protocol, `WeatherUnavailable`, `DemoWeatherProvider`,
  `OpenMeteoProvider`, `parse_open_meteo(payload) -> list[HourForecast]` (P: validates equal array
  lengths, at most 400 entries, finite numbers, clamps 0..100 and 0..300; raises on anything else),
  `provider_from_settings`.
- `cache.py`: `cell_of(lat, lng) -> Cell(key, lat, lng)` (P), `backoff(failures) -> timedelta` (P),
  `forecast_for(session, venue, now, provider, allow_fetch=True) -> Forecast(status, source, hours,
  fetched_at)`:
  1. venue has no coordinates: `not_located`; date outside today..today+6: `out_of_range` (no fetch);
  2. row fresh (`valid_until > now`): `ok`, no HTTP;
  3. else if `allow_fetch`, not in back-off, the global cap allows (`rate_limit(session,
     "weather-fetch:global", WEATHER_MAX_FETCHES_PER_HOUR, 3600)`, 429 caught), and this call wins
     the lease (`UPDATE ... SET refresh_lease_until = now + 20 s WHERE cell_key = :k AND
     (refresh_lease_until IS NULL OR refresh_lease_until < :now)`, rowcount 1): fetch, store,
     `ok`; on failure `failures + 1`, `next_attempt_at = now + backoff`;
  4. else data younger than 6 h: `stale`; else `unavailable` (hours empty).
  The row is created first with `db.insert_ignoring_duplicates`. The lease UPDATE commits on its own
  short transaction so a slow provider never holds a write lock.
- `purge(session, now)`: delete cells not fetched for 7 days.

### 8.5 `restaurant_service/` (new and changed)

- `weather_view.py` (new): `outdoor_table_ids(loaded_rooms, zone_kinds) -> set[int]` (P: room
  `is_outdoor` or zone kind `terrace`); `weather_payload(session, venue, day, now)`;
  `table_weather_phrases(loaded_rooms, ambience_rows, outlook_by_hour, day, today) -> dict[int, str]`.
- `sunset_view.py` (new): `sunset_payload(session, venue, day, needs)`: `sun_times`, the day's
  starts from `schedule.periods_for_day`/`start_times`, `slot_statuses` with `prefs={"sunset"}`,
  free sunset tables at the best time via `ambience_view.table_features` and `occupancy`.
- `rain_plan.py` (new):
  - `HORIZON = (2 h, 30 h)`, `HOLD_MAX = 4 h`, `HOLD_END_BEFORE_START = 60 min`,
    `MAX_OFFERS_PER_VENUE_PER_RUN = 20`, `MAX_OFFERS_PER_RUN = 60`,
    `RAIN_HELD_SHARE = 4` (rain holds never cover more than `max(1, indoor_tables // 4)` tables in
    any slot).
  - `candidate_bookings(session, now) -> list[Booking]`: confirmed, venue published with
    `rain_plan_enabled`, start inside the horizon, any table outdoor, no `rain_offers` row.
  - `offer_expiry(now, start) -> datetime | None` (P): None when `start - 60 min < now + 30 min`.
  - `pick_indoor_tables(specs, busy, needs, outdoor_ids) -> tuple[int, ...] | None` (P over
    optimiser values): `recommend_table` on indoor specs only, same accessibility and high-chair
    needs; the booking's prefs minus `sun`; `view` kept as a tie-break.
  - `make_offer(session, venue, booking, outlook, now) -> RainOffer`: inserts the `rain_offers`
    row first (unique `booking_id`: a concurrent run gets IntegrityError and skips), then holds the
    tables with `holding.hold_tables_until(...)`, then `emails.queue_rain_offer(...)`,
    `record_change(action="rain_offer.create")`. No table: row with `status="no_table"`, no email.
  - `accept(session, venue, booking, offer, now)`: `check_changeable`; offer `offered`, not
    expired, `(date, start_slot, end_slot)` unchanged; `consume_hold` of the rain hold; then
    `release_slots`, `write_slots(to_table_ids)`, `chosen_seat.keep_seat_if_still_valid`,
    `table_choice = "chosen"`, `emails.drop_reminder` + `emails.queue_change(token="")`,
    `record_change(action="rain_offer.accept")`, `commit_or_seat_taken`.
  - `decline`, `withdraw_for(session, booking, reason)` (releases the hold; called from
    `manage_flow.change_booking`, `manage_flow.cancel_booking`, `staff_floor.move_booking`,
    `staff_floor.set_status`), `expire_due(session, now)`, `scrub(session, now)` (delete offers 30
    days after their date).
  - `process(session, provider, now, deadline)`: expire, collect candidates, refresh at most 10 cells
    (cron allows fetch; each fetch timeout 2.5 s), make offers until the deadline (20 s after
    start), scrub, purge. Commits per offer so a timeout keeps finished work.
- `holding.py`: `hold_tables_until(session, venue, day, table_ids, window, holder_key, expires_at)`
  reusing `take_hold(..., expires_at=...)`; `RAIN_HOLDER_PREFIX = "rain:"`.
- `core/holds.py`: `take_hold(..., expires_at: datetime | None = None)`; None keeps
  `now + HOLD_MINUTES` (events unchanged).
- `availability.py`: `PREF_KEYS` gains `"sunset"`. `MAX_PREFS` stays 5.
- `map_view.py` `build_map`: adds `weather` and the per-table `weather_phrase` and `outdoor`.
- `features.py` `compute_features`: adds `"sunset"`: any outdoor room, or any light window with
  north set, `sun_rule != "never"` and facing inside `SUNSET_FACING`.
- `discovery.py`: `FEATURES` gains `"sunset"`; `_card` adds `sunset` / `sunset_in_stay` from
  `sun_times` (no DB access, pure maths per card).
- `staff_floor.py` `floor`: adds `weather` and `rain_plan` per booking; calls `rain_plan.withdraw_for`
  on move and on status `cancelled`/`no_show`.
- `manage_flow.py`: calls `rain_plan.withdraw_for` in `change_booking` and `cancel_booking`.
- `emails.py`: `queue_rain_offer(session, venue, booking, offer, link)`.
- `profiles.py`: profile read/patch includes `rain_plan_enabled`; patch refuses `true` without an
  outdoor room (422 "Add an outdoor room first.").

### 8.6 `mail/restaurant_templates.py` (shared module, additive only)

`rain_offer_email(facts: RainOfferFacts) -> EmailParts`: pure, values pre-formatted, the button
link in HTML and the plain link in text. No change to existing templates or event emails.

### 8.7 Cron

`.github/workflows/email-cron.yml` gets a first step "Refresh weather and rain plans" that POSTs
`${SEATPLAN_URL}/api/internal/weather/process` with the same `X-Cron-Secret`, `--max-time 40`, and
`continue-on-error: true` so a weather failure never blocks email. The existing email step runs
after it, so an offer queued in the same run is sent in the same run. Same secrets; no new ones.

## 9. Frontend

| File | Change |
|---|---|
| `src/api/restaurant.ts` | `getWeather`, `getSunset`, `acceptRainOffer(manageToken)`, `declineRainOffer(manageToken)`, `getRainOfferByLink(offerToken)`, `acceptRainOfferByLink`, `declineRainOfferByLink`; types `WeatherAnswer`, `SunsetAnswer`, `RainOfferView`; `BookingView.rain_offer`; `StaffBooking.rain_plan`; map ambience `weather_phrase`, `outdoor` |
| `src/api/discovery.ts` | `FeatureKey` adds `"sunset"`; card `sunset`, `sunset_in_stay` |
| `src/api/owner.ts` | profile `rain_plan_enabled`, `can_rain_plan`, `sunset_tables` |
| `src/pages/restaurant/weatherView.ts` (new, pure) | sky words, service lines, advice, credit, `sunsetTags(slots, answer)`, demo label |
| `src/pages/restaurant/WeatherStrip.tsx` (new) | section 5.1 strip |
| `src/pages/restaurant/SunsetPanel.tsx` (new) | chip panel, "Choose 16:30" calls the existing `onPick` path |
| `src/pages/restaurant/WeatherCredit.tsx` (new) | the CC BY credit link |
| `src/pages/restaurant/StepTime.tsx` | strip, Sunset chip, tags on `SlotButton` |
| `src/pages/restaurant/SlotButton.tsx` | optional `tag` prop ("Sunset") |
| `src/pages/restaurant/prefs.ts` | option `{ key: "sunset", label: "Sunset view", words: "sunset view" }` |
| `src/pages/restaurant/TablePanels.tsx`, `ambienceView.ts` | weather line on the ambience card |
| `src/pages/restaurant/StepDetails.tsx` | the one rain plan notice line for outdoor holds |
| `src/pages/restaurant/RainPlanCard.tsx` (new) | section 5.4 card |
| `src/pages/restaurant/RainOfferPage.tsx` (new) | route `/b/rain/:token` |
| `src/pages/restaurant/ManageBookingPage.tsx` | renders `RainPlanCard` when `rain_offer` is present |
| `src/pages/restaurant/StaffFloor.tsx`, `FloorLists.tsx`, `StaffWeatherBanner.tsx` (new) | section 5.5 |
| `src/pages/discover/discoverModel.ts`, `FilterDrawer.tsx` (`QUICK_FEATURES`), `discoveryState.ts`, `RestaurantCard.tsx` | Sunset chip and card line |
| `src/pages/owner/ProfileForms.tsx`, `ProfilePage.tsx` | Weather section |
| `src/App.tsx` | `<Route path="/b/rain/:token" element={<RainOfferPage />} />` placed before `/b/:token` |
| `src/pages/restaurant/restaurant.css`, `when.css`, `staff.css` | styles using tokens only |

The restaurant theme is light only; all new colours are tokens from `restaurant-theme.css`; run
`npm run contrast`. No new dependency.

## 10. Security, privacy and abuse limits

Security
- No public endpoint accepts coordinates. Forecasts are only for a published venue's own stored
  location, so the API cannot be used as a free weather proxy.
- External calls: at most one per cell per hour on success, a 20 s single-flight lease, exponential
  back-off on failure, and a global cap `WEATHER_MAX_FETCHES_PER_HOUR` (default 200, well under
  5,000/hour). Diner requests only fetch on a cache miss and wait at most 2.5 s, then fall back.
- `parse_open_meteo` treats the response as untrusted: bounded lengths, finite numbers, clamped
  ranges; nothing from it is rendered as HTML.
- The API key never appears in logs, errors, `repr`, the database or the repository.
- Offer token: `new_token()` (random), stored only as `hash_token`, compared by looking up the hash
  (same as manage tokens), single purpose, expires with the offer, hash cleared when the offer ends.
  Unknown and ended tokens both answer 404.
- GET never changes state (mail link scanners). Accept and decline are POST, idempotent on status.
- Accepting rechecks everything server side (status, expiry, unchanged window, hold still live,
  UNIQUE `table_slots`): double booking stays impossible.
- The cron endpoint uses `_check_cron_secret` (constant time; empty secret refuses everyone) and a
  30/min rate limit.
- Staff withdraw uses the existing staff access rule (`venue_access`).

Privacy (GDPR)
- Data minimisation: Open-Meteo receives only a rounded business location (about 2 km cell), never
  a diner's data or IP. Forecast rows hold no personal data.
- Lawful basis: the rain offer is a service message about an existing booking (performance of the
  contract, Art. 6(1)(b)), not marketing; one email per booking at most; the diner can decline.
  The details step tells terrace diners in advance (section 5.2 copy). Update
  `docs/user-guide-diner.md` and the privacy text with the same sentence.
- Retention: `rain_offers` rows deleted 30 days after the booking date (same horizon as
  `mail/outbox.RETENTION_DAYS`); token hash cleared when the offer ends; the email link is removed
  from the finished outbox row by `redact_links` (its pattern is extended to cover the
  `/b/rain/<token>` shape; without that change the token would survive redaction). `rain_offers` cascades
  when a booking is deleted. Forecast cells unused for 7 days are deleted.
- The offer page never shows name, email, phone or notes. Audit rows carry ids and table ids only.

Abuse and caps
- Public weather and sunset reads share the existing `r-read` budget (120/min/IP).
- Offer link routes: 30/min/IP (`b-rain`), like `MANAGE_LIMIT`.
- Rain holds: at most `max(1, indoor_tables // 4)` tables per slot per venue, at most 4 h, ending at
  least 60 min before the booking; one offer per booking ever; at most 20 offers per venue and 60
  in total per cron run.
- Diner holds (`check_hold_caps`) are unchanged; rain holds use the `rain:` holder prefix so they
  never count against a diner's own three holds.

## 11. Tests

Pytest (backend/tests), tests first for pure logic and security:

- `test_weather_rules.py`: `test_sixty_percent_is_wet`, `test_half_millimetre_is_wet_at_low_probability`,
  `test_thunderstorm_code_is_storm`, `test_cloud_cover_bands`, `test_stay_outlook_first_wet_hour_is_local_time`,
  `test_stay_outlook_none_without_hours`, `test_clouds_never_raise_a_sun_claim`, `test_clear_sky_keeps_astronomical_sun`,
  `test_service_summary_advises_indoor_only_with_terrace`.
- `test_weather_phrases.py`: `test_day_word_today_tomorrow_and_date`,
  `test_terrace_sunny_sentence_exact_copy` ("Tomorrow at 13:00 the terrace will be sunny"),
  `test_two_outdoor_rooms_use_room_name`, `test_rain_sentence_recommends_indoor`
  ("Rain expected at 20:00: indoor tables recommended"), `test_showers_sentence_has_probability`,
  `test_sunset_weather_sentences`.
- `test_open_meteo_provider.py`: `test_parse_valid_fixture`, `test_parse_rejects_mismatched_lengths`,
  `test_parse_rejects_non_finite_and_oversized`, `test_request_sends_only_cell_coordinates`
  (httpx `MockTransport`), `test_paid_key_uses_customer_host`, `test_errors_and_repr_never_contain_key`,
  `test_timeout_raises_weather_unavailable`, `test_default_provider_is_demo`.
- `test_weather_cache.py`: `test_cell_rounding_shares_neighbours`, `test_fresh_cache_makes_no_http_call`,
  `test_concurrent_misses_fetch_once` (threads + lease), `test_failure_serves_stale_up_to_six_hours`,
  `test_backoff_grows_and_caps`, `test_out_of_range_date_never_fetches`, `test_global_cap_serves_stale`,
  `test_purge_drops_unused_cells`.
- `test_sunset.py`: `test_lisbon_sunset_azimuth_reference` (18 Nov 2026 17:22, about 246 degrees),
  `test_west_window_sees_sunset`, `test_north_west_340_window_misses_november_sunset`,
  `test_never_rule_blocks_sunset`, `test_between_rule_must_include_sunset`,
  `test_best_start_puts_sunset_inside_meal`, `test_before_opening_reason`, `test_after_closing_reason`,
  `test_polar_day_has_no_starts`.
- `test_sunset_api.py`: `test_miradouro_recommends_west_tables`, `test_sunset_pref_reorders_recommendation`,
  `test_sunset_before_dinner_explains`, `test_unknown_pref_still_422`, `test_sunset_reads_rate_limited`.
- `test_weather_api.py`: `test_weather_demo_source_labelled`, `test_weather_unlocated_venue`,
  `test_weather_endpoint_takes_no_coordinates`, `test_draft_venue_is_404`,
  `test_map_weather_phrase_only_for_outdoor_and_sunny_tables`, `test_map_without_forecast_unchanged`.
- `test_rain_plan.py`: `test_offer_for_terrace_booking_when_rain_forecast`, `test_no_offer_for_indoor_booking`,
  `test_no_offer_when_dry`, `test_no_offer_when_venue_disabled`, `test_one_offer_per_booking_under_two_concurrent_runs`,
  `test_offer_keeps_accessibility_and_high_chairs`, `test_no_table_records_staff_only_row_without_email`,
  `test_rain_hold_share_cap`, `test_rain_hold_not_counted_as_diner_hold`, `test_accept_moves_booking_and_consumes_hold`,
  `test_accept_after_expiry_is_409`, `test_accept_after_booking_changed_is_409`, `test_accept_twice_is_idempotent`,
  `test_decline_releases_hold`, `test_change_and_cancel_withdraw_offer`, `test_staff_withdraw_requires_staff`,
  `test_offer_link_get_never_changes_state`, `test_wrong_and_ended_tokens_are_same_404`,
  `test_offer_page_hides_name_email_phone`, `test_offer_email_link_redacted_after_send`,
  `test_offers_deleted_thirty_days_after_date`.
- `test_weather_cron.py`: `test_weather_process_requires_cron_secret`, `test_empty_secret_refuses`,
  `test_weather_process_stops_at_deadline`, `test_weather_process_idempotent`.
- `test_core_holds_expiry.py`: `test_take_hold_default_expiry_unchanged`, `test_take_hold_custom_expiry`.
- `test_outbox_redaction_rain.py` (written first, security): `test_rain_offer_link_fully_redacted`
  (no token characters left after `[personal link removed]`), `test_event_and_manage_links_redacted_as_before`.
- `test_features_sunset.py`: `test_sunset_feature_from_west_window`, `test_sunset_feature_from_outdoor_room`,
  `test_no_sunset_feature_without_north`, `test_never_rule_window_has_no_sunset_feature`.
- `test_migrate_weather.py`: `test_migrate_adds_rain_plan_column_and_tables_twice_safely`.
- Existing `test_discovery.py`, `test_table_ambience.py`, `test_ambience_view.py`: extended, never
  weakened.

Vitest (frontend):
- `pages/restaurant/__tests__/weatherView.test.ts`: "describes a sunny lunch", "flags rain from the first wet hour",
  "advises indoor only with a terrace", "tags sunset times", "labels simulated weather".
- `pages/restaurant/__tests__/SunsetPanel.test.tsx`: "shows sunset time, best time and west tables",
  "explains when the sun sets before opening", "Choose 16:30 picks that time", "chip is a toggle with aria-pressed".
- `pages/restaurant/__tests__/RainPlanCard.test.tsx`: "shows the held table and until when", "Move me inside accepts and confirms",
  "Keep my terrace table declines", "expired offer reads calmly", "409 keeps the terrace booking".
- `pages/restaurant/__tests__/RainOfferPage.test.tsx`: "never shows personal details", "unknown link shows the ended message".
- `pages/discover/discoverModel.test.ts`: "Sunset view chip sends features=sunset"; `DiscoverPage.test.tsx` fixtures gain `sunset`.
- `pages/owner/ProfileForms.test.tsx`: "rain plan switch disabled without an outdoor room".

Playwright (`frontend/e2e/restaurant-weather.spec.ts`, backend started with `WEATHER_DEMO_SCENARIO=rain-evening`
and a test `CRON_SECRET`):
- "time step shows the weather strip, credit and Sunset chip at 1440 and 390".
- "sunset chip at Miradouro 7 recommends 16:30 and stars a west window table".
- "terrace booking at Tagus Terrace receives a rain offer from the cron and moves inside with one tap"
  (reads the offer link from the outbox the way `guest-account.spec.ts` reads its email).
- `accessibility.spec.ts`: axe on the manage page with the rain card and on `/b/rain/:token`.

## 12. Files touched

New (backend): `app/ambience/weather.py`, `app/ambience/sunset.py`, `app/weather/__init__.py`,
`app/weather/providers.py`, `app/weather/cache.py`, `app/weather/READ_ME_FIRST.md`,
`app/restaurant_service/weather_view.py`, `app/restaurant_service/sunset_view.py`,
`app/restaurant_service/rain_plan.py`, `app/routers/weather.py`, `app/seed/refresh_features.py`,
the test files of section 11, `tests/fixtures/open_meteo_lisbon.json`.

Changed (backend): `app/models.py`*, `app/seed/migrate.py`*, `app/config.py`*, `app/main.py`*,
`app/core/holds.py`* (additive keyword), `app/ambience/phrases.py`, `app/ambience/table.py`,
`app/ambience/READ_ME_FIRST.md`, `app/restaurant_service/availability.py`*, `map_view.py`*,
`features.py`*, `discovery.py`*, `holding.py`*, `manage_flow.py`*, `staff_floor.py`*, `emails.py`*,
`profiles.py`*, `READ_ME_FIRST.md`, `app/routers/bookings.py`*, `app/routers/staff.py`*,
`app/routers/owners.py`*, `app/routers/READ_ME_FIRST.md`, `app/mail/restaurant_templates.py`*
(additive), `app/mail/outbox.py`* (shared with events: `_PERSONAL_LINK` gains the optional
`rain/` segment only), `app/mail/READ_ME_FIRST.md`, `app/seed/demo_showcase.py`*, `app/seed/READ_ME_FIRST.md`.

New (frontend): `pages/restaurant/weatherView.ts`, `WeatherStrip.tsx`, `SunsetPanel.tsx`,
`WeatherCredit.tsx`, `RainPlanCard.tsx`, `RainOfferPage.tsx`, `StaffWeatherBanner.tsx`, tests,
`e2e/restaurant-weather.spec.ts`.

Changed (frontend): `src/App.tsx`*, `src/api/restaurant.ts`*, `src/api/discovery.ts`*,
`src/api/owner.ts`*, `pages/restaurant/StepTime.tsx`*, `SlotButton.tsx`, `prefs.ts`*,
`TablePanels.tsx`*, `ambienceView.ts`*, `StepDetails.tsx`*, `ManageBookingPage.tsx`*,
`StaffFloor.tsx`*, `FloorLists.tsx`*, `restaurant.css`*, `when.css`, `staff.css`*,
`pages/restaurant/READ_ME_FIRST.md`, `pages/discover/discoverModel.ts`*, `FilterDrawer.tsx`*,
`discoveryState.ts`*, `RestaurantCard.tsx`*, `READ_ME_FIRST.md`, `pages/owner/ProfileForms.tsx`*,
`ProfilePage.tsx`*, `READ_ME_FIRST.md`, `e2e/accessibility.spec.ts`*, `e2e/READ_ME_FIRST.md`.

Other: `.github/workflows/email-cron.yml`* (one step), `docs/user-guide-diner.md`,
`docs/user-guide-staff.md`, `docs/user-guide-owner.md`, `docs/api.md`, `docs/data-model.md`,
`docs/security.md`, `docs/runbook.md`, `docs/deployment.md`, `docs/email.md`.

`*` = shared with other restaurant features in flight (expect merge conflicts; land this feature's
`models.py`/`migrate.py` lines as one small first commit). Not touched: `vercel.json` (no CSP
change: the browser never calls a weather host), any events path, `pages/room-editor/`.

## 13. Rollout and demo data

Order of commits (each green on its own):
1. Pure engine: `ambience/weather.py`, `ambience/sunset.py`, phrases, tests.
2. Provider and cache (`app/weather/`), config, model + migration, tests.
3. Read paths: `/weather`, `/sunset`, map weather, `sunset` pref and feature, discovery chip.
4. Rain plan: holds keyword, `rain_plan.py`, routes, emails, manage/offer pages, staff, owner switch.
5. Cron step, e2e, docs.

Feature switches: weather is on everywhere once deployed but uses the demo provider until
`WEATHER_PROVIDER=open-meteo`. The rain plan is per restaurant (`rain_plan_enabled`, default off).

Demo seeding (`seed/demo_showcase.py`, `DEMO_MODE` only):
- Tagus Terrace and Pátio das Laranjeiras: `rain_plan_enabled = True`.
- Miradouro 7: an extra service "Aperitivo" 16:00-18:30 every day (cap 12) so the sunset works
  in winter (sunset 17:20 in late November).
- Demo bookings: one terrace booking at Tagus Terrace tomorrow at 20:00 for 4 on Q4 (fictional
  `@example.com` diner), so `WEATHER_DEMO_SCENARIO=rain-evening` plus "Run workflow" shows the whole
  rain plan in a live demo.
- `python -m app.seed.refresh_features`: recomputes `venues.features` for every venue (adds
  `sunset`); idempotent; run once after the deploy, also safe on the 20 Lisbon catalogue venues.

Production steps (team rule): back up the database, run `python -m app.seed.migrate`, then
`python -m app.seed.refresh_features`, then merge (GitHub Actions deploys on push to `main`).

## 14. What Martim must do (accounts, cost, legal)

1. Decide commercial status. While SeatPlan has no ads, subscriptions or paying restaurants, the
   free Open-Meteo API is allowed; once it is a commercial product, subscribe to "API Standard"
   (fixed monthly price, 1M calls/month; check the current price at open-meteo.com/en/pricing) and
   set `OPEN_METEO_API_KEY` in Vercel. Expected volume: about 20 cells x 24 h = under 500 calls/day.
2. Set `WEATHER_PROVIDER=open-meteo` in Vercel only when he wants real weather (demo is the default).
3. Keep the CC BY 4.0 credit ("Weather data by Open-Meteo.com") wherever forecasts are shown,
   including the rain email. No other legal text is needed for Open-Meteo.
4. Approve the privacy wording for the rain plan (section 5.2 and 10) and add it to the privacy page.
5. Nothing new in GitHub secrets: the cron reuses `SEATPLAN_URL` and `CRON_SECRET`.

## 15. Open decisions (recommended default in bold)

1. Open-Meteo plan: **demo provider now; free tier for the non-commercial demo; paid Standard plan
   before any commercial launch.**
2. Rain plan default for a restaurant: **off; owner switches it on (demo restaurants on).**
3. How long to hold the indoor table: **up to 4 hours, ending at least 60 minutes before the booking.**
4. Rain threshold: **60% probability or 0.5 mm in any hour of the stay.**
5. Awning-covered terrace tables: **still offered an indoor table (an awning is not a roof).**
6. No indoor table free: **no diner email; staff see "no indoor table free".**
7. Tighten the existing "Sunset ... from your seat" rule with the real sunset azimuth (70 degrees):
   **yes**, it makes an existing promise honest.
8. Outdoor rooms count as seeing the sunset without a horizon setting: **yes for now; revisit when
   the room editor (Sergio) can mark a blocked horizon.**
9. Discovery "Sunset view" chip: **static feature (has sunset tables) plus the day's sunset time on
   the card**, not date-specific filtering.
10. Offers per booking: **one, ever, in v1.**
11. Cron: **a new first step in the existing email-cron workflow**, not a separate workflow.
12. Show "Simulated weather (demo)" whenever the demo provider answers: **yes, always.**

## 16. Risks

- R1. GitHub Actions schedules can be late or skipped; offers may arrive late. Mitigated by the 30 h
  horizon and "Run workflow"; the diner can always change via the manage link.
- R2. The 30 s Vercel limit: cron deadline 20 s, at most 10 fetches of 2.5 s, commit per offer.
- R3. Long rain holds reduce availability for others: 25% indoor cap, 4 h maximum, released on
  decline, change, cancel or expiry.
- R4. Forecasts are wrong sometimes: the plan only offers, the copy says "expected" with the
  percentage, and nothing moves without the diner's tap.
- R5. Licence: commercial use of the free tier breaks Open-Meteo's terms; attribution is mandatory.
- R6. Tightening `_sees_sunset` changes existing ambience output. If an existing test asserts a
  sunset for a window more than 70 degrees from the real azimuth, do not weaken it: keep the old
  rule in `table.py` and apply the azimuth check only in `ambience/sunset.py` and the `sunset`
  wish, and record the decision.
- R7. Adding `"sunset"` to the features dict and `FeatureKey` touches tests that assert the exact
  dict; extend them additively.
- R8. `core/holds.py` is shared with events: only an optional keyword; a test pins the default.
  `mail/outbox.py` is shared too: the redaction pattern only widens (optional `rain/` segment), and
  a test pins that event and manage links are redacted exactly as before.
- R9. Many shared files (`models.py`, `migrate.py`, `map_view.py`, `StepTime.tsx`, `App.tsx`) are
  edited by parallel features: land the schema lines first and rebase often.
- R10. Time zones: the forecast is in UTC; every comparison goes through `clock.py` and the venue
  time zone (DST nights covered by tests).
