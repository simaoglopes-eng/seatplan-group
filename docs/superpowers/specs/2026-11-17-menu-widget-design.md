# Menu, prices and distribution (booking widget, links, QR, Google)

Status: design, not implemented. Date: 2026-11-17. Branch at time of writing: `codex/restaurantes-ux` (local).
Mockup: `C:\Users\marti\AppData\Local\Temp\claude\51127802244b2e7b\048014bd-52bb-4f3b-b71e-3f8ba641286a\scratchpad\features\menu-widget.html`
(owner menu editor + public Menu tab on a 390 px phone; owner Share page + the widget inside a restaurant's own site).

This feature has two halves that ship as two pull requests (see Rollout):

- **A. Menu and prices**: owner menu editor, public Menu tab, computed average price.
- **B. Distribution**: embeddable booking widget (`/embed/{slug}` + `widget.js`), tracked links for
  Instagram / Google / own website, QR code drawn without a library, and Google Business Profile instructions.
  Reserve with Google is documented, not built.

---

## 1. What exists and is reused (verified in code)

| Need | Existing code reused |
|---|---|
| Owner may edit only their own restaurant | `restaurant_service/profiles.load(session, vid, owner)` (owner id + kind + public id, `with_for_update`) |
| Bounded image bytes without a decoder | `restaurant_service/photos.image_info`, `photos.metadata`, `VenuePhoto` rows, `GET /api/photos/{public_id}` (public only when published, owner-only for drafts, immutable cache) |
| Plain-text request fields | `app/core/text.PlainText` |
| Public read limit | `routers/restaurants.READ_LIMIT` with `rate_limit(session, f"r-read:{ip}", ...)` (same budget as `routers/discovery._read_limit`) |
| Owner-only draft preview | pattern in `routers/discovery.restaurant_page` (`_bearer`, `verify_session_token`, `organiser_id` match) |
| Public restaurant payload | `restaurant_service/discovery.public_page` |
| Booking flow without a page frame | `BookingEmbed` in `frontend/src/pages/restaurant/BookingPage.tsx` |
| Booking creation | `routers/restaurants.book` -> `diner_flow.confirm_booking` |
| Absolute links | `config.Settings.public_base_url` (as in `restaurant_service/emails.manage_link`) |
| Whole-document save with version compare | pattern of `restaurant_service/rooms.py` (`PUT .../rooms`, 409 `stale_layout`) |
| Slugs never change after publication | `profiles.update` (409 "The public link is fixed after publication.") -> printed QR codes and pasted widgets stay valid |
| Owner nav | `frontend/src/pages/owner/OwnerShell.tsx` (`STEPS`) |
| Migrations | `backend/app/seed/migrate.py` `NEW_COLUMNS`; new tables come from `db.create_all()` |
| Demo wipe | `routers/demo._wipe` walks `Base.metadata.sorted_tables`, so new tables are wiped automatically |
| e2e static server with production headers | `frontend/e2e/servers/frontend.mjs` `vercelHeaders()` |

Events stay untouched: no file under `pages/events|editor|join|account`, `events_service/`, `routers/events.py`,
`attendee.py`, `guest_*.py`, `visitor.py` changes. `models.py` only gains restaurant tables and columns.
`frontend/src/pages/room-editor/` (Sergio) is **not** touched.

---

## 2. Goal and user stories

Goal: diners can see what they will eat and roughly what it costs before they book, and restaurants can take
SeatPlan bookings from the places their guests already are (their website, Instagram, Google, the table itself),
and see which of those places bring bookings.

Owner
- O1. As an owner I add sections (Starters, Main courses...) and dishes with a price, an optional description,
  dietary labels and an optional photo, and I reorder them.
- O2. I decide when the menu appears on my public page ("Show menu on my public page").
- O3. I see the average price SeatPlan computes, and a hint when it disagrees with the price band in my profile.
- O4. I copy a snippet that puts the SeatPlan booking form on my own website, and I can switch that off.
- O5. I copy a booking link for Instagram and for Google Business Profile, with step-by-step instructions.
- O6. I download or print a QR code that opens my booking page or my menu.
- O7. I see how many online bookings came from each channel in the last 30 days.

Diner
- D1. On a restaurant page I open a Menu tab, filter to Vegetarian / Vegan / Gluten-free, and see prices.
- D2. I see "Average price €32" next to the cuisine, so I know the budget.
- D3. On a restaurant's own website I book a table inside the page, without leaving it.
- D4. I scan a QR code on a table card and land on the booking page (or menu) on my phone.

Staff
- S1. Nothing changes for staff screens. (Booking channel is stored but not shown on the floor in v1.)

## 3. Non-goals (v1)

- Reserve with Google / Actions Center integration (documented in section 13 only).
- Automatic push of links to Google Business Profile through the Business Profile API (designed as a provider
  interface in 13.3, not built).
- Online ordering, takeaway, pre-ordering dishes with a booking, menu translations, multiple currencies (EUR only),
  set menus with courses inside, wine lists with vintages, allergen matrix of the 14 EU allergens.
- PDF menu upload / OCR import.
- Average price as a search filter or on discovery cards (decision D3).
- Per-domain allow-list for the widget (not enforceable with a static `vercel.json`; see 9.2).
- Conversion events sent to the host website (`postMessage` "booked").
- Tracking cookies, analytics scripts or third-party pixels in the widget.

---

## 4. UX flow per screen, with exact copy

The restaurant theme applies (`restaurant-theme.css`): white and lavender surfaces, purple structure, one pink
`btn-primary` per screen, bold sans headings.

### 4.1 Owner: Menu editor (`/owner/:venueId/menu`)

OwnerShell nav gains **Menu** (after Photos) and **Share and embed** (after Review and publish).

Header
- H1: `Menu`
- Lede: `Add your dishes and prices. Diners see them on your public page.`
- Switch (checkbox with role switch): `Show menu on my public page`. Saves at once (PATCH). Toast on:
  `Your menu is now on your public page.` Off: `Your menu is hidden from diners.`
  If turned on with no dish: inline error `Add at least one dish before showing the menu.`
- Save state text next to the main button: `All changes saved` / `Unsaved changes`.
- Primary (pink) button: `Save menu`. Busy label: `Saving…`. Success toast: `Menu saved.`

Average price card (above the sections)
- With a value: `Average price` / big `€32` / `per person` / hint
  `A typical starter, main course and dessert, without drinks. Updated when you save.`
- When the band differs from the profile: `Your menu suggests €€€ (€30 to €60 per person). Your profile says €€.`
  (Band wording matches the existing "Price range" select in `pages/owner/ProfileForms.tsx`: € under 15 €,
  €€ 15–30 €, €€€ 30–60 €, €€€€ over 60 €.)
  + secondary button `Use €€€` (PATCH profile `price_level`; toast `Price level updated to €€€.`).
- Without enough data: `Add at least two priced main courses to see your average price.`

Empty state (no section yet)
- Title `Your menu is empty`; text `Start with a section such as Starters, then add dishes.`
- Buttons: `Add a section` (secondary), `Start with Starters, Main courses, Desserts and Drinks` (link button).

Section card
- Name field (label visually hidden: `Section name`), placeholder `e.g. Starters`.
- Select `Course type`: `Starters`, `Main courses`, `Desserts`, `Drinks`, `Other`. Hint under the select the first
  time: `Used for the average price. Drinks and Other are left out.`
- Optional note field `Note (optional)`, placeholder `e.g. Served until 16:00`.
- Overflow menu `More for {section}`: `Move up`, `Move down`, `Delete section`. Delete confirm dialog:
  title `Delete "{section}"?`, body `Its {n} dishes will be removed when you save.`, buttons `Delete section` (danger),
  `Keep it`.
- Dish rows: 56 px thumbnail (or a lavender square with a plate icon), name (bold), description (muted, 2 lines),
  labels as text chips (`Vegan`, `Gluten-free`), price right-aligned (`€17.50`, `€62.00 per kg`, `€4.80 per 100 g`,
  `Market price`), `Hidden` badge when unavailable, `Edit` link, drag handle `Drag to reorder {dish}` plus
  keyboard `Move up` / `Move down` in the dish dialog.
- `+ Add dish` at the bottom of each section. `+ Add section` under the last section.

Dish dialog (shared `Dialog`)
- Title `Add dish` / `Edit dish`.
- `Name` (required), hint `As it appears on your menu, in any language.`
- `Description (optional)` textarea, counter `{n} / 300`.
- `Price` (€ prefix, `inputmode="decimal"`, accepts `12.5`, `12,50`, `12.50`), hint `VAT included.`
- `Price type` select: `Fixed price`, `Per kg`, `Per 100 g`, `Market price (no fixed price)`. Market price hides
  the Price field.
- Fieldset `Dietary labels`: `Vegetarian`, `Vegan`, `Gluten-free`, `Dairy-free`. Hint
  `Only tick what is always true. Diners with allergies will still check with your staff.` Ticking Vegan ticks
  Vegetarian (and says so: `Vegan dishes are also vegetarian.`).
- Checkbox `Show this dish to diners` (unticked = hidden, kept for later, e.g. out of season).
- Photo: `Dish photo (optional)`; for a dish already saved: `Add photo` / `Replace photo` / `Remove photo`, alt text
  field `Describe the photo`; for a new dish: `Save the menu first to add a photo.`
- Section select `Section` (moves the dish).
- Footer: `Done` (solid purple; it only updates the draft, so the pink stays on `Save menu`), `Cancel`, and on an
  existing dish `Delete dish` (danger text button).
- Errors: `Enter a name.` · `Enter a price, or choose Market price.` · `Use a price like 12.50.` ·
  `Prices go up to €10,000.`

Whole-menu errors
- 409 `stale_menu`: notice `This menu was changed in another tab or by another person. Reload to see the latest
  version, then make your change again.` + button `Reload menu`.
- 422 cap: `A menu can have up to 20 sections and 200 dishes.`
- Leaving with unsaved changes: browser `beforeunload` + in-app confirm `You have unsaved menu changes. Leave anyway?`

### 4.2 Diner: Menu tab on the public page (`/restaurants/:slug#menu`)

- Header line (existing `rp-line`) gains ` · Average price €32` after the price band when available.
- Section nav (existing `rp-section-nav`): `Details`, `Menu` (only when the menu is shown), `Reviews`.
- Menu panel:
  - H2 `Menu`; meta line `Average price €32 per person · Updated 12 Nov`.
  - Filter chips (toggle buttons, `aria-pressed`): `All dishes`, `Vegetarian`, `Vegan`, `Gluten-free`, `Dairy-free`
    (a chip only appears if at least one dish has that label).
  - Per section: H3 name, optional note in muted text; dishes as rows: name, price at the end of the line, description,
    labels as small text chips, optional 72 px photo on the right (tap opens the existing full-screen viewer pattern).
  - Filter with no match: `No dishes match this filter.` + button `Show all dishes`.
  - Footnotes: `Prices in euros, VAT included.` and
    `Dietary labels come from the restaurant. If you have an allergy, tell the staff when you book and when you arrive.`
  - End of menu: link button `Book a table` (scrolls to the existing booking section; the pink header CTA stays the
    one main action).
- Preview (owner, draft): the tab shows the menu with the existing Preview banner even if "Show menu" is off, with
  the line `Only you can see this menu until you show it on your public page.`
- Demo restaurants: a line `SeatPlan demo. This menu and its prices are invented.`

### 4.3 Diner: booking widget on the restaurant's own site (`/embed/:slug`)

Frameless page (no SeatPlan header, no footer links that leave the frame):
- Top: restaurant name (H1, purple), line `Book a table` + `· Average price €32` if known.
- The existing `BookingEmbed` flow (When, Table, Details, Confirmation) unchanged.
- Footer: `See the menu` (opens `/restaurants/{slug}#menu` in a new tab, only when shown) · `Booking by SeatPlan`
  (opens SeatPlan in a new tab).
- Every plain link opens a new tab (`<base target="_blank">`), so "Manage booking" on the confirmation opens
  `/b/{token}` top-level (that page keeps `frame-ancestors 'none'`). Verified: `Confirmation.tsx` renders it as a
  plain `<a className="btn btn-primary" href={absoluteUrl(manageUrl)}>`. React Router `<Link>` ignores
  `<base target>`, so no `<Link>` may be rendered inside `BookingEmbed`; `EmbedPage.test.tsx` pins this
  (`no_router_link_inside_embed`).
- Works with third-party cookies blocked: the backend sets no cookie (no `set_cookie` in `backend/app`) and the
  booking flow in `pages/restaurant` uses no `localStorage` / `sessionStorage`; holds live in React state.
- Widget switched off or restaurant unpublished: empty state title `Online booking is not available here`,
  body `You can still book {name} on SeatPlan.`, link `Open SeatPlan` (new tab). Unknown slug:
  `We cannot find this restaurant.`

### 4.4 Owner: Share and embed (`/owner/:venueId/share`)

- H1 `Share and embed`; lede `Bring in bookings from your website, Instagram, Google and your tables.`
- Draft banner: `Publish your restaurant to switch these links on. You can prepare everything now.`
- Card `Your booking link`: read-only field with the public URL + `Copy link` (toast `Link copied.`).
- Card `Booking widget for your website`
  - Switch `Allow the booking widget on other websites` (default on). Off text:
    `The widget shows "Online booking is not available here" until you switch it back on.`
  - Tabs: `Script (recommended)`, `Simple iframe`, `Button only`. Code in a read-only, monospaced textarea
    labelled `Code to paste`. Button `Copy code` (toast `Code copied.`).
  - Hint: `Paste it where the booking form should appear, for example on your Reservations page. It fits phones and
    adjusts its height by itself.` Link `Preview the widget` (new tab, `/embed/{slug}`).
  - Privacy hint: `Add this sentence to your website's privacy notice: "Table bookings on this page are handled by
    SeatPlan on our behalf."`
- Card `Instagram`: `Add this link to your bio, to a story link sticker, or to a Reserve or Book action button if
  Instagram offers it for your account.` + link field (`?ch=instagram`) + `Copy link`.
- Card `Google Business Profile`: numbered steps (section 13.1, exact copy), two link fields:
  `Reservations link` (`?ch=google`) and `Menu link` (`?ch=google#menu`, only when the menu is shown), each with
  `Copy`. Disclosure `Why is there no "Reserve with Google" button?` with the text in 13.2 (short version).
- Card `QR code`
  - Select `The QR code opens`: `Your booking page`, `Your menu` (menu only when shown).
  - Preview (SVG, 200 px, black on white, 4-module quiet zone), short URL printed under it.
  - Buttons: `Download PNG`, `Download SVG`, `Print a table card` (print view: restaurant name, `Scan to book your
    next table` or `Scan to see our menu`, the QR at 6 cm, the short URL).
  - Hint: `Test it with your phone camera before you print many copies.`
- Card `Where your bookings come from`
  - Caption `Online bookings in the last 30 days. Walk-ins and bookings added by staff are not counted.`
  - Table with a bar per row: `SeatPlan`, `Widget on your website`, `Button on your website`, `Instagram`, `Google`,
    `QR code`, each with a number. Empty: `No online bookings yet.`

---

## 5. Data model changes

### 5.1 New tables (created by `db.create_all()` in `seed.migrate` step 1)

`menu_sections`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| venue_id | FK venues.id, `ondelete=CASCADE`, index | |
| name | VARCHAR(60) | |
| course | VARCHAR(10) | `starter` · `main` · `dessert` · `drink` · `other` (checked in Python) |
| note | VARCHAR(200) default '' | |
| position | INTEGER default 0 | |

`menu_items`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| venue_id | FK venues.id, `ondelete=CASCADE`, index | denormalised for one-query ownership checks |
| section_id | FK menu_sections.id, `ondelete=CASCADE`, index | |
| name | VARCHAR(80) | |
| description | VARCHAR(300) default '' | |
| price_cents | INTEGER NULL | NULL only for `market` |
| price_unit | VARCHAR(10) default 'each' | `each` · `per_kg` · `per_100g` · `market` |
| tags | JSON default '[]' | subset of `vegetarian`, `vegan`, `gluten_free`, `dairy_free` |
| is_available | BOOLEAN default TRUE | |
| photo_id | FK venue_photos.id, `ondelete=SET NULL`, NULL | a `VenuePhoto` with `kind="dish"` |
| position | INTEGER default 0 | |

CHECK constraints: `price_cents IS NULL OR price_cents BETWEEN 0 AND 1000000` (`ck_menu_item_price`).
SQLite has `PRAGMA foreign_keys=ON` (`db._enable_sqlite_foreign_keys`), so SET NULL / CASCADE behave the same on both.

### 5.2 New columns (append to `models.py` and to `NEW_COLUMNS` in the same order)

```python
("venues", "menu_visible", "BOOLEAN NOT NULL DEFAULT FALSE"),
("venues", "menu_version", "INTEGER NOT NULL DEFAULT 0"),
("venues", "menu_updated_at", "TIMESTAMP"),
("venues", "widget_enabled", "BOOLEAN NOT NULL DEFAULT TRUE"),
("bookings", "channel", "VARCHAR(12) NOT NULL DEFAULT 'web'"),
```

Models use `server_default=text("FALSE")`, `text("0")`, `text("TRUE")`, `text("'web'")` word for word.
`menu_updated_at` is `UtcDateTime` (migrate already maps `TIMESTAMP` to `DATETIME` on SQLite).
No new index: channel stats filter on `bookings.venue_id` (indexed) and a 30-day `start_at`/`created_at` window.

`VenuePhoto.kind` gains the value `"dish"` (no schema change; `String(10)`). Every existing reader already filters
`kind == "gallery"` (`discovery._covers`, `discovery.public_page`, `owner_view.restaurant_card`, `photos.order`,
`photos.delete`) or `"view"` (`PhotoEditor.tsx`), so dish photos never leak into galleries or covers. A test pins this.

`Booking.source` stays `"diner"` for every online booking (booking caps and review verification depend on it);
the new `channel` only says where the online booking started.

---

## 6. API endpoints

All owner routes: `user: CurrentOrganiser` + `profiles.load` (404 for someone else's restaurant). All bodies:
`extra="forbid"`; text is `PlainText`. Errors use the existing `{"error": {"code", "message"}}` shape.

### 6.1 Menu (new router `routers/menus.py`)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/owner/restaurants/{vid}/menu` | owner | | `OwnerMenu` |
| PUT | `/api/owner/restaurants/{vid}/menu` | owner; `rate_limit owner-menu:{uid} 60/h` | `MenuDocument` | `OwnerMenu` · 409 `stale_menu` · 422 |
| PATCH | `/api/owner/restaurants/{vid}/menu/settings` | owner | `{"visible": bool}` | `{"visible", "updated_at"}` · 422 when no dish |
| POST | `/api/owner/restaurants/{vid}/menu/items/{item_id}/photo` | owner; `owner-dish-photos:{uid} 60/h` | `{"content_type", "data_base64" (≤ 400 004 chars), "alt_text" ≤150}` | 201 photo metadata (replaces an older dish photo) |
| DELETE | `/api/owner/restaurants/{vid}/menu/items/{item_id}/photo` | owner | | 204 |
| GET | `/api/restaurants/{slug}/menu` | public, `r-read` limit; draft only for its owner (preview) | | `PublicMenu` · 404 `not_found` "This restaurant has not published a menu." |

`MenuDocument`
```json
{
  "version": 4,
  "sections": [
    {
      "id": 3, "name": "Starters", "course": "starter", "note": "",
      "items": [
        {"id": 11, "name": "Peixinhos da horta", "description": "Green beans in a light batter",
         "price_cents": 700, "price_unit": "each", "tags": ["vegan"], "is_available": true},
        {"id": null, "name": "Salada de polvo", "description": "", "price_cents": 900,
         "price_unit": "each", "tags": ["gluten_free"], "is_available": true}
      ]
    }
  ]
}
```
Rules: ≤ 20 sections, ≤ 60 items per section, ≤ 200 items in total; section name 1–60; item name 1–80;
description ≤ 300; note ≤ 200; `price_cents` strict int 0..1 000 000, required unless `price_unit == "market"`,
and must be null for market; tags known and unique (vegan adds vegetarian). Ids that do not belong to this
venue: 404. Order in the arrays is the position. Items missing from the document are deleted (with their dish
photo). The photo of a kept item is preserved (photos are not part of the document).

`OwnerMenu` = `MenuDocument` with ids filled in, plus each item's `photo` (`photos.metadata` or null) and
```json
{"visible": false, "version": 5, "updated_at": "2026-11-17T10:04:00Z",
 "average": {"price_cents": 3200, "starter_cents": 900, "main_cents": 1775, "dessert_cents": 550,
             "suggested_band": 3, "profile_band": 2}}
```

`PublicMenu`: `{"currency": "EUR", "updated_at", "average": {"price_cents", ...} | null, "demo": bool,
"sections": [{"name", "course", "note", "items": [{"id", "name", "description", "price_cents", "price_unit",
"tags", "photo_url", "photo_alt"}]}]}` with hidden dishes and empty sections left out.

`discovery.public_page` gains `"menu": {"shown": bool, "average_price_cents": int | null}` (the page decides
whether to show the tab without a second request).

### 6.2 Distribution (new router `routers/distribution.py`)

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/owner/restaurants/{vid}/distribution` | owner | | see below |
| PATCH | `/api/owner/restaurants/{vid}/distribution` | owner | `{"widget_enabled": bool}` | same as GET |
| GET | `/api/restaurants/{slug}/widget` | public, `r-read` limit | | `{"public_id", "slug", "name", "menu_shown", "average_price_cents", "demo_booking"}` · 404 when unknown, draft, or widget off (code `not_found`, message "Online booking is not available here.") |

Owner distribution answer:
```json
{
  "status": "published",
  "widget_enabled": true,
  "links": {
    "public": "https://<base>/restaurants/patio-das-laranjeiras",
    "website": "https://<base>/restaurants/patio-das-laranjeiras?ch=website",
    "instagram": "https://<base>/restaurants/patio-das-laranjeiras?ch=instagram",
    "google": "https://<base>/restaurants/patio-das-laranjeiras?ch=google",
    "google_menu": "https://<base>/restaurants/patio-das-laranjeiras?ch=google#menu",
    "qr_booking": "https://<base>/restaurants/patio-das-laranjeiras?ch=qr",
    "qr_menu": "https://<base>/restaurants/patio-das-laranjeiras?ch=qr#menu",
    "embed": "https://<base>/embed/patio-das-laranjeiras?ch=widget",
    "widget_script": "https://<base>/widget.js"
  },
  "snippets": {"script": "...", "iframe": "...", "button": "..."},
  "channels_30d": [{"channel": "web", "bookings": 46}, {"channel": "widget", "bookings": 21}]
}
```
`<base>` is `Settings.public_base_url`. `google_menu` / `qr_menu` are null while the menu is hidden.

### 6.3 Booking channel (changed)

`POST /api/r/{venue_public_id}/bookings` body `BookingIn` gains
`channel: Literal["web", "widget", "website", "qr", "instagram", "google"] = "web"`. Old clients keep working.
`diner_flow.confirm_booking(..., channel="web")` stores it. `booking_rows.describe` is unchanged in v1.

---

## 7. Backend modules and pure functions

New `backend/app/restaurant_service/menu_rules.py` (pure, no database; tests first)
- `DIET_TAGS = ("vegetarian", "vegan", "gluten_free", "dairy_free")`, `COURSES`, `PRICE_UNITS`.
- `normalise_tags(tags: list[str]) -> list[str]`: unknown -> ValueError; duplicates removed; `vegan` adds
  `vegetarian`; output in `DIET_TAGS` order.
- `parse_price(text: str) -> int` (used by the frontend twin only for parity tests; backend receives cents).
- `average_meal(items: Iterable[PricedDish]) -> Average | None`: uses available dishes with
  `price_unit == "each"` and a price, grouped by section course; needs ≥ 2 mains; result = median(main) +
  median(starter) if any + median(dessert) if any; each median of an even count is the mean of the middle two;
  total rounded half-up to whole euros (cents out, e.g. 3225 -> 3200). Drinks and Other never count.
- `price_band(cents: int) -> int`: `< 1500` -> 1, `< 3000` -> 2, `<= 6000` -> 3, else 4 (the same bands as the
  owner's "Price range" select in `ProfileForms.tsx`; a test pins the edges 1499/1500/2999/3000/6000/6001).
- `check_caps(sections) -> None`: 20 / 60 / 200 limits with the copy of 4.1.

New `backend/app/restaurant_service/menu.py` (database)
- `owner_view(session, venue) -> dict`, `public_view(session, venue, *, preview) -> dict | None`.
- `save(session, venue, document, actor) -> dict`: atomic `UPDATE venues SET menu_version = menu_version + 1
  WHERE id = :id AND menu_version = :expected` (rowcount 0 -> 409 `stale_menu`), upsert sections and items by id,
  delete what is missing (and their `VenuePhoto` rows of kind dish), set `menu_updated_at`, `audit.record(action=
  "menu.save", detail={"sections": n, "items": m})`, one commit.
- `set_visible(session, venue, visible)`.
- `summary(session, venue) -> {"shown", "average_price_cents"}` for `discovery.public_page`.

`backend/app/restaurant_service/photos.py` (changed, small)
- `MAX_DISH_BYTES = 300_000`, `MAX_DISH_PHOTOS = 200` (one per dish at most, implied by the item cap).
- `store_dish_photo(session, venue, item, encoded, alt_text) -> dict`: decode + `image_info`, delete the previous
  dish photo of that item, insert `VenuePhoto(kind="dish", position=0, is_cover=False)`, link `item.photo_id`.
  `upload()` and its `Literal["gallery", "view"]` router model stay unchanged.

New `backend/app/restaurant_service/distribution.py`
- `CHANNELS = ("web", "widget", "website", "qr", "instagram", "google")`.
- `links(base_url, slug, menu_shown) -> dict` (pure).
- `snippets(base_url, slug, name) -> dict` (pure). The name only appears in the iframe `title`, escaped with
  `html.escape(quote=True)`; the slug matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` (already enforced by `ProfilePatch`).
  Script snippet:
  ```html
  <div data-seatplan-restaurant="patio-das-laranjeiras"></div>
  <script src="https://<base>/widget.js" async></script>
  ```
  Iframe snippet:
  ```html
  <iframe src="https://<base>/embed/patio-das-laranjeiras?ch=widget" title="Book a table at Pátio das Laranjeiras"
    style="width:100%;height:720px;border:0" loading="lazy" allow="clipboard-write"></iframe>
  ```
  Button snippet: `<a href="https://<base>/restaurants/patio-das-laranjeiras?ch=website">Book a table</a>`.
- `channel_counts(session, venue, now) -> list[dict]`: counts bookings with `source == "diner"` created in the last
  30 days (cancelled ones included: the table counts bookings *made*), grouped by `channel`, every channel present
  with 0.
- `widget_info(session, slug) -> dict` (404 rules of 6.2).

`backend/app/restaurant_service/google_links.py` (interface only, see 13.3): `ReservationLinkPublisher` protocol and
`ManualPublisher` (default, returns the instruction steps; no network).

Changed: `diner_flow.confirm_booking` (channel kwarg), `routers/restaurants.BookingIn` + `book`,
`discovery.public_page` (menu summary), `publishing.review` (one non-blocking tip `"menu"`:
`A menu with prices helps diners choose you.`, fix link `menu`), `main._register_routers` (two routers),
`models.py`, `seed/migrate.py`, `seed/run.py` (`demo_menus.seed`).

New `backend/app/seed/demo_menus.py`: menus for the invented restaurants only (Casa Lumen, Tagus Terrace, Pátio das
Laranjeiras, Miradouro 7, Tasca do Bairro); `menu_visible=True`; drawn dish photos are not added (keeps the seed
small). The 20 Lisbon catalogue restaurants are real businesses: **no invented menus or prices for them** (D5).

---

## 8. Frontend components and routes

Routes in `frontend/src/App.tsx`:
- `/owner/:venueId/menu` -> `pages/owner/MenuEditorPage.tsx`
- `/owner/:venueId/share` -> `pages/owner/SharePage.tsx`
- `/embed/:slug` -> `pages/embed/EmbedPage.tsx` (lazy)

New files
- `src/api/menu.ts`: `getOwnerMenu`, `saveOwnerMenu`, `setMenuVisible`, `uploadDishPhoto`, `deleteDishPhoto`,
  `getPublicMenu` (auth `"none"`).
- `src/api/distribution.ts`: `getDistribution`, `setWidgetEnabled`, `getWidgetInfo` (auth `"none"`).
- `src/pages/owner/MenuEditorPage.tsx`, `MenuSectionCard.tsx`, `DishRow.tsx`, `DishDialog.tsx`,
  `AveragePriceCard.tsx`, `menuModel.ts` (pure: draft state, reorder, `parsePrice("12,50") -> 1250`,
  `formatPrice`, dirty check, document for PUT), `menu-editor.css`. Dish photos reuse `photoResize.ts` with a
  smaller target (max 800 px, ≤ 300 000 bytes) and `PhotoPreview.tsx`.
- `src/pages/owner/SharePage.tsx`, `SnippetCard.tsx`, `QrCard.tsx`, `GoogleSteps.tsx`, `ChannelTable.tsx`,
  `shareModel.ts` (pure: tab -> snippet, channel labels, bar widths), `share.css` (with `@media print` table card).
- `src/qr/qrEncode.ts` (pure QR encoder: byte mode, error correction M, versions 1–10, Reed–Solomon over GF(256)
  with 0x11D, interleaving, the 8 masks with the 4 penalty rules, format and version information),
  `src/qr/qrSvg.ts` (matrix -> SVG path string with quiet zone), `src/qr/qrPng.ts` (SVG -> canvas -> Blob),
  `src/qr/READ_ME_FIRST.md`. About 300 lines, no dependency.
- `src/pages/restaurant-public/MenuTab.tsx`, `menuView.ts` (pure: filters, chip list, price text, "Updated 12 Nov"),
  `menu.css`.
- `src/pages/embed/EmbedPage.tsx`, `embedModel.ts` (pure: resize message, clamp), `embed.css`, `READ_ME_FIRST.md`.
  EmbedPage sets `data-surface="restaurants"` on `<html>` itself (no `PageShell`, so `PageShell.tsx` is untouched),
  inserts `<base target="_blank">`, renders `BookingEmbed`, and posts
  `{"type": "seatplan:resize", "height": n}` to `window.parent` from a `ResizeObserver` (only when framed).
- `frontend/public/widget.js` (static, ~70 lines, no build step): finds `[data-seatplan-restaurant]`, checks the slug
  pattern, inserts one iframe per element (`src = origin + "/embed/" + slug + "?ch=widget"`, `title="Book a table"`,
  `loading="lazy"`, `allow="clipboard-write"`, `style="width:100%;border:0;min-height:560px"`), and listens to
  `message` events: accepts only `event.origin === origin` and `event.source === iframe.contentWindow`, height clamped
  to 320..4000. `origin` comes from `document.currentScript.src`, so preview deployments work. No cookies, no storage.

Changed files
- `src/App.tsx` (3 routes), `src/pages/owner/OwnerShell.tsx` (`OwnerSection` + 2 steps),
  `src/pages/owner/OwnerHomePage.tsx` (card link `Share and embed`),
  `src/pages/restaurant-public/RestaurantPage.tsx` (Menu tab `#menu`, average price in the header line),
  `src/api/discovery.ts` (`PublicRestaurant.menu`), `src/api/photos.ts` (`OwnerPhoto.kind` adds `"dish"`, type only),
  `src/api/restaurant.ts` (`createBooking(..., channel)`),
  `src/pages/restaurant/StepDetails.tsx` (reads the channel with `bookingChannel(location)` and passes it),
  new pure `src/pages/restaurant/bookingChannel.ts` (`/embed/...` -> `widget`; `?ch=` known value -> it; else `web`).

---

## 9. Security, privacy and abuse limits

### 9.1 Framing exception in `vercel.json`

Today one rule `"/(.*)"` sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` everywhere. New rules:

```json
{ "source": "/((?!embed/).*)",  "headers": [ ...today's headers, unchanged... ] },
{ "source": "/embed/(.*)",      "headers": [
    { "key": "Content-Security-Policy", "value": "<today's CSP with frame-ancestors https: http://localhost:* http://127.0.0.1:*>" },
    { "key": "Referrer-Policy", "value": "no-referrer" },
    { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" } ] },
{ "source": "/widget.js",       "headers": [
    { "key": "Cache-Control", "value": "public, max-age=3600" },
    { "key": "Cross-Origin-Resource-Policy", "value": "cross-origin" } ] }
```

- The catch-all excludes `/embed/` with a negative lookahead (the same syntax as today's rewrite
  `/((?!api/).*)`), so no header key is defined twice for one path and precedence rules do not matter.
- `/embed/*` drops `X-Frame-Options` (it cannot express "any site") and allows HTTPS parents plus localhost for the
  owner's web designer and our e2e tests. Every other page, including `/b/{token}`, `/owner/*`, `/restaurants/*`,
  keeps `frame-ancestors 'none'`.
- The API keeps `X-Frame-Options: DENY` from `main._SECURITY_HEADERS`; the iframe only fetches it, never frames it.
  API calls from the iframe are same-origin, so CORS (`FRONTEND_ORIGIN`) is unchanged.
- `frontend/e2e/servers/frontend.mjs` `vercelHeaders()` currently merges every rule for every path; it must match
  `source` as an anchored regular expression per request (`new RegExp("^" + source + "$")`) so e2e serves exactly
  what Vercel serves.

### 9.2 Threats

| Threat | Answer |
|---|---|
| Clickjacking of the booking form | Booking needs typed name and email and sends a confirmation with a cancel link; anyone can already call the public API directly, so framing adds no power. No owner or guest session exists inside the iframe (calls use auth `"none"`; third-party storage is partitioned anyway). |
| A third party embeds a restaurant's widget | Bookings still go to that restaurant. The owner can switch the widget off. A per-domain allow-list would need a dynamic CSP from the Python function (cold starts, cost); not in v1 (D2). |
| Framing other pages via the widget | `<base target="_blank">` + the strict CSP on all other paths; manage links open top-level. |
| `postMessage` spoofing | The embed only sends a height. `widget.js` accepts messages only from the SeatPlan origin and from its own iframe's window, and clamps the height. |
| Malicious menu text | `PlainText`, length caps, React escaping; no HTML or Markdown in menus. |
| Snippet injection | Slug pattern-checked; name escaped in `title`; snippet shown in a read-only textarea. |
| Storage abuse via photos | One dish photo per dish, ≤ 300 KB, `image_info` header check, 60 uploads/hour per owner. |
| Scraping | Public menu and widget info share the `r-read` 120/min/IP budget. |
| Wrong `?ch=` values | Client maps unknown values to `web`; the server `Literal` refuses others (422), never stores free text. |

### 9.3 Privacy (GDPR)

- Menus and prices are business data, not personal data.
- `channel` is a fixed label on an existing booking row: no new personal data, no cookies, no device identifiers,
  no third-party scripts; it is deleted with the booking under the existing retention.
- Widget: no cookies or `localStorage` writes by `widget.js` or the embed page beyond what the booking flow already
  uses for strictly necessary state, so no cookie consent is needed for the widget itself (ePrivacy art. 5(3)
  exemption for strictly necessary storage). The restaurant's site privacy notice should mention SeatPlan; the Share
  page offers the sentence. The restaurant is controller of its booking data and SeatPlan its processor: the existing
  DPA / terms must cover bookings collected through the widget (legal step L2).
- Data minimisation: the stats endpoint returns counts only; no list of who came from where.
- Deletion: menu rows and dish photos cascade with the restaurant; deleting a dish deletes its photo.

### 9.4 Caps summary

20 sections · 60 dishes per section · 200 dishes · 300 description chars · 1 photo per dish (300 KB) ·
menu PUT 60/h/owner · dish photo 60/h/owner · public reads 120/min/IP · request body of PUT ≤ ~150 KB.

---

## 10. Tests to add (names)

pytest (`backend/tests/`), tests first for the pure and security ones:
- `test_menu_rules.py`: `test_vegan_adds_vegetarian`, `test_unknown_tag_is_refused`,
  `test_average_needs_two_mains`, `test_average_is_median_starter_main_dessert`,
  `test_average_ignores_drinks_other_hidden_per_kg_and_market`, `test_average_rounds_half_up_to_euros`,
  `test_price_band_edges`, `test_caps_sections_items_total`.
- `test_menu_api.py`: `test_owner_saves_and_reads_menu`, `test_other_owner_gets_404`,
  `test_stale_version_is_409`, `test_missing_items_are_deleted_with_photo`, `test_foreign_item_id_is_404`,
  `test_market_price_must_have_no_price`, `test_public_menu_hidden_until_visible`,
  `test_draft_menu_only_for_owner_preview`, `test_visible_needs_a_dish`, `test_public_menu_hides_unavailable`,
  `test_menu_save_is_rate_limited`, `test_plain_text_refuses_control_characters`.
- `test_menu_photos.py`: `test_dish_photo_replaces_previous`, `test_dish_photo_size_cap`,
  `test_dish_photos_never_in_gallery_or_cover` (discovery card, public page, owner card, `photos.order`),
  `test_deleting_dish_photo_via_gallery_route_unlinks_item`.
- `test_distribution.py`: `test_links_use_public_base_url`, `test_snippets_escape_name`,
  `test_widget_info_404_for_draft_and_disabled`, `test_booking_stores_channel`,
  `test_unknown_channel_is_422`, `test_old_clients_default_to_web`, `test_channel_counts_last_30_days_only_diner`,
  `test_booking_caps_and_review_verification_unchanged_for_widget_bookings`.
- `test_embed_headers.py` (reads `vercel.json`, matches sources like Vercel): `test_embed_allows_https_parents`,
  `test_every_other_path_denies_framing` (`/`, `/b/x`, `/owner/x/menu`, `/restaurants/x`, `/api/x`),
  `test_no_path_gets_two_values_for_one_header`, `test_widget_js_is_cross_origin_cacheable`.
  The existing `test_s6_vercel_headers_include_hsts` keeps passing (HSTS stays in every rule).
- `test_migrate_menu_widget.py`: `test_menu_widget_upgrade_is_repeatable_and_keeps_rows` (old schema fixture ->
  migrate twice -> new tables and columns exist, defaults filled, old bookings have `channel = 'web'`).
- `test_demo_menus.py`: `test_only_invented_restaurants_get_menus`, `test_demo_menu_average_is_stable`.
- `test_publishing.py` (extend): `test_menu_tip_is_not_blocking`.

vitest (`frontend/src/`):
- `qr/qrEncode.test.ts`: `reed_solomon_matches_iso_hello_world_1M` (EC codewords 196 35 39 119 235 215 231 226 93 23),
  `format_bits_for_M_masks_0_to_7`, `version_bits_for_7_to_10`, `picks_smallest_version_for_length`,
  `matrix_has_finders_timing_and_dark_module`, `refuses_input_over_version_10`.
- `qr/qrSvg.test.ts`: `svg_has_quiet_zone_and_one_path`.
- `pages/owner/menuModel.test.ts`: `parsePrice_accepts_comma_and_dot`, `parsePrice_refuses_three_decimals`,
  `formatPrice_units`, `reorder_moves_items_between_sections`, `document_omits_photo_fields`, `dirty_after_edit`.
- `pages/owner/MenuEditorPage.test.tsx`: `empty_state_template_adds_four_sections`, `vegan_ticks_vegetarian`,
  `stale_menu_shows_reload`, `photo_needs_saved_dish`, `band_hint_uses_profile`.
- `pages/owner/shareModel.test.ts`, `pages/owner/SharePage.test.tsx`: `copy_buttons_copy_links`,
  `menu_links_hidden_when_menu_hidden`, `draft_banner`, `channel_table_empty_state`.
- `pages/restaurant-public/menuView.test.ts`, extend `RestaurantPage.test.tsx`: `menu_tab_only_when_shown`,
  `filters_by_label`, `no_match_shows_show_all`, `average_price_in_header`.
- `pages/restaurant/bookingChannel.test.ts`: `embed_path_is_widget`, `known_ch_kept`, `unknown_ch_is_web`.
- `pages/embed/embedModel.test.ts`, `pages/embed/EmbedPage.test.tsx`: `posts_height_only_when_framed`,
  `base_target_blank_inserted`, `widget_off_message`, `no_router_link_inside_embed`.
- `public/widget.test.ts` (jsdom, evaluates the file text): `creates_iframe_per_element`,
  `ignores_invalid_slug`, `resizes_only_from_seatplan_origin_and_own_frame`, `clamps_height`, `runs_twice_safely`.

Playwright (`frontend/e2e/`):
- `owner-menu.spec.ts`: owner adds two sections and four dishes, saves, sees `Average price`, shows the menu,
  opens the public page, filters Vegan (1440 and 390 px), axe scan of editor and Menu tab.
- `embed-widget.spec.ts`: a host page fulfilled by `page.route` at `http://127.0.0.1:4999/host.html` loads
  `widget.js`; the iframe books a table end to end; the frame grows; the booking row has `channel = widget`
  (via the staff floor or a demo-only read); a host at `http://evil.test/` framing `/restaurants/{slug}` is blocked
  and framing `/embed/{slug}` from a non-localhost `http:` origin is blocked; the confirmation's "Manage booking"
  opens a new page.
- `owner-share.spec.ts`: copy link, switch the widget off then `/embed/{slug}` shows "Online booking is not available
  here", QR downloads produce a PNG and an SVG file.
- `accessibility.spec.ts` (extend): `/owner/:id/menu`, `/owner/:id/share`, `/restaurants/:slug#menu`, `/embed/:slug`.

Manual check before release: scan the printed QR with an iPhone and an Android camera (no decoder in the repo).

---

## 11. Files touched

New (this feature only)
- `backend/app/restaurant_service/menu.py`, `menu_rules.py`, `distribution.py`, `google_links.py`
- `backend/app/routers/menus.py`, `backend/app/routers/distribution.py`
- `backend/app/seed/demo_menus.py`
- `backend/tests/test_menu_rules.py`, `test_menu_api.py`, `test_menu_photos.py`, `test_distribution.py`,
  `test_embed_headers.py`, `test_migrate_menu_widget.py`, `test_demo_menus.py`
- `frontend/public/widget.js`, `frontend/src/public-widget.test.ts` (or `frontend/src/widget.test.ts`)
- `frontend/src/api/menu.ts`, `frontend/src/api/distribution.ts`
- `frontend/src/qr/` (`qrEncode.ts`, `qrSvg.ts`, `qrPng.ts`, tests, `READ_ME_FIRST.md`)
- `frontend/src/pages/embed/` (`EmbedPage.tsx`, `embedModel.ts`, `embed.css`, tests, `READ_ME_FIRST.md`)
- `frontend/src/pages/owner/MenuEditorPage.tsx`, `MenuSectionCard.tsx`, `DishRow.tsx`, `DishDialog.tsx`,
  `AveragePriceCard.tsx`, `menuModel.ts`, `menu-editor.css`, `SharePage.tsx`, `SnippetCard.tsx`, `QrCard.tsx`,
  `GoogleSteps.tsx`, `ChannelTable.tsx`, `shareModel.ts`, `share.css`, tests
- `frontend/src/pages/restaurant-public/MenuTab.tsx`, `menuView.ts`, `menu.css`, tests
- `frontend/src/pages/restaurant/bookingChannel.ts` + test
- `frontend/e2e/owner-menu.spec.ts`, `embed-widget.spec.ts`, `owner-share.spec.ts`

Changed, **shared with other features** (expect merge conflicts; keep edits small and append-only)
- `backend/app/models.py` (2 classes, 5 columns appended)
- `backend/app/seed/migrate.py` (`NEW_COLUMNS` appended)
- `backend/app/main.py` (2 routers registered)
- `backend/app/seed/run.py` (one call)
- `backend/app/restaurant_service/discovery.py` (`public_page` gains `menu`)
- `backend/app/restaurant_service/publishing.py` (one tip)
- `backend/app/restaurant_service/photos.py` (`store_dish_photo`)
- `backend/app/restaurant_service/diner_flow.py`, `backend/app/routers/restaurants.py` (channel)
- `vercel.json` (header rules split)
- `frontend/e2e/servers/frontend.mjs` (per-source header matching)
- `frontend/src/App.tsx`, `frontend/src/pages/owner/OwnerShell.tsx`, `OwnerHomePage.tsx`
- `frontend/src/pages/restaurant-public/RestaurantPage.tsx`, `frontend/src/api/discovery.ts`,
  `frontend/src/api/restaurant.ts`, `frontend/src/api/photos.ts` (type), `frontend/src/pages/restaurant/StepDetails.tsx`
- `frontend/e2e/accessibility.spec.ts`
- Docs and read-mes: `backend/app/restaurant_service/READ_ME_FIRST.md`, `backend/app/routers/READ_ME_FIRST.md`,
  `backend/app/seed/READ_ME_FIRST.md`, `frontend/src/pages/owner/READ_ME_FIRST.md`,
  `frontend/src/pages/restaurant-public/READ_ME_FIRST.md`, `frontend/src/pages/restaurant/READ_ME_FIRST.md`,
  `frontend/e2e/READ_ME_FIRST.md`, `docs/security.md` (framing exception), `docs/data-model.md`, `docs/api.md`,
  `docs/user-guide-owner.md` (Google / Instagram / widget / QR steps), `docs/user-guide-diner.md` (Menu tab).

Not touched: all event paths, `frontend/src/pages/room-editor/` (Sergio), `frontend/src/design/components/PageShell.tsx`,
`mail/`, `GuestAccount`.

---

## 12. Rollout and demo data

1. PR A (menu): models + migrate + menu service/router + editor + Menu tab + demo menus. Before merging to `main`:
   back up the production database, run `python -m app.seed.migrate` against it (adds 2 tables, 5 columns; the
   `bookings.channel` column ships here so PR B needs no second migration), then merge (GitHub Actions deploys).
2. PR B (distribution): `vercel.json`, e2e server, embed page, `widget.js`, Share page, QR, channel on bookings.
   After deploy, check with `curl -I https://<prod>/embed/casa-lumen` and `curl -I https://<prod>/owner` that only
   the first lacks `X-Frame-Options` and has the new `frame-ancestors`.
3. Seed: `seed_all` calls `demo_menus.seed(session)` after `demo_showcase.seed`; `POST /api/demo/reset` therefore
   restores menus too. Demo menus are marked `demo: true` in `PublicMenu` (venue `is_demo`) and show the demo line.
4. Docs: owner guide section "Share your booking link" with the Google steps of 13.1.
5. Feature is off for diners until an owner shows a menu; the widget works only for published restaurants.

Demo menu for Pátio das Laranjeiras (used by the mockup; average = median starter €9.00 + median main €17.75 +
median dessert €5.50 = €32.25 -> €32, band €€€):
Couvert (other): Pão, manteiga e azeitonas €3.50 (vegetarian). Starters: Peixinhos da horta €7.00 (vegan),
Salada de polvo €9.00 (gluten-free), Amêijoas à Bulhão Pato €14.50 (gluten-free). Main courses: Polvo à lagareiro
€22.00 (gluten-free), Arroz de tomate com pescada frita €18.00, Bacalhau à Brás €17.50, Cogumelos salteados com
ovo e espargos €15.00 (vegetarian, gluten-free). Desserts: Leite creme €5.50 (vegetarian, gluten-free),
Bolo de bolacha €5.00 (vegetarian), Mousse de chocolate de aquafaba €6.00 (vegan). Drinks: Vinho da casa, copo €4.00,
Limonada de laranja €3.50 (vegan).

---

## 13. Google, Instagram and Reserve with Google

### 13.1 Adding the SeatPlan link in Google Business Profile (exact copy for the Share page)

Title: `Add your booking link to Google`
1. `Sign in to Google with the account that manages your Business Profile.`
2. `Search Google for your restaurant's name, or open Google Maps and go to your profile, then choose Edit profile.`
3. `Open the bookings or reservations links. Google may call this "Reservations" or "Booking links"; the wording
   changes from time to time.`
4. `Choose Add link, paste your Reservations link below and save. If Google offers it, mark it as your preferred link.`
5. `If your menu is shown on SeatPlan, also paste your Menu link in the Menu link field.`
6. `Google can take a few days to show the change, and may review it first.`

Footnote: `Diners who use this link book on SeatPlan; Google does not see the booking.`

### 13.2 Reserve with Google (documented, not built)

The "Reserve a table" button inside Google Search and Maps is run by Google's **Actions Center** (formerly Reserve with
Google). Only approved booking partners can appear there; a restaurant cannot add it by itself. What SeatPlan would
need (verify the current terms on Google's Actions Center partner pages before starting):

- **Apply** as a partner (interest form), and be accepted. Google looks for an established booking platform with
  enough merchants in the target market; there is no public number.
- **Choose an integration**: *Reservations redirect* (Google sends the diner to our booking page; we upload feeds and
  report conversions) or *end-to-end* (booking completes inside Google; we implement Google's Booking Server API
  with availability lookup, create, update and status calls, plus real-time availability updates).
- **Feeds**: daily merchant/entity feed (name, address, phone, coordinates for place matching), action/service feed
  with booking URLs or services, and for end-to-end an availability feed; uploaded to Google (SFTP or their feed
  endpoint) and kept fresh.
- **Conversion tracking**: keep the `rwg_token` from Google's landing URL for the visit and send a conversion event
  when a booking is made (required for redirect).
- **Merchant consent**: written agreement from each restaurant to be represented by SeatPlan on Google.
- **Launch**: sandbox, Google review of the flow and data quality, production launch per country, ongoing monitoring
  (feed errors, availability accuracy, latency SLAs for end-to-end).
- **Effort**: redirect about 3 to 5 weeks of engineering plus Google's review time; end-to-end about 8 to 12 weeks.
  Cost: engineering and operations; Google does not publicly charge partners, but terms can change.
- **Legal**: Actions Center partner terms, data-sharing terms with Google (`rwg_token` handling), updates to the
  SeatPlan privacy notice and to the restaurant terms.

Short copy for the Share page disclosure: `Google's own "Reserve a table" button is only for approved booking
partners. SeatPlan is not one yet. Until then, your Reservations link gives diners the same one-tap way to book.`

### 13.3 Provider interface for a future automatic Google link (not built)

`restaurant_service/google_links.py`:
```python
class ReservationLinkPublisher(Protocol):
    def publish(self, venue: Venue, reservations_url: str, menu_url: str | None) -> PublishOutcome: ...

class ManualPublisher:      # default: returns the 13.1 steps, makes no network call
class LogPublisher:         # demo/tests: writes audit row "google_link.requested", no network call
# Not built: PlaceActionsPublisher, Google Business Profile "Place Actions" API
# (placeActionLinks with placeActionType DINING_RESERVATION), called with httpx, needs per-owner OAuth.
```
Chosen by `GOOGLE_LINK_PROVIDER` = `manual` (default) | `log` | `place_actions`; the last also needs
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` (Vercel environment variables, never in the repo), an
approved Business Profile API access request, an OAuth consent screen review, and encrypted storage of each owner's
refresh token. v1 ships only `ManualPublisher`, used by the Share page text.

### 13.4 Instagram

Owner copy (Share page): bio link (`Edit profile -> Links -> Add external link`), story link sticker, and, where
Instagram offers it to the account, an action button (`Edit profile -> Action buttons`). Instagram's partner-only
buttons are out of scope like Reserve with Google.

---

## 14. Steps Martim must take (accounts, cost, legal)

- No new paid service and no new account are needed for v1. QR, widget and menu run on today's Vercel + Postgres.
- Storage: dish photos ≤ 300 KB each, ≤ 200 per restaurant (≈ 60 MB worst case per restaurant in Postgres). Watch
  the database plan size if many owners upload dish photos (D6).
- L1. Publish a SeatPlan privacy notice page that the widget footer can link to (no `/privacy` route exists today).
- L2. Make sure the restaurant terms / DPA say SeatPlan processes bookings as a processor on any channel, including
  widgets on the restaurant's website.
- L3. Owner terms: the owner is responsible for menu prices (VAT included, as Portuguese consumer law requires) and
  for dietary labels; SeatPlan shows them as given.
- L4. For Reserve with Google later: a Google account for the partner application, merchant consent clauses, and a
  review of Google's partner terms.

## 15. Open decisions for Martim (with recommended defaults)

| # | Question | Recommended default |
|---|---|---|
| D1 | Frame-ancestors for `/embed/*`: `https:` only, `https:` + localhost, or `*`? | `https: http://localhost:* http://127.0.0.1:*` |
| D2 | Per-domain allow-list for the widget (needs the embed HTML served by the Python function)? | No in v1; on/off switch per restaurant |
| D3 | Show "Average price" on discovery cards and as a filter? | Not in v1; public page, menu tab and widget only |
| D4 | Average price method: median or mean per course? | Median per course (one luxury platter does not skew it) |
| D5 | Seed invented menus for the 20 real Lisbon catalogue restaurants? | No; only the 5 invented restaurants |
| D6 | Dish photos: allowed in v1? | Yes, one per dish, 300 KB, 800 px |
| D7 | Widget switched on by default for published restaurants? | Yes (owner can switch it off) |
| D8 | Should the menu price band hint change `price_level` automatically? | No; owner clicks "Use €€€" |
| D9 | Ship the 14 EU allergens as structured data? | Not in v1; four dietary labels + the "tell the staff" note |
| D10 | Show "via Instagram / Widget" on the staff floor? | Not in v1; counts on the Share page only |

## 16. Size and effort

**L** overall (two PRs). Rough effort for one developer with tests:
- PR A Menu: backend 2 days, editor 2.5 days, public tab 1 day, demo + docs 0.5 day = **6 days**.
- PR B Distribution: headers + e2e server 0.5 day, embed page + `widget.js` 1.5 days, QR encoder with tests 1.5 days,
  Share page + Google/Instagram copy 1.5 days, channel attribution 0.5 day, e2e 1 day = **6.5 days**.
- Total about **12 to 13 developer days**.
