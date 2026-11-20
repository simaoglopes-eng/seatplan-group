# Codex project instructions

## Project and safe workspace

- This checkout is Federico's personal fork of `simaoglopes-eng/seatplan`.
- Work only in the personal fork and the current feature branch unless Federico explicitly directs otherwise.
- The team repository is `upstream-original`; never push to it or change its branches/settings.
- Do not deploy to the existing Vercel production site or change its environment/database. Use a preview deployment only after Federico explicitly asks for deployment.
- The current task priority is the event organiser experience: intuitive frontend flows and the backend/API behavior that supports them. Optimizer algorithm research is out of scope unless a UI/backend change depends on it.

## How to resume work

1. Read `docs/CODEX_START_HERE.md`.
2. Read `docs/PROJECT_STATUS_FEDERICO.md` and the active phase in `docs/PROJECT_EXECUTION_PLAN.md`.
3. Check `git status`, branch, and remotes before editing.
4. Inspect relevant existing code and acceptance criteria; do not assume a feature is missing just because an old UX note says so.
5. Implement one small, reviewable slice at a time. Update the status and progress log in the same branch.

## Change and verification rules

- Keep changes focused on event organiser frontend/backend work and avoid unrelated verticals.
- Preserve attendee-selected seats, accessibility and reservation rules, privacy, and server-side validation.
- Explain user-facing changes in plain language; keep UI accessible for keyboard and screen-reader use.
- Do not add dependencies without a clear need.
- Do not claim checks passed unless they were actually run. Before changing behavior, identify the relevant existing tests and propose the verification commands; execute them when Federico asks for verification or testing.
- Never commit, push, open a PR, merge, or deploy unless Federico explicitly requests that action.

## Documentation locations

- Start/resume: `docs/CODEX_START_HERE.md`
- Plan: `docs/PROJECT_EXECUTION_PLAN.md`
- Current state: `docs/PROJECT_STATUS_FEDERICO.md`
- Historical project and ownership docs: existing `docs/` files, especially `docs/team/tasks.md`, `docs/CONTRACT.md`, `docs/ux-events.md`, and `docs/user-guide-organiser.md`.
