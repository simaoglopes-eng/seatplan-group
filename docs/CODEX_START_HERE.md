# Codex start here — Federico's SeatPlan work

Read this file at the start of each new Codex session, then read the current status and execution plan linked below.

## Objective

Improve the SeatPlan event organiser experience so it feels clear and easy to use, with frontend flows supported by reliable backend/API behavior. Federico is responsible for the organiser side of events according to `docs/team/tasks.md`.

## Repository and deployment boundaries

- Team upstream: `https://github.com/simaoglopes-eng/seatplan`
- Federico's current fork: `https://github.com/f3deric0/seatplan`
- Work branch: `federico/event-organiser-audit`
- Local checkout: `seatplan-federico`
- The public Vercel site currently associated with the team repository is outside this workstream. Treat it as production: do not deploy to it or change its configuration without an explicit request.
- Keep all implementation in the personal fork until Federico asks to share it with the team.

## First task in progress

Make organiser drag-and-drop feedback clearer: while dragging a guest over the map, indicate whether the target seat is available before drop. The current code already rejects occupied seats and announces the reason after a drop; do not reimplement or weaken that server-side validation.

Current implementation edits touch `OrganiserMap.tsx`, `SeatMap.tsx`, `Targets.tsx`, and their CSS. They have not been tested in a browser or with the project test suite. Check `git status` before continuing.

## Resume sequence

1. Read `PROJECT_STATUS_FEDERICO.md`.
2. Read the active phase and acceptance criteria in `PROJECT_EXECUTION_PLAN.md`.
3. Inspect current diff and relevant UI/API implementation.
4. Finish the active slice, then update status and progress notes.
5. Continue with the next highest-priority organiser flow in the plan.

## Important verified references

- `docs/team/tasks.md` — ownership and file map.
- `docs/CONTRACT.md` — shared API/data and safety contract.
- `docs/ux-events.md` — UX journeys and known usability gaps; validate old statements against current code.
- `docs/user-guide-organiser.md` — organiser capabilities and API journey.
- `docs/optimiser-events.md` — optimizer details; consult only where needed for organiser UI/backend behavior.
