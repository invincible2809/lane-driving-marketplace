# Lane — driving instructor marketplace

Private availability-first marketplace for Birmingham and the West Midlands. All bookings remain preview transactions: no real lesson or payment is arranged. Seeded instructor profiles are labelled demo and never receive verification badges.

## Run locally

Requires Node.js 24+. No dependencies or external keys are needed for local use.

```sh
npm run dev
# http://127.0.0.1:5173
npm test
npm run build
```

Local `/signin-with-chatgpt` signs in as the development-only identity `local-preview`, with email `preview@lane.test`. Set `ADMIN_EMAIL=preview@lane.test` for local administrator testing. The development server strips inbound identity headers and supplies its own local identity. Never expose it publicly. Hosted authentication is provided by Sites; production code does not implement or simulate the sign-in routes.

Local SQLite lives in ignored `.data/lane.sqlite`; private local documents live in `.data/documents/`. Local migrations run automatically and are tracked in `local_migrations`; existing baseline databases are upgraded without resetting their records. Hosted D1 and R2 are separate from local data. Sites applies the append-only SQL migrations at deployment.

## Current features

- Postcode-district coverage and availability-first search; transmission, weekday/weekend, time-of-day, hourly price and sorting filters.
- Profiles and date/time selection, with 1, 1.5 and 2-hour lesson durations. Exact teaching intervals are reserved; shorter bookings do not consume an entire teaching window.
- Learner onboarding, booking review/confirmation, cancellation and same-instructor rescheduling.
- Instructor profile creation and editing, ADI/PDI details, registration expiry, vehicle, languages, pricing, coverage, booking policy and travel buffers.
- Private PDF/JPEG/PNG registration and identity evidence uploads (5 MB/file, five files/application), with authenticated downloads for the owner and administrator. Downloads are attachments and are not publicly addressable assets.
- Draft → submitted → verified/changes-requested/rejected application workflow. Approval requires evidence, registration details, expiry, three explicit check attestations and review notes. Decisions record reviewer identity. Administrators cannot approve their own applications; identity or evidence changes require re-verification.
- One-off teaching windows, weekly schedules for an explicit range of up to 12 weeks, date blocks and per-window blocking. Stopping a recurring schedule preserves active bookings and blocks the other future windows.
- UK-local recurring times with daylight-saving handling. Nonexistent and ambiguous wall times are rejected with an explanation.
- Instructor booking requests: accept, decline, cancel or propose another time. Learners must accept proposals; the original booking remains reserved meanwhile. Proposed times are subject to availability and are checked atomically when accepted.
- Immediate in-app booking/request/change/cancellation notifications for both accounts, read/unread status, and an email outbox.
- Idempotent reminders for confirmed lessons in the next 24 hours; manual administrator processing and a protected unattended worker endpoint.
- Waiting-list saved searches and basic postcode-demand analytics. Automatic matching alerts are still a later phase.
- Administrator review queue, private evidence review, aggregate demand, notification delivery counts and reminder-worker status.

## Architecture

`public/` contains responsive HTML/CSS and browser JavaScript. `api.mjs` owns validation, identity and role checks, instructor operations and booking APIs. `scheduling.mjs` handles UK time conversion and interval availability. `notifications.mjs` generates reminders and processes email delivery. `server.mjs` supplies local SQLite and filesystem-backed private documents through D1/R2-shaped interfaces. `build.mjs` embeds the UI and server modules into a dependency-free Cloudflare Worker.

Sites was used with a direct Worker build because its supplied framework helpers were unavailable in this environment. The application does not use Next.js/React. The API and SQL schema remain portable.

## Database and concurrency

The baseline tables remain `learners`, `instructors`, `slots`, `bookings`, `waiting_list`, and `searches` (reserved for future conversion analytics). The additive operations migration adds `verification_documents`, `verification_reviews`, `recurring_rules`, `blackouts`, `notifications`, `email_outbox`, and `job_runs`.

