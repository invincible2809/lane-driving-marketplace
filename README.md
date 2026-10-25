# Lane — availability-first driving instructor marketplace

Private working MVP for Birmingham and the West Midlands. All listed instructors, portrait photos, experience and slots are clearly labelled demo data. No real booking or payment is arranged.

## Run locally
Requires Node.js 24+. No dependencies or external keys needed.

```sh
npm run dev
# http://127.0.0.1:5173
npm test
npm run build
```

Local sign-in `/signin-with-chatgpt` uses an explicitly development-only identity. Hosted sign-in is owned by Sites; the deployed Worker never implements or simulates the sign-in routes. The local server strips incoming identity headers and sets its own demo identity only from the development cookie. Do not expose the development server publicly.

Local SQLite lives in ignored `.data/lane.sqlite`. Delete this file to reset local demo bookings. Hosted data uses Cloudflare D1 and is separate from local records. Migrate the schema in `drizzle/0000_marketplace.sql` before running the hosted API. Demo instructors and rolling future slots are inserted by the API using idempotent inserts; operational seed data is not in migrations.

## Architecture and screen hierarchy
The browser uses HTML, responsive CSS and modular JavaScript, backed by a standards-based fetch API in `api.mjs`. `server.mjs` supplies local SQLite through the same D1-shaped interface; `build.mjs` embeds assets and server code into a dependency-free Worker. This replaces the preferred Next.js/React stack because the Sites starter and build helpers were unavailable in this executor; the API and schema remain portable.

Home → postcode and availability search → list or illustrative area view → instructor profile and date/time selector → secure account → short learner onboarding → booking review → confirmation → My lessons → reschedule/cancel.

No results → waiting-list preferences → stored request → learner saved-search dashboard.

Instructor application → pending status → own availability editor. Private admin overview → aggregate demand and verification queue. A server-only `ADMIN_USER_ID` setting is required for actual verification; no user can choose an admin role in the UI.

## Database
- `learners`: site-scoped authenticated identity, name, email, postcode, preferences.
- `instructors`: owner identity, covered postcode districts, pricing, vehicle, biography, verification and demo flags.
- `slots`: individual two-hour availability windows, blocked flag and unique instructor/start.
- `bookings`: learner/slot, pickup postcode, duration, immutable booking total, status and creation timestamp. A partial unique index allows only one confirmed booking per slot, including simultaneous requests.
- `waiting_list`: user-owned saved location, transmission, day and time preferences.
- `searches`: foundational table reserved for future conversion analytics; not yet populated.

## Implemented
- Responsive discovery homepage and six clearly labelled demo instructors across the West Midlands.
- UK postcode format validation; exact postcode-district coverage matching.
- Manual/automatic, weekday/weekend, time of day, hourly cap, earliest availability/price/experience sorting.
- Profiles, live database-backed available slots and UK-local date/time display.
- Authenticated learner onboarding and durable user-owned records.
- One/two-hour demo booking, price review and confirmation; no charge collected.
- Booking concurrency protection; cancellation and same-instructor rescheduling release old slots.
- Saved instructors on the current device and durable user-owned waiting-list searches.
- Basic instructor application and individual availability creation; overlaps rejected.
- Admin record counts, postcode demand and guarded verification action.
- Input validation, origin checks, identity authorization, escaped dynamic HTML, no public location data.

## Current limits and production work
- Hosted authentication is ChatGPT/Sites sign-in. Independent email/password, Google, Apple and phone authentication are not implemented.
- Maps are explicitly illustrative, not geocoded. Add a licensed geocoder/maps provider, accurate distance/radius search, language/gender filters and real instructor verification.
- A two-hour slot is reserved even for a one-hour lesson; split-interval optimisation and travel buffers remain future work. Times are fixed UTC teaching windows rendered in Europe/London.
- Email/SMS matching alerts and reminders are not sent. Build consent, delivery, unsubscribe and scheduled matching workflows.
- No Stripe payments, subscriptions, commissions, refunds, featured ranking or financial reconciliation. Demo total is displayed before booking.
- Secure DVSA document collection, review evidence, real verified reviews, approval bookings, complaints and disputes remain to implement. Demo data never receives a verification badge.
- Instructor profile editing after application, recurring schedules, blocking/cancelling availability, instructor booking management, enquiries and earnings are not yet implemented.
- Admin is a foundation: aggregate private preview data and guarded verification. Separate role management, user moderation, booking administration, dispute handling and conversion/revenue analytics remain.
- Add retention/deletion/export, privacy controller details, UK GDPR review, monitoring, rate limits, audit logs, production backups and accessibility audit before public launch.
- Public launch requires real supply and a fresh production database; do not mix demo bookings with commercial lessons.

## Validation
API integration tests cover postcode/filter matching, two-user reservation conflict, booking ownership, reschedule/cancel availability recovery, pickup coverage, waiting-list ownership and unauthorized verification. Browser QA covers desktop learner onboarding/booking/cancellation and mobile availability/checkout. See `VALIDATION.md` for actual results and deployment limitations.
