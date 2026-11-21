# Independent SeatPlan setup

This is the personal `seatplan-events-federico` project. Do not use the group repository, project, database, email provider or secrets. The application is not ready for real users until the checks below pass.

## Local development

Use Node 22+ and Python 3.12. From the repository root:

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt -r backend/requirements-dev.txt
cd backend
DEMO_MODE=1 ../.venv/bin/python -m app.seed.migrate
DEMO_MODE=1 ../.venv/bin/python -m app.seed.run
DEMO_MODE=1 ../.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

In another terminal run `cd frontend && npm ci && npm run dev`. This uses local SQLite and demo data. Console email does not deliver verification codes; it is not a real email test. Avoid real personal data in demo mode. For local development against Neon, use an isolated development branch, never production.

## Verified production state (2026-11-16)

- The personal Vercel project serves the frontend and FastAPI backend at https://seatplan-events-federico.vercel.app/.
- Neon provides pooled `DATABASE_URL` and direct `DATABASE_URL_UNPOOLED` to this Vercel project. The initial migration ran after the live health check confirmed the database was empty.
- Live `GET /api/health` returns `status: ok`, `database: ok`, `schema: ready`. The temporary migration endpoint was removed afterward.
- Email delivery and public registration are not configured or verified. Do not create real attendee accounts yet.

## Remaining steps before real users

1. Configure a verified sending domain and mail provider: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM`. During testing, set `EMAIL_ALLOWLIST` to a controlled mailbox. After verifying delivery and privacy readiness, explicitly set `EMAIL_ALLOW_ALL=1` for public signups.
2. Configure `CRON_SECRET` and a secure personal scheduler that calls `POST /api/internal/email/process` with the `X-Cron-Secret` header. The group email workflow is not used by this copy.
3. Test registration, verification, sign-in, event creation, floor editing, invitations, simultaneous seat selection, privacy and age suggestions using test data. Also test phone and desktop layouts.
4. Review privacy wording, retention, account recovery and security before inviting real participants.

For future schema changes, run `python -m app.seed.migrate` from `backend` with `DATABASE_URL_UNPOOLED` set in a secure environment. Do not use a production URL for tests; use an isolated Neon test database because the PostgreSQL tests create and drop temporary databases.
