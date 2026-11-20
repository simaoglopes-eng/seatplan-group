# Federico's SeatPlan execution plan

**Purpose:** create a clear, reviewable plan for improving the event organiser experience in Federico's fork. The team repository and its live deployment stay untouched.

## Product direction

Prioritize a friendly, intuitive organiser UI and dependable backend/API behavior. Improve the existing SeatPlan product rather than duplicating it. Do not prioritize new optimizer algorithms unless a user-facing improvement requires them.

## Work phases

### Phase 0 — isolate and understand (in progress)

- [x] Clone the public upstream repository locally.
- [x] Create Federico's personal fork and configure `origin` (fork) and `upstream-original` (team repo).
- [x] Identify team ownership: Federico owns event organiser and event optimizer.
- [x] Review existing organiser journey, UX notes, and backend services.
- [ ] Keep a clean record of baseline branch/commit and active changes.

### Phase 1 — make organiser actions obvious

- [ ] Finish drag/drop target feedback: visually distinguish valid free seats from occupied/blocked targets while dragging.
- [ ] Preserve and communicate the accessible keyboard alternative, “Place, then choose a seat”.
- [ ] Ensure dropping on invalid seats makes no assignment request and produces a clear explanation.
- [ ] Verify valid drops still work and that preview mode remains read-only.

### Phase 2 — simplify the organiser's main journey

Trace and improve one flow at a time:

1. Create an event and understand venue/date/access settings.
2. Add guests individually or import a CSV; make validation errors easy to fix.
3. Understand who has replied, who needs a seat, and where guests are seated.
4. Generate a proposed plan, understand changes, then apply or discard it confidently.
5. Handle late changes, undo/redo, and print/export the final plan.

For each flow, record the user problem, current behavior, desired behavior, acceptance criteria, affected frontend/backend files, and verification evidence before broad implementation.

### Phase 3 — backend and API clarity

- [ ] Trace the relevant route → schema → service → database path for each chosen UX issue.
- [ ] Keep validation and authorization on the server; client feedback is not a replacement.
- [ ] Preserve event locks, unique constraints, protected attendee choices, privacy, and all-or-nothing CSV import behavior.
- [ ] Improve response/error behavior only where the UI needs a clear, actionable explanation.
- [ ] Avoid unrelated optimizer changes.

### Phase 4 — integration and release preparation

- [ ] Review the complete diff and update relevant project documentation.
- [ ] Run focused checks and broader checks when Federico asks for verification; record exact commands and outcomes.
- [ ] Use a preview deployment for review only when explicitly requested.
- [ ] Share a PR with the team only when Federico explicitly asks; never deploy to team production without explicit authorization.

## Definition of done for each slice

- The user problem and acceptance criteria are written down.
- UI and backend behavior agree, including error/edge cases.
- Keyboard and screen-reader use remain supported.
- Existing booking, privacy, reservation, and accessibility rules remain intact.
- Verification evidence is accurately recorded; unverified behavior is labeled as such.
- Drive/repo project status is updated with changed files and remaining work.

## Suggested priority after the current task

After drag/drop feedback, audit the Guests tab for cognitive overload. The existing UX self-check calls out its length. Inspect the current screen and user guide, then consider progressive disclosure or clearer sections without removing guest search, filtering, add/import/export, or per-guest actions.
