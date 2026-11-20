# Natural-language search, access and noise: design

Date: 2026-11-17. Status: design only, nothing implemented. Branch base: `codex/restaurantes-ux`.
Mockup: `search-accessibility.html` (scratchpad `features/`), desktop and a 390 px phone side by side.

This feature has two halves that meet on the discovery page:

1. **Describe your table.** The diner types something like *"quiet table for 4 tomorrow at 20h in
   Chiado under 30 euros"* or *"mesa com esplanada para 2 hoje à noite"*. A deterministic parser
   (English and Portuguese, no LLM) turns it into the filters SeatPlan already has, and shows them back
   as chips the diner can change or remove. An LLM can be plugged in later behind a provider interface,
   switched on only by environment variables.
2. **Access and noise.** The owner states step-free entrance, accessible toilet and a step-free route to
   each room, and can confirm or correct the noise level of each table. SeatPlan estimates that noise level
   from the Quiet zone and the distance to the bar, kitchen and other busy fixtures that the floor plan
   already has. Diners get two new filters, **Quiet tables** and **Step-free entrance**, and the table card
   says how quiet the table is and whether the way there is step-free.

---

## 1. What exists today (verified in the code)

| Area | What is there | Where |
|---|---|---|
| Search | `GET /api/restaurants` with `q` (max 80 characters, every word must appear in the name and cuisines, compared with `fold()`), `cuisine[]`, `price[]` (1–4), `features[]` (`sun`, `view`, `accessible`, `terrace`), `lat`/`lng`, and `date`+`time`+`party` (all three or none), `available`, paging | `backend/app/routers/discovery.py` `search()`, `backend/app/restaurant_service/discovery.py` `Search`, `fold`, `distance_m`, `_matches`, `next_times`, `search_restaurants` |
| Venue features | `venues.features` JSON, worked out from the saved rooms by `compute_features` and refreshed on every room save (`rooms.save`) and on publish | `restaurant_service/features.py` `compute_features`, `refresh_features` |
| Noise inputs | Fixture kinds `bar, kitchen, wc, column, stairs, plant, stage, fireplace, tv, host_stand, awning`; zone kinds `general, window, terrace, bar, quiet, vip, accessible, stage`; main-entrance doors | `routers/owner_rooms.py` `FixtureIn`, `ZoneIn`; `models.py` `RoomFixture`, `Zone`, `RoomOpening.is_main_entrance` |
| Quiet today | The ambience engine calls a table "quiet" when no `bar, kitchen, wc, stage, tv` or main entrance is within 5 m (`QUIET_DISTANCE`), "near" within 3 m (`NEAR_DISTANCE`); sentence "In a quiet corner". It needs coordinates, because `ambience_payload` returns no tables without `lat`/`lng` | `ambience/table.py` `_busy_distances`, `table_ambience`, `BUSY_KINDS`; `ambience/phrases.py` `near_phrase`; `restaurant_service/ambience_view.py` `ambience_payload`, `table_features` |
| Wishes | The diner can tick `sun, shade, view, quiet, away_from_wc` (`PREF_KEYS`, `clean_prefs`); the optimiser prefers matching tables | `restaurant_service/availability.py`; `frontend/src/pages/restaurant/prefs.ts` |
| Accessible | `tables.is_accessible`, `seats.is_accessible`; `PartyNeeds.needs_accessible` ("Someone needs an accessible table", hint "Step-free access and room for a wheelchair"); `map_view.fit_problem` blocks a non-accessible table | `models.py`, `map_view.py`, `StepParty.tsx` |
| Price | `venues.price_level` 1–4. The owner form explains the bands: € under 15 €, €€ 15–30 €, €€€ 30–60 €, €€€€ over 60 € per person | `frontend/src/pages/owner/ProfileForms.tsx` |
| Places | No neighbourhood column. Frontend `CITIES` has fixed coordinates; the search sorts by distance from a place but never cuts off by distance | `frontend/src/pages/discover/discoverModel.ts` |
| Discovery UI | One search field "Restaurant or cuisine" (300 ms pause), quick chips (`sun`, `view`, `terrace`), drawer with Accessibility ("Wheelchair-accessible table"), cuisine, price, availability; removable "Active filters" chips | `DiscoverPage.tsx`, `DiscoverBar.tsx`, `FilterDrawer.tsx`, `Chips.tsx` |
| Table card | Room, zone, view, light, seats, "Why this table" | `frontend/src/pages/restaurant/TableCard.tsx`, `tableView.ts` |
| Booking link | `/restaurants/<slug>?date=&time=&party=` starts the flow; `LinkAnswers` has `date`, `party`, `time` only | `restaurant/useBookingFlow.ts` `startNeeds`, `BookingPage.tsx` line 96, `useLinkedTime.ts` |

Two facts shape the design:

- **The room editor echoes every column back.** `rooms.view()` returns every column of `rooms` and
  `tables`, the editor sends the objects back with `...room` (`frontend/src/api/rooms.ts` `roomPayload`),
  and `RoomIn` / `TableIn` refuse unknown fields (`extra="forbid"`). A new column on `rooms` or `tables`
  would therefore make every editor save fail with 422 until Sergio's editor and `owner_rooms.py` change.
  **So access and noise live in three new tables, never as new columns on `rooms` or `tables`.**
  No change to `frontend/src/pages/room-editor/` is needed.
