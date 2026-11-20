# e2e: browser tests

**Purpose.** Drive the real app in headless Chromium, the way a guest, an
organiser, a diner and a member of staff would use it.

**How a run works.** `npm run e2e` (from `frontend/`) starts Playwright with
`playwright.config.ts`, which first starts two servers:

1. `servers/backend.mjs` makes a temporary folder, seeds a new SQLite database
   there with the demo data (`python -m app.seed.run`) and starts uvicorn on
   port 8765. When the run ends it deletes the folder.
2. `servers/frontend.mjs` builds the frontend into another temporary folder and
   serves it on port 4317 with the `vercel.json` security headers, forwarding
   `/api` to the backend.

Then the tests run one at a time. Results and traces go to the system
temporary folder, never into the repository.
Each Playwright process now has its own top-level output folder
`seatplan-e2e-results-<pid>` so another worktree cannot delete active traces.
Use distinct E2E_API_PORT/E2E_WEB_PORT when running alongside another worktree.

**Files.**

| File | What it checks |
|---|---|
| `attendee.spec.ts` | Pick, hold and confirm a seat; a second attendee cannot take it |
| `mobile.spec.ts` | The attendee flow, and a visitor's sign-up through the shared link, at 390 x 844 with touch (the `mobile` project); no sideways scrolling |
| `guest-account.spec.ts` | The shared link, in order: a visitor sees the map but cannot hold; creates an account with the demo code; holds and confirms a seat; the outbox has one seat email with the picture; signs out and back in; a second visitor cannot take the seat; the organiser switches the link off (and on again for the files after it) |
| `organiser.spec.ts` | Auto-fill preview, apply, undo |
| `restaurant.spec.ts` | Diner books and cancels through the manage link; staff seat a walk-in |
| `restaurant-reviews.spec.ts` | Customer login returns to Reviews; publish 10/10, reload, edit to 0/10, filter and delete; totals update after each write |
| `restaurant-ambience.spec.ts` | Real isolated restaurants: rooms, daylight/night cursor, optional chair through confirmation/manage at 1440/390 px; simultaneous real holds yield 201/409 and the loser can take an alternative |
| `restaurant-fixture.ts` | Prepares owned profile, hours and two rooms via real APIs; no mocked server responses or mutation of shared demo |
| `room-editor.spec.ts` | Full 10 x 7 m room workflow with touch enabled, save/reload, two-tab stale-layout recovery and saved daylight/night preview |
| `owner.spec.ts` | Owner publishes/unpublishes at 1440/390, drafts reject diner access, existing booked chair/manage link survives, axe on review/draft/manage; discovery itself awaits tasks 25/26/29 |
| `accessibility.spec.ts` | axe-core scan (WCAG 2.1 A and AA) of the main pages, the event booking, venue and account pages included, including the visitor page, the create-account form and the guest sign-in page |
| `restaurant-deposit.spec.ts` | Deposits with the demo provider: terms must be accepted, the booking is pending until paid on the demo page, staff see the deposit, cancelling in time refunds it, giving up frees the table, the owner sets the rules |
| `event-layouts.spec.ts` | Event room layouts: Rita (event staff) switches Sofia and Tiago's wedding from Banquet to Theatre in the Layout tab, confirms because guests are seated, every seated guest sits on the new map, Fine-tune opens the same copy in the editor, and Leonor's christening lunch at the same quinta keeps its setup, copy and seats. One sign-in. It leaves the wedding on Theatre for later specs, which only read its name, type and hall |
| `events-parity.spec.ts` | Events parity and one account: the two-entry `/demo` cards, create an account with the demo code then sign out and in (Booking and Staff), an owner adds a team member who opens the service floor, a quinta's owner adds a member from Staff (Team page in venue words) who then sees the quinta and its events, Event booking by type to the seat step, Event staff to the organiser workspace, no sideways scroll at 390 px |
| `fixtures.ts` | Demo links, sign-in, and the rule that fails a test on a page error or a CSP violation |
| `attendee-steps.ts` | Attendee steps shared by the desktop and phone tests |

**Likely questions.**

- *Why one test at a time?* All tests share one database. Running them in a
  fixed order keeps every run the same.
- *Why not `vite preview`?* Its `/api` proxy always points at port 8000, which
  a developer's own backend may be using. Our small server lets the tests use
  their own ports and also sends the production security headers.
- *Where do the demo links come from?* `GET /api/demo/links`, which only
  answers when `DEMO_MODE=1`, as it is for this temporary backend.
