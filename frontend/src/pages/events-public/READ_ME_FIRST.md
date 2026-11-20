# events-public: read me first

The public side of events and Event staff (plan `docs/superpowers/plans/2026-11-18-eventos-paridade.md`).
Built from the discovery pieces (`discover/Chips.tsx`, the `discover-card` frame, the states) so finding
an event feels like finding a table. These pages keep the events look (they are not in `RESTAURANT_ROOTS`).

| Route | File | API |
|---|---|---|
| `/events` | `EventsPage.tsx`: Event booking. Type chips (`?type=`), upcoming listed events, "Show more", a "Halls and quintas" teaser | `GET /event-types`, `GET /public-events`, `GET /event-venues` |
| `/venues` | `VenuesPage.tsx`: every hall and quinta, filter `?type=hall\|quinta` | `GET /event-venues` |
| `/venues/:slug` | `VenuePage.tsx`: laid out like a restaurant's page (gallery, upcoming events, About, Find us with the map) | `GET /event-venues/{slug}` |
| `/events/staff` | `EventStaffPage.tsx`: sign in (`your-account/AccountSignIn`) or the events this account runs, by type, opening `/organiser/:id` | `GET /events`, `GET /account/work` |

- `EventCard.tsx`: one event. "Choose your seat" goes to its `join_path` (`/j/<token>`); that page already
  handles seeing the room, creating an account or signing in, and joining.
- `VenueCard.tsx`: one venue card.
- `eventsModel.ts`: the pure part (town of an address, places left, capacity, safe `?type=`), unit tested.
- `events-public.css`: tokens only.

Likely questions. *Why does the list wait for the types?* So an unknown `?type=` is dropped instead of
being sent (the server answers 422). *Why can a full event still be opened?* The shared-link page explains
why joining is closed and still shows the room. *Where is the Layout tab?* Not here: `events/OrganiserPage.tsx`
marks where the room layouts step adds it.
