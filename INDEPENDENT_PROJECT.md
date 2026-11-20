# Independent SeatPlan Events project

This checkout is Federico's personal SeatPlan Events application. Work only in this copy. Do not deploy to, configure, or write data to the group project. The personal source repository is private at `f3deric0/seatplan-events`; the personal Vercel project is `seatplan-events-federico`.

## Verified service state

- Personal site: https://seatplan-events-federico.vercel.app/.
- Neon is attached to this Vercel project. The live health endpoint was verified with `status: ok`, `database: ok`, and `schema: ready`; the initial migration was run after confirming that database was empty.
- The mail provider and sender domain are not configured. Real account verification and email delivery must not be presented as working until configured and tested.
- No group repository, site, database, deployment, or credentials are used by this checkout.
- Do not commit credentials or `.env` files. Keep local tests and development on isolated SQLite or a non-production Neon branch.

## Before real users

1. Configure a verified mail provider on the personal Vercel project (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `EMAIL_FROM`). Start with a controlled `EMAIL_ALLOWLIST` and verify delivery before enabling public sign-up with `EMAIL_ALLOW_ALL=1`.
2. Configure a personal scheduler with `CRON_SECRET` for `/api/internal/email/process`, then check retries and reminders. The group email workflow is not used here.
3. Verify registration, sign-in, event creation, floor editing, privacy, age suggestions, and simultaneous seat confirmation with synthetic data. Check both desktop and phone layouts.
4. Complete the security and privacy review, including password recovery, retention, organiser isolation, and privacy wording.

See [independent setup](docs/INDEPENDENT_SETUP.md) and [the implementation plan](PIANO_SEATPLAN.md) for local commands and remaining work. Local tests do not prove live email delivery or PostgreSQL concurrency.