Database triggers enforce interval-level booking conflicts for both instructor and learner, including instructor travel buffers. Both confirmed and pending approval bookings reserve time. Triggers reject bookings in blocked windows, date blocks, expired/unverified instructor profiles, and overlapping availability windows. Active bookings cannot be silently blocked. Legacy bookings use their existing slot start and duration when new interval fields are null.

Booking creation/change and notification/outbox insertion occur in one database transaction through triggers. Booking revisions prevent stale concurrent edits and give rescheduled lessons new reminder keys. Reminder inserts use unique event keys, so repeated worker runs do not duplicate reminders. Outbox claims use leases and provider idempotency keys; unsuccessful deliveries retry with backoff and stop after five attempts. Superseded queued booking events are not sent.

## Runtime configuration

Set values through Sites environment settings; never commit secrets.

- `ADMIN_EMAIL` or `ADMIN_USER_ID`: identifies the administrator using authenticated Sites identity. The app never accepts a client-selected role.
- `BUCKET`: private R2 binding, declared in `.openai/hosting.json`.
- `RESEND_API_KEY` and `EMAIL_FROM`: optional transactional email delivery. Use a verified sender/domain. **Without both values, no email is sent or marked delivered.** Users receive in-app notices and the administrator sees the disabled state.
- `JOB_SECRET`: optional bearer secret for an external scheduler. Store it in runtime secrets.
- `PRIVATE_JOB_ACCESS=true`: allows the private reminder worker to use the owner-only Sites service-access boundary without a learner identity. This is configured only for the owner-private preview. **Remove this flag before widening Site access or launching publicly; use a secret-authenticated worker instead.**

No real email provider credentials are currently configured. The adapter is tested with a mock transport. Live delivery requires a provider key and verified sender, followed by a controlled delivery test.

## Reminder worker

`POST /api/jobs/reminders` creates upcoming lesson reminders and processes eligible outbox messages. `GET /api/jobs/reminders` returns the latest persisted worker run, aggregate outbox status and email-configuration state; it contains no learner details. Access requires an administrator, `JOB_SECRET`, or the explicitly configured owner-private Sites service boundary.

For the private Site's linked hourly task: obtain current Site access with `get_site`; confirm it remains owner-private; use the returned service-access token only in the Site's `OAI-Sites-Authorization` header. POST to the worker and GET the status for readback. Keep tokens in memory; do not put them in source, logs or prompts. This job updates data without republishing. Do not replace or reset bookings or create test learners during a scheduled run. If credentials or private access cannot be verified, stop and report the failure rather than altering access controls.

An hourly cadence means a reminder is normally generated between 23 and 24 hours before a lesson, or at the next run for a newly booked lesson closer than 24 hours away. Booking updates appear immediately in-app; optional emails are delivered on the next worker run.

## Before a public pilot

- Configure and verify transactional email delivery. Monitor retries/failures and sender reputation.
- Complete document retention/deletion and malware scanning, a signed privacy policy and UK GDPR processes. Limit real identity uploads until those operational policies are ready.
- Add independent learner/instructor authentication if access outside ChatGPT is required.
- Add licensed postcode geocoding, radius/distance matching and a real map; the current area view is labelled illustrative.
- Complete payments, refunds/payouts, real review moderation, complaints and disputes before commercial bookings.
- Add secure production role administration, monitoring, backups, rate limiting, export/deletion, accessibility audit and operational support.
- Add instructor photo upload, recurring-schedule extension/editing, cancellation policies and automatic waiting-list matching/alerts as follow-up features.
- Use an instructor-approved real pilot dataset. Never convert the demonstration records or their photographs into real verified instructor identities.

## Validation

`npm test` runs nine integration tests covering the baseline learner flow and the new instructor operations, verification, private documents, interval reservations, travel buffers, request approvals, proposals, recurrence, blackouts, notification ownership, reminder idempotency, email retries, daylight-saving boundaries and a non-destructive baseline database upgrade. See `VALIDATION.md` for browser and hosted checks.
