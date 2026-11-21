# Independent SeatPlan: implementation and release plan

This checkout and `seatplan-events-federico` are personal. The group repository, site, database and credentials are out of scope. Do not enter secrets in chat or Git.

## Completed

- English role-oriented home, organiser dashboard and participant entry points; existing event, floor-plan, assignment, reserved-seat and shared-link backend reused.
- Organiser and standalone participant registration with email verification, login and participant account pages. Shared-link registration is also available. Live registration remains unverified and fails closed until a real mail provider is configured.
- Participants select locally and the first successful confirmation gets the seat. Database uniqueness and event locking protect assignments. Legacy hold endpoints return 410; old clients must refresh.
- Event profiles support separate first and last names and optional date of birth. Age sharing is off by default and constrained by event privacy. Suggestions use ages explicitly shared by other participants. Existing account-level names are still stored as a single combined field.
- Email sending defaults to an allowlist; public delivery requires the explicit `EMAIL_ALLOW_ALL` setting. The legacy global organiser email log is unavailable outside demo mode.

- Premium responsive English design system applied to home, account entry, organiser dashboard, editor, participant map and account pages. Desktop and phone layouts were checked; local tests and the production build passed.
- Full-stack source is deployed to the personal Vercel project at https://seatplan-events-federico.vercel.app/.
- Neon is connected to this Vercel project. The live health endpoint returns `status: ok`, `database: ok`, `schema: ready`. The initial migration ran only after the endpoint confirmed that the database was empty; the temporary migration endpoint has been removed.

## Remaining before real users

1. Configure a verified mail sender (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`) and test verification using an allowlisted mailbox. Only then enable public delivery with `EMAIL_ALLOW_ALL=1`.
2. Configure `CRON_SECRET` and a scheduler for `/api/internal/email/process`; confirm queued mail retries and reminders.
3. Run controlled live checks for registration, login, event creation, table editing, privacy, age suggestions and simultaneous seat confirmation. Do not use real attendee data during testing.
4. Complete the security/privacy review, including organiser password recovery, retention, multi-organiser isolation, error handling and applicable privacy terms. Test on actual phones and with assistive technology.
5. Keep source changes on the already-linked private personal repository and deploy only through `seatplan-events-federico`. Confirm every workflow and deployment target remains personal; never link the group project.

Local SQLite and frontend tests are not evidence of real email delivery, PostgreSQL concurrency or production readiness. Do not claim those features work until the checks above pass.

See [independent setup](docs/INDEPENDENT_SETUP.md) for safe local setup and service configuration. Current tests use local SQLite unless explicitly stated otherwise; they are not evidence of Neon, real delivery or live deployment.