- **The room editor no longer has a wheelchair field** (`room-editor/READ_ME_FIRST.md`: "there are no ...
  wheelchair, high-chair ... fields"). New restaurants therefore can never get an accessible table today.
  The new owner page fills that gap (decision D3).

---

## 2. Goal and user stories

**Goal.** Let a diner say what they want in their own words, in English or Portuguese, and find a
restaurant and a table that is quiet enough and that they can physically reach, with every claim either
stated by the restaurant or worked out honestly from its floor plan.

### Diner
- D1. As a diner, I type "quiet table for 4 tomorrow at 20h in Chiado" and see the chips *4 people*,
  *Tomorrow · 20:00*, *Quiet tables*, *In Chiado* before I commit, so I know what the search understood.
- D2. As a Portuguese speaker, I type "esplanada para 2 hoje à noite" and get *2 people*, *Tonight · 20:00*,
  *Terrace*.
- D3. As a diner, I can remove a chip or change it (open the party, date, place or filter control) without
  retyping the sentence.
- D4. As a wheelchair user, I filter on *Step-free entrance* and *Wheelchair-accessible table* and only see
  restaurants that say so; the times shown are for an accessible table in a room I can reach.
- D5. As someone who wants a calm dinner, I filter on *Quiet tables*; when I open a restaurant the quiet
  wish is already ticked, and the table card says "Quiet table" and why.
- D6. On the public restaurant page I read an "Access" section that says plainly what the restaurant
  stated and what it did not.

### Owner
- O1. As an owner, on one page I answer: step-free entrance, accessible toilet, a step-free route to each
  room, and a short note, each with "Not sure" allowed.
- O2. I see the noise level SeatPlan estimated for every table and the reason ("1.2 m from the bar"), and
  can override it.
- O3. I can mark which tables have wheelchair space (the editor no longer can).

### Staff
- S1. As a host, when I seat a walk-in or move a booking that needs an accessible table, SeatPlan does not
  suggest a table in a room the owner marked as not step-free (this comes for free through the optimiser's
  `TableSpec.accessible`, no staff UI change).

---

## 3. Non-goals

- No LLM in this release. Only the interface, the `rules` provider and the reserved settings (section 9).
- No free-text storage: search text is never written to the database or the log.
- No negative filters ("not on the terrace"). Negations are dropped, except the fixed positive phrases
  "no steps", "sem degraus", "not noisy", "nada barulhento".
- No quiet-aware availability in search results. With *Quiet tables* and a time, the card times are for any
  table; the booking flow then prefers a quiet one (wish `quiet`). A follow-up can add it.
- No neighbourhoods outside Lisbon, no city other than Lisboa in the parser (the city picker stays).
- No decibel measurements, no diner noise reports, no review-derived noise.
- No change to the room editor, the events vertical, emails or the staff UI.
- No access facts for the 20 Lisbon catalogue restaurants: they are real businesses and SeatPlan must not
  invent facts about them (section 13).

---

## 4. UX flow and exact copy

All text in English. Theme: `frontend/src/design/restaurant-theme.css` (white, lavender `#F8F7FC`,
purple `#4F3F8F`, one pink `#B0347A` main button per screen, bold sans-serif headings). Words, never
icons or colour alone.

### 4.1 Discovery: describe your table (`/`)

**Search field** (in `DiscoverBar.tsx`)
- Visible label (visually hidden on wide, as today): **"Search restaurants or describe your table"**
- Placeholder: **"Try “quiet table for 4 tonight in Alfama”"**
- `maxLength` 140 (was 80).

**While typing** (300 ms pause, as today) the page asks the server with `understand: true`
(section 6.1). Results update live with the parsed filters applied server-side, and a preview row appears
under the bar when the parser recognised at least one thing:

```
We understood:  [4 people] [Tomorrow · 20:00] [Quiet tables] [In Chiado] [Under €30 a person]
Also searching names for “lumen”.                       [Use these]   or press Enter
```

- Row label: **"We understood:"**
- Leftover words line (only when there are some): **"Also searching names for “{rest}”."**
- Button (secondary, small): **"Use these"**. Hint after it on wide screens: **"or press Enter"**; on a
  phone: **"Tap Search to use these"**.
- The row is `aria-live="polite"` and announces only the joined chip labels, at most once per pause.
- Warnings in the row (muted text with a "Note:" prefix):
  - party above the online maximum: **"Note: online booking is for up to 30 people. Larger groups should call the restaurant."** (party chip is not added)
  - a time already past today: **"Note: 20:00 has passed today, so we used tomorrow."**
  - a date more than a year ahead: **"Note: we can search up to a year ahead."** (date chip not added)

**Use these / Enter / Search key** converts the understood values into the page's normal state:
party select, date, time, place (neighbourhood centre + radius), features, cuisines, prices. The search
box keeps only the leftover words. Focus moves to the results heading, as today. A visually hidden status
says: **"Search filters applied. You can change or remove each one."**

**Active filters row** (existing `discover-active`, extended). Each chip is two buttons: the label
(edits) and × (removes).

| Chip | Label | Edit opens | Remove aria-label |
|---|---|---|---|
| Party | "4 people" / "1 person" | party control (bar capsule on wide, drawer on phone) | "Remove 4 people" |
| When | "Tonight · 20:00", "Today · 13:00", "Tomorrow · 20:00", "Sat 21 Nov · 20:00" | date input | "Remove the date and time" |
| Place | "In Chiado" | place control | "Remove In Chiado" |
| Cuisine | "Seafood" | drawer, Cuisine open | "Remove Seafood" (exists) |
| Price | "Under €30 a person" when it came from words; "€€" when picked | drawer, Price open | "Remove Under €30 a person" |
| Feature | labels in 4.2 | drawer | "Remove Quiet tables" |

Edit aria-label: **"Change {label}"**. "Tonight" is used when the date is today and the time is 17:00 or
later; otherwise "Today".

**Empty states** keep their wording. When the parser applied filters and nothing matches, the existing
"No restaurants match" state shows the action **"Remove the last filter"** (removes the most recently
added chip) next to "Edit filters".

### 4.2 Discovery filters

Drawer (`FilterDrawer.tsx`):

- "Room features": **Has sunny tables**, **Tables with a view**, **River view**, **Terrace**,
  **Window tables**, **Quiet tables**. Note under the group: **"Quiet tables are estimated from the floor
  plan or set by the restaurant."** (the sunlight note stays).
- "Accessibility": **Step-free entrance**, **Wheelchair-accessible table** (exists), **Accessible toilet**.
  Note: **"Stated by each restaurant. If a detail matters to you, call ahead."** (replaces "High chair
  requests are available when booking.", which moves under the party control.)
- Quick chips on wide screens (`QUICK_FEATURES`): `sun`, `view`, `terrace`, **`quiet`**, **`step_free`**.

Restaurant card (`RestaurantCard.tsx`): the ambience line gains "Quiet tables"; a second line, only when
stated, reads **"Step-free entrance · Accessible toilet"**. When the diner filtered on `quiet` or
`step_free`/`accessible`, the card's time links carry them on (section 7.4).

### 4.3 Public restaurant page: Access section (`/restaurants/:slug`)

Heading **"Access"**. A definition list:

| Row | Values |
|---|---|
| **Entrance** | "Step-free" / "Has steps" / "Not stated" |
| **Toilet** | "Accessible toilet" / "No accessible toilet" / "Not stated" |
| **Rooms** | "Step-free route to: River hall, Quay terrace" and/or "Steps on the way to: Mezzanine" |
| **Wheelchair space** | "At 3 tables" / "Not stated" |
| **Quiet tables** | "5 of 13 tables" (only when known) |

Then the owner's note in quotes, then **"Stated by {restaurant name}. Last updated {14 Nov 2026}."**
When nothing is stated: **"{Name} has not added access details yet. Call {phone} to ask."** (without a
phone: "... yet. Ask the restaurant before you book.").

### 4.4 Booking flow: table card (`TableCard.tsx`)

New facts in `rb-table-facts`, with a small line icon and words:

| Noise | Text | Under "Why this table" |
|---|---|---|
| quiet | **"Quiet table"** | "Set by the restaurant" / "In the Quiet area" / "At least 5 m from the bar, kitchen and toilets" |
| moderate | **"Some background noise"** | "4 m from the toilets" |
| lively | **"Lively spot"** | "1.2 m from the bar" / "In the bar area" |
| unknown | nothing | nothing |

| Route | Text |
|---|---|
| room route true (or single room with step-free entrance) | **"Step-free from the entrance"** |
| room route false | **"Steps on the way to this room"** |
| unknown | nothing |

When the party needs an accessible table and the room route is false, the table is "blocked" and the
existing reason line reads **"Not reachable without steps"** (new reason in `tableView.unavailableReason`).

### 4.5 Owner: Access and noise (`/owner/:venueId/access`)

New step in the owner menu between "Floor plan" and "Review and publish": **"Access and noise"**.

- H1 **"Access and noise"**. Intro: **"Tell diners how easy it is to get in and how lively each table is.
  Only say what you know: “Not sure” is always fine."**
- Card **"Entrance"**. Question: **"Can someone in a wheelchair get from the street to your door without
  steps?"** Radios: **"Yes, step-free"**, **"No, there are steps"**, **"Not sure"**.
- Card **"Toilet"**. Question: **"Is there a toilet that a wheelchair user can use?"** Radios: **"Yes"**,
  **"No"**, **"Not sure"**.
- Field **"Note for diners (optional)"**, 200 characters, hint: **"For example: “Portable ramp at the side
  door, ask the host.” Do not add names or phone numbers."** Counter "{n} of 200".
- Card **"Rooms"**: one row per saved room: **"{Room}: step-free route from the entrance?"** with
  **"Yes" / "No" / "Not sure"**. A restaurant without saved rooms shows **"Main room: same as the
  entrance."**
- Card **"Tables"**, one table per room. Columns: **"Table"**, **"Our estimate"**, **"Noise"**,
  **"Wheelchair space"**.
  - "Our estimate" text: **"Quiet · in the Quiet area"**, **"Lively · 1.2 m from the bar"**,
    **"Some noise · 4 m from the toilets"**, **"Quiet · at least 5 m from busy spots"**,
    **"Unknown · add the bar or kitchen to the floor plan"** (that last one links to `/owner/:venueId/rooms`).
  - "Noise" select: **"Use our estimate"** (default), **"Quiet"**, **"Some noise"**, **"Lively"**.
  - "Wheelchair space" checkbox, label **"Wheelchair space at {T3}"** (visually hidden), visible tick.
- Footer: pink button **"Save access details"**. Success status: **"Saved. Diners now see these
  details."** Stale layout (409): **"The floor plan changed in another tab. Load the latest and try
  again."** with button **"Load the latest"**.
- Review page (`publishChecklist.ts`): new non-blocking row **"Access and noise"**, state "Recommended"
  until the entrance question is answered, fix label **"Add access details"**.

---

## 5. Data model

Three new tables in `backend/app/models.py` (restaurants section). New tables are created by
`Base.metadata.create_all` in step 1 of `python -m app.seed.migrate`, on SQLite and Postgres alike, so
**`NEW_COLUMNS`, `NEW_INDEXES` and `RESTAURANT_INDEXES` in `seed/migrate.py` do not change**. No column is
added to an existing table. All foreign keys cascade so that `rooms.save` (which bulk-deletes rooms and
tables the owner removed) never hits an integrity error; SQLite has `PRAGMA foreign_keys=ON` in
`db.make_engine`.

```python
class VenueAccess(Base):
    """What the owner stated about getting in. NULL means "not stated"."""
    __tablename__ = "venue_access"
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), primary_key=True)
    step_free_entrance: Mapped[bool | None] = mapped_column(Boolean)
    accessible_toilet: Mapped[bool | None] = mapped_column(Boolean)
    note: Mapped[str] = mapped_column(String(200), default="", server_default=text("''"))
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utc_now)


class RoomAccess(Base):
    """Is there a step-free route from the entrance to this saved room?"""
    __tablename__ = "room_access"
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), index=True)
    step_free_route: Mapped[bool | None] = mapped_column(Boolean)


class TableNoise(Base):
    """The owner's override of the estimated noise of one table."""
    __tablename__ = "table_noise"
    __table_args__ = (
        CheckConstraint("level IN ('quiet', 'moderate', 'lively')", name="ck_table_noise_level"),
    )
    table_id: Mapped[int] = mapped_column(ForeignKey("tables.id", ondelete="CASCADE"), primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id", ondelete="CASCADE"), index=True)
    level: Mapped[str] = mapped_column(String(10))
```

`tables.is_accessible` (existing) is written by the new owner endpoint (decision D3).

`venues.features` (existing JSON) gains keys: `quiet`, `step_free`, `accessible_toilet`, `river_view`,
`window`. Old rows simply lack them (read as false). A new idempotent command
`python -m app.seed.refresh_features` recomputes `features` for every restaurant once after the deploy,
so the Quiet-zone and river-view facts that already exist in saved rooms appear without an owner save.

Migration test: `tests/test_migrate_access_tables.py` starts from the frozen old schema (as
`test_migrate_restaurants.py` does), runs `upgrade_schema` via `db.create_all()` twice, and checks the
three tables, the cascade and that the second run changes nothing.

---

## 6. API

All routes under `/api`. Errors are `{"error": {"code", "message"}}`.

### 6.1 Search with understanding

`GET /restaurants` (existing, `routers/discovery.py`) gains:

| Param | Type | Rule |
|---|---|---|
| `q` | string | `max_length` 140 (was 80) |
| `understand` | bool, default false | parse `q` and apply what it finds |
| `within_m` | int 100–20000 | requires `lat`+`lng`; drops restaurants farther away or without a pin |
| `features` | list | now also `quiet`, `step_free`, `accessible_toilet`, `river_view`, `window` (validated against `discovery.FEATURES`) |

New `POST /restaurants/search`: same fields as a JSON body (`Strict` model, unknown fields 422), same
answer. The frontend uses POST whenever the text is not empty, so free text never sits in a URL, the
browser history or the hosting provider's request log (decision D1). GET stays for links and old clients.

Merge rule when `understand` is true: values parsed from `q` override the same explicit field (they are
the newest thing the diner typed); features and cuisines are unioned; `date`/`time` come with the
explicit `party` (or 2) so the "all three or none" rule still holds; `rest` replaces `q` for the name
match.

Answer (only the new part; `items` and `total` unchanged):

```json
{
  "items": [...], "total": 3,
  "understood": {
    "provider": "rules",
    "rest": "lumen",
    "chips": [
      {"kind": "party", "value": 4, "label": "4 people", "span": [17, 22]},
      {"kind": "when", "value": {"date": "2026-11-18", "time": "20:00"}, "label": "Tomorrow · 20:00", "span": [23, 38]},
      {"kind": "feature", "value": "quiet", "label": "Quiet tables", "span": [0, 5]},
      {"kind": "place", "value": {"key": "chiado", "lat": 38.7106, "lng": -9.1425, "within_m": 500}, "label": "In Chiado", "span": [39, 48]},
      {"kind": "price", "value": [1, 2], "label": "Under €30 a person", "span": [49, 64]},
      {"kind": "cuisine", "value": "seafood", "label": "Seafood", "span": [65, 72]}
    ],
    "notes": ["Note: 20:00 has passed today, so we used tomorrow."]
  }
}
```

`understood` is present only when `understand` is true. `span` is a character range in the original `q`
(used for tests and highlighting; never echoed into HTML unescaped).

Auth: none. Limits: the shared diner read limit `r-read:{ip}` (120 per minute, `READ_LIMIT`).

### 6.2 Owner access

New router `backend/app/routers/owner_access.py`, prefix `/owner/restaurants`, `CurrentOrganiser`,
restaurant loaded with `profiles.load` (owner id + kind + `FOR UPDATE`, else 404).

`GET /owner/restaurants/{vid}/access` →

```json
{
  "base_version": 12,
  "step_free_entrance": true, "accessible_toilet": null, "note": "", "updated_at": "2026-11-14T10:02:00Z",
  "rooms": [
    {"id": 31, "name": "River hall", "step_free_route": true,
     "tables": [{"id": 201, "label": "R1", "is_accessible": false,
                 "estimate": {"level": "lively", "source": "layout", "reason": "1.2 m from the bar"},
                 "override": null}]},
    {"id": null, "name": "Main room", "step_free_route": null, "same_as_entrance": true, "tables": [...]}
  ]
}
```

`PUT /owner/restaurants/{vid}/access` body (`Strict`, unknown fields 422):

```json
{
  "base_version": 12,
  "step_free_entrance": true, "accessible_toilet": null, "note": "Portable ramp at the side door.",
  "rooms": [{"id": 31, "step_free_route": true}],
  "tables": [{"id": 201, "override": "quiet", "is_accessible": true}]
}
```

- `note`: `PlainText`, max 200. `rooms` max 5, `tables` max 1000; ids must belong to this restaurant (else 404 `not_found`, nothing saved).
- `override`: `null | "quiet" | "moderate" | "lively"`.
- Writes `is_accessible`, so the layout version moves with the same atomic compare as `rooms.save`
  (`UPDATE venues SET layout_version = layout_version + 1 WHERE id = :id AND layout_version = :base`);
  mismatch → 409 `stale_layout` "The floor plan changed in another tab. Load the latest and try again."
  An open room editor then gets its own existing stale-layout recovery.
- Then `features.refresh_features`, `publishing.recheck_after_edit` (no-op for valid data), `audit.record(action="access.save")`, `live.bump` of today's scope, one commit. Answer: the GET shape.
- Rate limit: `owner-access:{user.id}` 30 per 60 s.

### 6.3 Existing answers that grow (fields only added, old clients ignore them)

- `GET /r/{vid}/map`: each table gains `"noise": "quiet" | "moderate" | "lively" | null`,
  `"noise_reason": string | null`, `"noise_source": "owner" | "zone" | "layout" | null`,
  `"step_free_route": true | false | null`. Works without coordinates.
- `GET /restaurants/{slug}`: `"access": {"step_free_entrance", "accessible_toilet", "note", "updated_at",
  "rooms": [{"name", "step_free_route"}], "accessible_tables": int, "quiet_tables": int | null,
  "total_tables": int}`; `features` gains the five new keys.
- Search cards: `features` gains the five new keys.

---

## 7. Backend modules and pure functions

### 7.1 New pure package `backend/app/search/` (no database, no HTTP)

| File | Content |
|---|---|
| `READ_ME_FIRST.md` | Purpose, grammar table, how to add a word, walkthrough questions |
| `vocabulary.py` | Frozen word lists, EN and PT, all already folded: `NUMBER_WORDS` (one…twelve, um/uma…doze, "a couple"→2), `PARTY_PATTERNS`, `FEATURE_WORDS` (key → phrases), `CUISINE_WORDS` (every key of `profiles.CUISINES` plus synonyms: tapas→petiscos, marisco/marisqueira→seafood, peixe→fish, tasca/tradicional→portuguese, churrasqueira/grill/steak→steakhouse, ramen/japones→japanese, hamburguer→burgers, veggie/vegetariano→vegetarian, vegano→vegan, ...), `PRICE_WORDS`, `STOPWORDS` (table, mesa, for, para, a, the, uma, um, with, com, in, em, no, na, at, as, restaurant, restaurante, please, por favor, ...) |
| `neighbourhoods.py` | `Neighbourhood(key, label, aliases, lat, lng, within_m)` for about 25 Lisbon neighbourhoods (Alfama, Baixa, Chiado, Bairro Alto, Príncipe Real, Cais do Sodré, Santos, Belém, Alcântara, Graça, Mouraria, Intendente, Arroios, Avenida da Liberdade, Rossio/Restauradores, Saldanha, Avenidas Novas, Campo de Ourique, Estrela, Lapa, São Bento, Parque das Nações, Marvila, Alvalade) plus `Lisboa`/`Lisbon` as a city with no radius. Centres and radii are taken from OpenStreetMap at implementation time (the values in the mockup are approximate) and the source is cited in the file |
| `dates.py` | `resolve_day(words, today) -> date`, `resolve_clock(words) -> time`, `snap_quarter(t)`, `weekday_on_or_after(today, weekday)`; Portuguese and English month and weekday names |
| `parser.py` | `parse(text, today, now) -> Understood` (below) |
| `understanding.py` | `Understander` protocol, `RuleUnderstander`, `LogUnderstander`, later `HttpLlmUnderstander`; `understander_from_settings(settings)` |

`parse` contract (deterministic, pure, `today`/`now` are Lisbon local values passed in):

```python
@dataclass(frozen=True)
class Chip:
    kind: Literal["party", "when", "place", "feature", "cuisine", "price"]
    value: object
    label: str
    span: tuple[int, int]

@dataclass(frozen=True)
class Understood:
    party: int | None
    day: date | None
    at: time | None
    features: tuple[str, ...]          # subset of discovery.FEATURES
    cuisines: tuple[str, ...]          # subset of profiles.CUISINES
    prices: tuple[int, ...]            # subset of 1..4
    place: Neighbourhood | None
    rest: str                          # leftover words, for the name match
    chips: tuple[Chip, ...]
    notes: tuple[str, ...]
```

Steps, in order, each consuming its tokens so a word is never used twice:

1. Normalise: `discovery.fold()` on a copy (lower case, no accents, single spaces), keeping a map back
   to original offsets; `€` becomes ` euros `; "20h30", "8.30pm", "20:30" stay one token. Text over 140
   characters or 30 tokens is cut (the router already refuses longer `q`).
2. **Party**: "for 4", "for four", "party of 6", "table for two", "4 people/persons/pax/guests",
   "para 4", "para quatro", "4 pessoas", "mesa para dois", "a dois", "just me", "so eu" → 1..30. A
   bigger number adds the note and no chip. A bare number next to a time word is a time, not a party.
3. **Time**: "20h", "20h30", "20:30", "8pm", "8 pm", "8.30pm", "at 8", "as 20", "as 8 da noite",
   "noon"/"meio-dia" (12:00), "lunch"/"almoco" (13:00), "dinner"/"jantar" (20:00). A bare hour 1–10 after
   "at"/"as" means pm; 11 and 12 stay. Snapped to the nearest quarter (slots are 15 minutes,
   `restaurant_service/clock.py`).
4. **Day**: "today"/"hoje", "tonight"/"esta noite"/"hoje a noite"/"logo a noite" (today, 20:00 unless a
   time was given), "tomorrow"/"amanha", "tomorrow night"/"amanha a noite", "day after tomorrow"/
   "depois de amanha", weekday names EN/PT ("saturday", "sabado", "sexta", "sexta-feira"; the next
   occurrence on or after today), "next saturday"/"proximo sabado" (strictly after today), "this weekend"/
   "fim de semana" (Saturday, or today on a Saturday or Sunday), "21/11", "21 nov", "nov 21",
   "21 de novembro" (this year, or next year once passed). More than 366 days ahead → note, no chip.
   A day without a time gets 20:00 (the page's `DEFAULT_TIME`). A time without a day means today, or
   tomorrow with the note when it has passed.
5. **Price**: "under/below/less than/up to 30 euros", "ate 30 euros", "menos de 30", "max 30" →
   levels whose upper bound is at most 30 (bands from `ProfileForms.tsx`: 15, 30, 60, ∞) → `(1, 2)`;
   "around 40"/"cerca de 40" → the band containing it; "over 60"/"mais de 60" → `(4,)`;
   "cheap"/"barato"/"budget" → `(1, 2)`; "fine dining"/"fancy"/"requintado" → `(4,)`; "€€" typed → `(2,)`.
   Label from the words: "Under €30 a person", "Around €40 a person", "Over €60 a person",
   "Budget-friendly", "Fine dining".
6. **Place**: "in/near/around X", "em/no/na/perto de X", or the bare alias, matched longest first
   against the gazetteer aliases ("cais do sodre", "cais", "principe real", "bairro alto", "expo" →
   Parque das Nações).
7. **Features**: terrace ("terrace", "terraco", "esplanada", "outdoor", "outside", "ao ar livre",
   "rooftop"); river_view ("river view", "view of the river", "tagus", "tejo", "vista rio", "vista para o
   rio", "sea view", "vista mar"; this also adds `view`); view ("view", "with a view", "vista", "com
   vista"); sun ("sun", "sunny", "sunshine", "sol", "ao sol", "soalheiro"); quiet ("quiet", "calm",
   "not noisy", "calmo", "sossegado", "tranquilo", "silencioso", "nada barulhento"); window ("window",
   "by the window", "janela", "a janela"); step_free ("step-free", "step free", "no steps", "sem
   degraus", "wheelchair", "cadeira de rodas", "mobilidade reduzida"; "wheelchair" also adds
   `accessible`); accessible ("accessible", "acessivel"; adds `accessible` and `step_free`);
   accessible_toilet ("accessible toilet", "accessible bathroom", "wc adaptado", "casa de banho
   adaptada"). A feature preceded within two tokens by "not/no/without/sem/nao" is dropped (except the
   fixed positive phrases above).
8. **Cuisine**: longest synonym first.
9. **Rest**: unconsumed tokens minus `STOPWORDS`, in original spelling, joined by spaces.

Chip order is the order of `kind` above (party, when, place, feature, cuisine, price), never the order
typed, so screen readers hear a stable sentence.

### 7.2 New pure module `backend/app/ambience/noise.py`

```python
NoiseLevel = Literal["quiet", "moderate", "lively"]
LIVELY_KINDS = ("bar", "kitchen", "stage", "tv")           # within NEAR_DISTANCE (300 cm) -> lively
ANCHOR_KINDS = ("bar", "kitchen", "wc", "stage", "tv")     # the room must have one to say anything

@dataclass(frozen=True)
class NoiseEstimate:
    level: NoiseLevel | None
    source: Literal["owner", "zone", "layout"] | None
    reason: str | None          # "1.2 m from the bar", "In the Quiet area", "Set by the restaurant"

def estimate_noise(room: AmbienceRoom, table: AmbienceTable, zone_kind: str | None,
                   override: NoiseLevel | None = None) -> NoiseEstimate
def distance_words(cm: float) -> str   # "1.2 m", "4 m"
```

Order: owner override → zone kind `quiet` (quiet) or `bar`/`stage` (lively) → no anchor fixture in the
room: unknown (never claim quiet in an empty room) → a `LIVELY_KINDS` fixture within `NEAR_DISTANCE`:
lively → any of `BUSY_KINDS` (incl. the main entrance) within `QUIET_DISTANCE`: moderate → quiet. Reuses
`ambience/table.py` `_busy_distances`, made public as `busy_distances` (the old name stays an alias),
and the constants `NEAR_DISTANCE`, `QUIET_DISTANCE`, `BUSY_KINDS`.

`ambience/table.py` `table_ambience` gains one keyword argument `quiet_override: bool | None = None`.
`None` keeps today's behaviour exactly (every existing engine test still passes); otherwise it decides
the `quiet` field, the `quiet` feature and the "In a quiet corner" sentence, so the sentence never
contradicts the noise level.

### 7.3 New service `backend/app/restaurant_service/access.py`

- `load(session, venue) -> AccessFacts` (one query each for the three tables).
- `noise_by_table(session, venue, rooms: list[LoadedRoom] | None = None) -> dict[int, NoiseEstimate]`
  (uses `ambience_view.load_rooms`, `occupancy.zone_kinds`, the overrides). No coordinates needed.
- `route_by_table(session, venue, rooms=None) -> dict[int, bool | None]`: the room's
  `step_free_route`; for a restaurant with a single room (saved or implicit), the entrance answer when
  the room has none.
- `unreachable_tables(...) -> frozenset[int]`: tables whose route is explicitly `False`.
- `venue_facts(session, venue) -> dict[str, bool]`: `quiet`, `step_free`, `accessible_toilet`
  (`features.compute_features` calls it).
- `owner_view(session, venue) -> dict` and `save(session, venue, body, actor) -> dict` (section 6.2).
- `public_summary(session, venue) -> dict` for `discovery.public_page`.

### 7.4 Changes to existing modules

| File | Change |
|---|---|
| `restaurant_service/features.py` | `compute_features` adds `river_view` (a window or glass wall with tag `river`, `sea` or `water`), `window` (an active table in a `window` zone or within `SEAT_WINDOW_DISTANCE` of a window or glass wall, via `ambience.light.opening_distance`), and `access.venue_facts`. `accessible` now also needs the table's room route not to be `False` |
| `restaurant_service/discovery.py` | `FEATURES` gains the five keys; `Search` gains `within_m`; `search_restaurants` filters by `within_m`; `next_times` uses `PartyNeeds(size, needs_accessible="step_free" in features or "accessible" in features)`; `public_page` adds `access` |
| `routers/discovery.py` | `understand`, `within_m`, `q` max 140, new `POST /restaurants/search`; calls `search.understanding.understander_from_settings(...)` with `today`/`now` from `datetime.now(ZoneInfo("Europe/Lisbon"))` (search has no venue, so `clock.now_local(venue)` does not fit; same zone as the demo venues) |
| `restaurant_service/occupancy.py` | `table_specs(tables, kinds, unreachable: frozenset[int] = frozenset())`: a table in `unreachable` gets `accessible=False`. Default keeps every current caller unchanged |
| `restaurant_service/availability.py` | `table_specs_for` passes `access.unreachable_tables`; when `needs.prefs` contains `quiet`, the `quiet` feature comes from `access.noise_by_table` (works without coordinates) |
| `restaurant_service/map_view.py` | `fit_problem` gets `reachable: bool = True` (needs_accessible and not reachable → "blocked"); `_table_dict` adds `noise`, `noise_reason`, `noise_source`, `step_free_route`; `build_map` computes them once with the loaded rooms |
| `restaurant_service/ambience_view.py` | `ambience_payload` and `table_features` pass `quiet_override` from `access.noise_by_table` (unknown → `False`, quiet → `True`) |
| `app/main.py` | register `owner_access.router` under `/api` |
| `config.py` | `search_understanding` (`SEARCH_UNDERSTANDING`, default `rules`), reserved `search_llm_url`, `search_llm_api_key`, `search_llm_model`, `search_llm_daily_cap` (default 500) |

---

## 8. Frontend components and routes

| File | Change |
|---|---|
| `src/api/discovery.ts` | `FeatureKey` gains `quiet`, `step_free`, `accessible_toilet`, `river_view`, `window`; `Understood`, `UnderstoodChip` types; `searchRestaurants` uses `POST /restaurants/search` when `q` is not empty and `understand: true`; `SearchQuery.withinM`; `PublicRestaurant.access` |
| `src/api/access.ts` (new) | `getAccess(vid)`, `putAccess(vid, body)` and their types |
| `src/api/restaurant.ts` | `DinerTable` gains `noise`, `noise_reason`, `noise_source`, `step_free_route` (not `MapTable` in `types.ts`, which events share) |
| `src/pages/discover/understood.ts` (new, pure) | `applyUnderstood(state, understood) -> state patch`, `chipLabel`, `whenLabel(date, time, today)` ("Tonight · 20:00"), `placeFromChip`. Unit tested |
| `src/pages/discover/SearchUnderstanding.tsx` (new) | The "We understood:" preview row, the leftover line, notes, "Use these" |
| `src/pages/discover/ActiveChips.tsx` (new) | The two-button chips (Change / Remove) for party, when, place, cuisine, price, feature; replaces the inline map in `DiscoverPage.tsx` lines 234–238 |
| `src/pages/discover/DiscoverBar.tsx` | New label, placeholder, `maxLength` 140; submit calls `onApplyUnderstood` when there is something to apply, else today's behaviour |
| `src/pages/discover/DiscoverPage.tsx` | Keeps the latest `understood`; `within` state with the place; "Remove the last filter" |
| `src/pages/discover/FilterDrawer.tsx` | New feature chips and notes (4.2); `QUICK_FEATURES` gains `quiet`, `step_free` |
| `src/pages/discover/discoverModel.ts` | Labels for the new keys; `ambienceLine` adds quiet; `accessLine(features)`; `restaurantHref` adds `wish=quiet` and `access=1` |
| `src/pages/discover/discoveryState.ts` | Persists the place radius |
| `src/pages/discover/RestaurantCard.tsx`, `discover.css` | Access line; chip styles |
| `src/pages/restaurant/useBookingFlow.ts` | `LinkAnswers` gains `wishes` and `access`; `startNeeds` sets `prefs` (only known `PREF_OPTIONS` keys) and `needs_accessible` |
| `src/pages/restaurant/BookingPage.tsx` | Reads `wish` and `access` from the query (line 96) |
| `src/pages/restaurant/tableView.ts` | `noiseWords(table)`, `routeWords(table)`, reason "Not reachable without steps" |
| `src/pages/restaurant/TableCard.tsx` | Two new facts with icons `quiet` / `lively` / `route` |
| `src/pages/restaurant-public/AccessSection.tsx` (new), `RestaurantPage.tsx` | The Access section (4.3) |
| `src/pages/owner/AccessPage.tsx` (new), `accessModel.ts` (new, pure) | The owner page (4.5); the model turns the answer into form state and back, and counts changes |
| `src/pages/owner/OwnerShell.tsx` | `OwnerSection` gains `access`; step "Access and noise" |
| `src/pages/owner/publishChecklist.ts` | Recommended row "Access and noise" |
| `src/App.tsx` | Route `/owner/:venueId/access` → `AccessPage` |

`frontend/src/pages/room-editor/` is **not touched**. Owners who want estimates add a bar or kitchen in
the existing Fixed tab; the Access page links there.

---

## 9. External services: the optional LLM

**Default: no external service.** `SEARCH_UNDERSTANDING=rules` (the default, also when unset) uses only
`RuleUnderstander`. Nothing leaves the server.

Provider interface (`backend/app/search/understanding.py`):

```python
class Understander(Protocol):
    name: str
    def understand(self, text: str, today: date, now: time) -> Understood: ...

class RuleUnderstander:      # parser.parse; the default
class LogUnderstander:       # rules, then logs "llm would be asked: 7 leftover words" (counts only, never text)
class HttpLlmUnderstander:   # later: rules first; only when >= 2 leftover words, ask the LLM over httpx

def understander_from_settings(settings) -> Understander
```

`HttpLlmUnderstander` (phase 2, only if Martim decides so, D5):
- Switched on by `SEARCH_UNDERSTANDING=llm` **and** a non-empty `SEARCH_LLM_API_KEY`; otherwise falls back
  to rules. `SEARCH_LLM_URL`, `SEARCH_LLM_MODEL` select the provider; plain `httpx.Client(timeout=3.0)`, no
  SDK, like `mail/providers.py` `ResendProvider` (secret never in `repr`, errors carry only the type).
- Sends only the query text and today's date. No IP, account, cookie or user agent.
- Asks for JSON in the closed vocabulary; the answer is validated by the same Pydantic model as the
  router and every value outside `FEATURES`, `CUISINES`, the gazetteer or 1–4 is dropped. Rules win on
  conflict. Any error or timeout → the rules result (`provider: "rules"`).
- Only on submit ("Use these" / Enter), never per keystroke.
- Limits: `llm-ip:{ip}` 10 per minute, `llm-day` global `SEARCH_LLM_DAILY_CAP` (default 500) per 86 400 s
  via `security.rate_limit` (a global key); over the cap → rules silently.
- Vercel's 30 s function limit is safe: 3 s timeout, one call.

What Martim must do before switching it on: pick a provider and create an account; put a spending cap on
the account; sign the provider's data processing agreement (GDPR Art. 28) and check where it processes
data (EU or Standard Contractual Clauses); confirm in writing that inputs are not used for training;
add the provider to the privacy notice as a processor ("the words you type in the search box may be sent
to {provider} to understand them; nothing else is sent"); set the four variables in Vercel; expected
cost with a small model is well under one cent per query, so the 500/day cap bounds the monthly bill to a
few euros (check the provider's current price list).

---

## 10. Security, privacy and abuse

- **No free-text storage.** `q` is never written to the database, the audit log or the app log (the
  parser logs nothing). POST keeps it out of URLs and access logs (D1). `discoveryState.ts` already keeps
  the text in `sessionStorage` only, for the tab.
- **Special-category data (GDPR Art. 9).** Search terms like "wheelchair" are about health only when
  linked to a person; search is anonymous and not stored, so no consent is needed for search. A booking's
  `needs_accessible` already exists and is unchanged. The `wish=quiet&access=1` link parameters stay in
  the browser and are not logged by the app.
- **Owner data is about the premises, not people.** The note is `PlainText` (control characters
  refused), max 200, with the "Do not add names or phone numbers" hint; rendered as text, never HTML.
- **Retention and deletion.** Access rows live as long as the restaurant; they cascade when a room,
  table or restaurant row is deleted. No personal data is added, so no new retention rule.
- **Honesty of claims (liability).** Step-free and toilet facts come only from the owner and are labelled
  "Stated by {restaurant}" with the date. Noise is labelled with its source. Nothing is inferred for the
  real Lisbon catalogue restaurants. Owner terms need one clause (legal step below).
- **Authorisation.** Owner routes use `profiles.load` (owner id, kind, `FOR UPDATE`); room and table ids
  in the body must belong to the restaurant (404 otherwise); unknown fields 422.
- **Injection.** The parser works on folded tokens and fixed vocabularies; it outputs only whitelisted
  keys, numbers and gazetteer entries, which then go through the existing validated `Search` dataclass.
  No string-built SQL. Chip labels are built server-side from fixed templates and rendered as text.
- **Abuse limits.** Search: shared `r-read:{ip}` 120/min; `q` ≤ 140 characters, ≤ 30 tokens, parse
  is linear. `within_m` 100–20 000. Owner PUT: 30/min per owner, ≤ 5 rooms, ≤ 1000 tables. LLM (later):
  10/min per IP, 500/day global.
- **Concurrency.** The access PUT uses the layout version compare-and-swap, so it can never silently
  overwrite or be overwritten by a room editor save.
- **Accessibility of the UI (EAA, WCAG 2.1 AA).** Chips are real buttons with `aria-pressed`/labels;
  the preview row is a polite live region; radios have fieldsets and legends; every fact is words plus an
  icon, never colour alone; 44 px targets on the phone.

Legal steps for Martim: (1) add to the owner terms that access and noise details are the owner's own
statements and must be kept accurate; (2) one line in the diner FAQ/privacy notice that search text is
used only to run the search and is not stored; (3) only if the LLM is switched on, the processor steps in
section 9.

---

## 11. Tests (write the pure and security ones first)

### pytest (`backend/tests/`)

`test_search_parser.py`
- `test_party_numbers_and_words_in_english_and_portuguese` (for 4, for four, 4 people, para quatro, 4 pessoas, a dois, just me)
- `test_party_over_online_maximum_adds_a_note_and_no_chip`
- `test_number_next_to_a_time_word_is_a_time_not_a_party` ("for 2 at 8")
- `test_times_20h_20h30_8pm_830pm_and_bare_hour_after_at_means_evening`
- `test_lunch_dinner_noon_set_default_times`
- `test_times_snap_to_the_quarter`
- `test_tonight_today_tomorrow_and_hoje_a_noite_amanha`
- `test_weekday_is_on_or_after_today_and_next_weekday_is_strictly_after`
- `test_this_weekend_is_saturday_or_today_on_a_weekend`
- `test_explicit_dates_roll_to_next_year_once_passed`
- `test_time_already_past_today_moves_to_tomorrow_with_a_note`
- `test_date_more_than_a_year_ahead_is_ignored_with_a_note`
- `test_under_30_euros_means_levels_1_and_2` and `test_around_and_over_and_cheap_and_fine_dining`
- `test_neighbourhoods_with_accents_aliases_and_longest_match_first` (cais do sodre vs cais)
- `test_features_english_and_portuguese_synonyms`
- `test_river_view_also_adds_view_and_wheelchair_adds_accessible_and_step_free`
- `test_negated_feature_is_dropped_but_no_steps_is_step_free`
- `test_cuisine_synonyms_map_only_to_known_cuisines`
- `test_leftover_words_without_stopwords_keep_original_spelling`
- `test_each_word_is_used_once` and `test_chip_order_is_stable`
- `test_spans_point_back_into_the_original_text`
- `test_empty_and_unknown_text_returns_no_chips`
- `test_full_sentence_example_from_the_spec` (the D1 and D2 sentences)
- `test_parser_is_linear_for_the_longest_allowed_query` (140 characters under 5 ms)

`test_search_understanding.py`
- `test_rules_is_the_default_when_unset`, `test_llm_without_key_falls_back_to_rules`,
  `test_log_understander_logs_counts_never_text` (caplog), and for phase 2:
  `test_llm_answer_outside_vocabulary_is_dropped`, `test_llm_timeout_returns_rules_result`,
  `test_llm_request_carries_only_text_and_date` (httpx `MockTransport`), `test_llm_daily_cap_falls_back`.

`test_noise_level.py`
- `test_owner_override_wins`, `test_quiet_zone_is_quiet`, `test_bar_zone_is_lively`,
  `test_room_without_anchor_fixtures_is_unknown`, `test_table_next_to_bar_is_lively_with_distance_reason`,
  `test_toilets_four_metres_away_are_moderate`, `test_main_entrance_within_five_metres_is_moderate`,
  `test_far_from_everything_is_quiet`, `test_distance_words`.
- `test_quiet_override_none_keeps_engine_behaviour` and `test_quiet_override_false_removes_quiet_corner_sentence` (in `test_table_ambience.py`, added, nothing changed).

`test_access_service.py`
- `test_single_room_route_follows_the_entrance`, `test_room_route_false_makes_its_tables_unreachable`,
  `test_venue_facts_quiet_step_free_toilet`, `test_accessible_feature_ignores_unreachable_tables`,
  `test_features_river_view_and_window`.

`test_owner_access_api.py` (security first)
- `test_other_owner_gets_404`, `test_staff_and_anonymous_get_401_or_404`,
  `test_ids_from_another_restaurant_are_404_and_nothing_saved`, `test_unknown_fields_are_422`,
  `test_note_rejects_control_characters_and_over_200`, `test_stale_base_version_is_409_stale_layout`,
  `test_save_bumps_layout_version_and_refreshes_features`, `test_room_editor_save_after_access_save_is_stale`,
  `test_deleting_a_room_or_table_in_the_editor_cascades_access_rows`, `test_rate_limit_30_per_minute`,
  `test_existing_room_editor_payload_still_saves` (the editor's echo of `rooms.view()` is accepted
  unchanged: guards the "no new columns" rule).

`test_discovery_understand.py`
- `test_understand_false_keeps_old_behaviour`, `test_understood_values_override_explicit_ones`,
  `test_date_time_from_text_use_explicit_party_or_two`, `test_rest_is_used_for_the_name_match`,
  `test_post_search_matches_get_search`, `test_post_search_refuses_unknown_fields`,
  `test_q_over_140_is_422`, `test_within_m_drops_far_and_unpinned_restaurants`,
  `test_within_m_without_place_is_422`, `test_search_text_is_not_logged_or_stored` (caplog + table scan).

`test_discovery_access_filters.py`
- `test_quiet_and_step_free_filters`, `test_step_free_with_when_uses_accessible_tables_for_times`,
  `test_public_page_access_summary_and_not_stated`, `test_catalogue_restaurants_have_no_access_claims`.

`test_map_noise.py`
- `test_map_tables_carry_noise_and_route_without_coordinates`,
  `test_needs_accessible_blocks_tables_in_rooms_with_steps`,
  `test_quiet_wish_prefers_quiet_tables_without_coordinates`.

`test_migrate_access_tables.py`, `test_access_seed.py` (`test_seed_is_idempotent`,
`test_refresh_features_command_is_idempotent`).

### vitest (`frontend/src/`)
- `pages/discover/understood.test.ts`: `applies party date time place features cuisines prices`, `unions features and cuisines`, `keeps only the leftover text`, `whenLabel says Tonight after 17:00 and Today before`, `chip labels match the server labels`.
- `pages/discover/SearchUnderstanding.test.tsx`: `shows the preview row only when something was understood`, `Use these applies and moves focus to the results`, `Enter applies`, `notes are announced`, `leftover line quotes the words`.
- `pages/discover/DiscoverPage.test.tsx` (added cases): `free text is sent with POST and understand`, `removing a chip searches again without it`, `Change opens the right control`, `Remove the last filter`.
- `pages/discover/discoverModel.test.ts` (added): `restaurantHref carries wish=quiet and access=1`.
- `pages/restaurant/__tests__/tableCard.test.tsx` (added): `quiet table shows words and reason`, `steps on the way`, `unknown noise shows nothing`.
- `pages/restaurant/__tests__/booking.test.tsx` (added): `wish and access from the link pre-fill step 1`.
- `pages/restaurant-public/AccessSection.test.tsx`: `stated facts`, `not stated with phone`, `note is text`.
- `pages/owner/accessModel.test.ts`, `pages/owner/AccessPage.test.tsx`: `radios start from the server`, `Use our estimate sends null`, `stale layout offers Load the latest`, `save shows the status`.

### Playwright (`frontend/e2e/`)
- `discovery-search.spec.ts`: types "quiet table for 4 tomorrow at 20h in Chiado", sees the four chips, presses Enter, Casa Lumen is listed, its time link carries `wish=quiet`, the booking step 1 has "Quiet corner" ticked; Portuguese sentence "esplanada para 2 hoje à noite"; 390 px run with the Search key and no sideways scroll.
- `owner-access.spec.ts`: demo owner answers the entrance and a room, overrides one table, saves; the public page shows "Step-free" and "Stated by"; an open room editor tab then gets the stale-layout message.
- `accessibility.spec.ts`: add the discovery page with the preview row open, the owner Access page and the public Access section to the axe scan.

---

## 12. Files touched

**New (backend):** `backend/app/search/__init__.py`, `READ_ME_FIRST.md`, `vocabulary.py`,
`neighbourhoods.py`, `dates.py`, `parser.py`, `understanding.py`; `backend/app/ambience/noise.py`;
`backend/app/restaurant_service/access.py`; `backend/app/routers/owner_access.py`;
`backend/app/seed/demo_access.py`; `backend/app/seed/refresh_features.py`; the tests in section 11.

**New (frontend):** `src/api/access.ts`; `src/pages/discover/understood.ts`, `SearchUnderstanding.tsx`,
`ActiveChips.tsx`; `src/pages/restaurant-public/AccessSection.tsx`; `src/pages/owner/AccessPage.tsx`,
`accessModel.ts`; tests; `e2e/discovery-search.spec.ts`, `e2e/owner-access.spec.ts`.

**Modified:**

| File | Shared with other features? |
|---|---|
| `backend/app/models.py` | **Shared** (every feature adding tables). Only new classes appended to the restaurants section |
| `backend/app/main.py` | **Shared** (router registration) |
| `backend/app/config.py` | **Shared** (settings) |
| `backend/app/ambience/table.py`, `READ_ME_FIRST.md` | Ambience; keyword-only, default keeps behaviour |
| `backend/app/restaurant_service/features.py`, `discovery.py`, `map_view.py`, `availability.py`, `occupancy.py`, `ambience_view.py`, `READ_ME_FIRST.md` | **Shared** with any discovery, map or booking feature |
| `backend/app/routers/discovery.py`, `READ_ME_FIRST.md` | **Shared** with discovery features |
| `backend/app/seed/run.py` (call `demo_access.seed`), `READ_ME_FIRST.md` | **Shared** with demo-data features |
| `frontend/src/App.tsx` | **Shared** (routes) |
| `frontend/src/api/discovery.ts`, `src/api/restaurant.ts`, `src/api/READ_ME_FIRST.md` | **Shared** |
| `frontend/src/pages/discover/DiscoverBar.tsx`, `DiscoverPage.tsx`, `FilterDrawer.tsx`, `discoverModel.ts`, `discoveryState.ts`, `RestaurantCard.tsx`, `discover.css`, `READ_ME_FIRST.md` | **Shared** with any discovery feature |
| `frontend/src/pages/restaurant/TableCard.tsx`, `tableView.ts`, `useBookingFlow.ts`, `BookingPage.tsx`, `READ_ME_FIRST.md` | **Shared** with booking features |
| `frontend/src/pages/restaurant-public/RestaurantPage.tsx`, `READ_ME_FIRST.md` | **Shared** with public-page features |
| `frontend/src/pages/owner/OwnerShell.tsx`, `publishChecklist.ts`, `READ_ME_FIRST.md` | **Shared** with owner features |
| `frontend/e2e/accessibility.spec.ts`, `e2e/READ_ME_FIRST.md` | **Shared** |
| `docs/CONTRACT.md` (Discovery, Owner access), `docs/data-model.md`, `docs/ux-restaurant.md`, `docs/user-guide-owner.md`, `docs/user-guide-diner.md` | Docs |

**Not touched:** `backend/app/seed/migrate.py` (new tables only), the room editor
(`frontend/src/pages/room-editor/`, Sergio), `owner_rooms.py`, `rooms.py`, every events path, `mail/`.
`scripts/check_forbidden_paths.py --base main` must stay green.

---

## 13. Rollout and demo data

1. Back up the production database, then `python -m app.seed.migrate` (creates the three tables), then
   `python -m app.seed.refresh_features` (recomputes `venues.features`). Both are idempotent. Then merge
   (deploys through GitHub Actions on push to main).
2. Ship in this order, each step green on its own: (a) parser + tests; (b) search integration and
   preview row; (c) tables + access service + owner API; (d) owner page; (e) map, table card, filters,
   public section; (f) booking link wishes; (g) seeds and e2e.
3. Demo seed `seed/demo_access.py` (called from `seed_all`, idempotent, only invented restaurants):
   - **Casa Lumen** (Chiado): step-free entrance yes, accessible toilet yes, note "Portable ramp for the
     terrace step, ask the host."; implicit room follows the entrance; Q1–Q4 quiet from the Quiet zone,
     bar-zone tables lively; one override (T1 moderate, "street noise").
   - **Tagus Terrace** (Cais do Sodré): step-free yes, toilet yes; River hall route yes, Quay terrace
     route yes; R5 lively (next to the bar), R1/R2 quiet by layout.
   - **Pátio das Laranjeiras** (Príncipe Real): entrance has steps; toilet no; Orange patio route no,
     Fireside room route no.
   - **Miradouro 7** (Graça): step-free yes, toilet not stated.
   - **Tasca do Bairro** (Alfama): entrance has steps, toilet no, note "Two steps at the door."
   - The 20 **Lisbon catalogue** restaurants: no access rows ("Not stated"), and no noise estimate unless
     their synthetic plans have anchor fixtures (they have none today, so "unknown").
4. Feature flag: none needed; the parser only adds behaviour when `understand` is sent.

---

## 14. Decisions for Martim (each with the recommended default)

| # | Question | Recommended |
|---|---|---|
| D1 | Send free-text searches with POST so the words stay out of URLs and logs? | **Yes**, POST when there is text; GET stays for links |
| D2 | Apply understood filters live as the diner types, or only on Enter / "Use these"? | **Preview live, apply on Enter**; the results already reflect the text while typing |
| D3 | Let the Access page set "Wheelchair space" per table (the editor lost that field), at the cost of bumping the layout version? | **Yes** |
| D4 | Count a room with only toilets/TV as enough to estimate noise, or require a bar or kitchen? | **Any busy fixture** (bar, kitchen, toilets, stage, TV), as the ambience engine does today |
| D5 | Build the LLM provider now? | **No.** Ship the interface and `rules`; revisit when real use shows many leftover words (count only, no text) |
| D6 | When the room route is "No", block accessible tables in it for parties that need one (also for staff suggestions)? | **Yes** |
| D7 | Price words: use the owner bands (15/30/60)? | **Yes**, the bands already shown to owners |
| D8 | "Tonight" default time | **20:00**, same as the discovery page's `DEFAULT_TIME` |
| D9 | Show "Quiet tables: 5 of 13" on the public page? | **Yes**, only when at least one table is known |
| D10 | Unknown noise for rooms without fixtures removes the existing "In a quiet corner" sentence there (catalogue plans and Casa Lumen's legacy room). Accept this more honest behaviour? | **Yes** |

---

## 15. Risks

- `models.py`, `main.py`, `App.tsx`, `discovery.py`, `DiscoverPage.tsx`, `TableCard.tsx` and `map_view.py`
  are edited by other features too: merge in small commits and rebase often.
- The access PUT bumps `layout_version`; an owner with the room editor open in another tab gets the
  stale-layout notice ("Save mine over it" would write back the old wheelchair ticks). Documented on the
  page; tests cover it.
- Changing `occupancy.table_specs` and `map_view.fit_problem` touches booking rules; defaults keep every
  caller unchanged, and the concurrency tests must stay green.
- D10 changes visible ambience sentences for fixture-less rooms; existing engine tests are unaffected
  (default `quiet_override=None`), but any view test that expects the sentence there would need Martim's
  approval (none found today: `test_ambience_view.py` and `test_map_rooms.py` only check keys).
- Parser coverage is finite: odd phrasings fall to "Also searching names for …", which may give zero
  results. The empty state's "Remove the last filter" and the visible chips keep this recoverable.
- Neighbourhood centres and radii are approximations; a restaurant at the edge may drop out with
  `within_m`. Radii are generous and the place chip is removable.
- Owner statements can be wrong; labelling and owner terms limit the harm, they do not remove it.

## 16. Size

**L.** About 7 developer days: parser and vocabulary with tests 2 d; search integration and preview UI
1.5 d; data model, access service, owner API and page 2 d; noise engine, map, table card, filters,
public section, booking link 1 d; seeds, e2e, docs 0.5 d. LLM provider (optional, later) another 1–1.5 d.
