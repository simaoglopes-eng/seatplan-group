# backend/app/core: read me first

## Purpose

Small building blocks that several routers share. None of them knows about a
specific vertical (events or restaurants).

## Key functions

| File | Function | What it guarantees |
|---|---|---|
| `errors.py` | `ApiError`, `SeatTaken`, `HoldExpired` | Raise these anywhere; `main.py` turns them into the uniform JSON error (with `details` only when given) |
| `holds.py` | `take_hold(...)` | Five-minute hold, committed; expired holds on the same spot are removed in the same transaction; a clash raises `SeatTaken` |
| `holds.py` | `confirm_hold(...)` | The holder still has a live hold; consumes it (no commit) or raises `HoldExpired` |
| `holds.py` | `commit_or_seat_taken(session)` | Commits the assignment or table slots; a UNIQUE clash becomes `SeatTaken` |
| `holds.py` | `release_hold(...)` | Drops the holder's hold (no commit) |
| `live.py` | `bump(session, scope)` | Adds one to the scope's change counter, committed with the caller's write |
| `live.py` | `GET /live/{scope}/version`, `GET /live/{scope}/stream` | Server-sent events, with polling as the browser's fallback; the stream ends after about 25 s, holds no worker thread while it waits, and is refused (429) past 30 opens a minute per address or 50 open on one instance |
| `audit.py` | `record(session, actor=, action=, entity=, entity_id=, detail=)` | One audit row, saved with the change it describes |
| `privacy.py` | `display_name(name, mode, wants_anonymous)` | `full_name` / `first_initial` ("Ana S.") / `anonymous` ("Guest") |
| `layout.py` | `save_layout(...)` | Upsert by id, delete what is missing, rebuild `seat_neighbours` |
| `neighbours.py` | `neighbour_pairs(table, seats)` | Pure geometry: who sits next to whom at one table |
| `members.py` | `is_member`, `member_venue_ids`, the owner's team list (`add`, `remove`, `listing`) | A venue's team is a list of addresses (`venue_members`); a work account with one of them works at that venue as staff. Used by every venue and event loader. An event's setup copy has no team: `is_member` checks its parent's |
| `parent_venue.py` | `shown_venue`, `shown_venue_of` | An event's own copy of a hall (`venues.parent_venue_id`) is named and shown as its parent; anything else as itself |
| `text.py` | `PlainText` | Request text a person types (names, notes, labels) never holds a control character such as NUL, which Postgres refuses; such text gets a 422 instead of a 500 |
| `limits.py` | the numbers only | Every usage limit in one place: party size (default 8, the booker's seat included) and the lifetime companion count, 3 restaurants, 3 event venues and 10 events per work account, 50 MB of photos per account, and the hourly create limits. Tests lower them with monkeypatch |
| `work_limits.py` | `require_room_for_venue`, `require_room_for_event`, `require_photo_room` | Under the account's row lock: 409 `limit_reached` past the restaurant, event venue or event limit, 409 `storage_full` past the photo storage. Demo venues and an event's setup copy are not counted |

## Data flow: a person picks a seat

```
take_hold()            INSERT into holds   -> UNIQUE clash? -> SeatTaken (409)
   ... person confirms ...
confirm_hold()         live hold for me?   -> no            -> HoldExpired (409)
session.add(SeatAssignment(...))
live.bump(session, "event-<id>")
commit_or_seat_taken() UNIQUE clash?       -> yes           -> SeatTaken (409)
```

Scopes for `live.bump`: `event-{event_public_id}` and
`venue-{venue_public_id}-{yyyy-mm-dd}`.

## Three likely walkthrough questions

**Why does the stream stop after 25 seconds?**
Serverless functions are not allowed to run forever and share no memory. A
short stream that re-reads a counter in the database works on any instance;
the browser's `EventSource` reconnects by itself. The stream is an `async`
generator: while it waits it holds no worker thread, so forty open streams
cannot stall the normal routes, which share the threadpool. Even so, polling
`/version` is the path we rely on; the stream only saves a little delay.

**Why is the hold not enough on its own?**
The winner's hold is consumed when they confirm. Someone who clicks a moment
later can then take a fresh hold, so the final guard is the UNIQUE constraint
on `seat_assignments` (or the primary key of `table_slots`), checked by
`commit_or_seat_taken`.

**Why is `slot_key` an empty string instead of NULL for seats?**
In SQL two NULLs are never equal, so a UNIQUE constraint would let two holds
with a NULL slot through. An empty string compares equal, so the constraint works.
