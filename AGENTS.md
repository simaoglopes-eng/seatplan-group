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

## Restaurant work (Martim's branch notes)

Never work on main. Use martim/restaurantes-impl for the approved overnight work.
One task and one verified commit at a time. No push or PR without Martim's instruction.

Spec: docs/superpowers/specs/2026-11-13-restaurantes-plataforma-design.md.
Plan: docs/superpowers/plans/2026-11-13-restaurantes-plano.md.
Update docs/superpowers/plans/relatorio-noite.md after each task.
Read each folder's READ_ME_FIRST.md before editing. Tests first for pure logic and security.

Never edit event paths: frontend/src/pages/events/, frontend/src/pages/editor/,
frontend/src/pages/join/, frontend/src/pages/account/, backend/app/events_service/,
backend/app/routers/events.py, attendee.py, guest_*.py and visitor.py.
Importing existing pure helpers is allowed. Preserve event behavior in shared modules.

Windows checks from backend: ..\.venv\Scripts\ruff.exe check .,
..\.venv\Scripts\ruff.exe format --check . and ..\.venv\Scripts\python.exe -m pytest -q.
From frontend: npm run typecheck, npm test, npm run build, npm run contrast, npm run e2e.
For e2e set E2E_PYTHON to the absolute .venv\Scripts\python.exe path.
From root: .\.venv\Scripts\python.exe scripts/check_forbidden_paths.py --base main.

Only the known concurrent guest verification test may be rerun in isolation to accept baseline.
For other baseline regressions, record the attempt, verify martim/restaurantes-impl,
recover the last green commit as authorized by Martim, restore the report and continue.
Never delete or weaken tests. Only new dependencies allowed: leaflet@1.9.4 and @types/leaflet.
