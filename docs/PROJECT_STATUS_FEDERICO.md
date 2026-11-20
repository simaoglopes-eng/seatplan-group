# Federico work status

**Updated:** 2026-11-14 (Europe/Brussels)  
**Repository:** personal fork `f3deric0/seatplan`  
**Branch:** `federico/event-organiser-audit`

## Goal

Make SeatPlan's event organiser workflows easy and intuitive, focusing on frontend and the backend/API behavior required to support them. The optimizer algorithm itself is not the current priority.

## Current state

- Local clone exists at `seatplan-federico`.
- GitHub fork is `https://github.com/f3deric0/seatplan`.
- `origin` points to the fork; `upstream-original` points to the team's repository.
- Work is isolated from the team repository and its existing Vercel deployment.
- Team ownership documentation assigns Federico the event organiser and events optimizer vertical.
- Read-only independent reviews of the organiser frontend and backend are saved in the Programming Drive under `04_Team_and_Agents`.

## Changes currently in the local branch

- Updated the UX self-check to describe the real drag/drop limitation precisely: invalid occupied-seat drops are rejected and explained after drop, but no unavailable cue appears while dragging.
- Added visual drop target state and a short hint in the organiser map for free versus unavailable seats.
- Changed the shared SeatMap target props/styles to show the active drop target.

These edits are local and uncommitted. They have not been tested in a browser or run through the test suite. Do not describe them as complete until verified.

## Decisions

- Keep the original team repository unchanged.
- Develop in the personal fork first.
- Prioritize organiser UI and supporting API/service behavior over optimizer algorithm work.
- Do not push, open a PR, merge, or deploy without Federico's explicit request.

## Next steps

1. Inspect the current diff and finish the drag/drop feedback behavior.
2. Verify valid, occupied, and blocked seat targets, preview mode, and keyboard placement.
3. Update this file with real verification results.
4. Move to the organiser Guests tab, which the UX notes identify as a long, dense screen; map improvements to acceptance criteria before coding.
