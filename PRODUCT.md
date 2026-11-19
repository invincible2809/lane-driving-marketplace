# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The instructor (primary user): Shahrukh, SRK Driving School.** An independent instructor who runs his own school. The instructor admin (`/app`) is used mainly **on a phone between lessons**: checking the day, accepting or declining requests, completing a lesson and writing the progress report. Desk and laptop use for weekly planning is secondary.
- **Learners.** People learning to drive, including nervous beginners and returning drivers. They sign in with Google at `/account` to see lessons, book from free times, cancel, and read the progress reports the instructor shares.
- **Prospective learners.** Visitors to the instructor's public website who send an enquiry.

## Product Purpose

Lane is, for now, SRK Driving School's own website, learner portal and instructor admin. It gives the instructor one place for their public website, enquiries, calendar, learner records, lesson booking and progress reports, so they spend less time on admin and double-bookings and more time teaching. Success is an instructor (SRK) who runs the whole school from a phone and a learner who can see their progress and book without phoning.

## Positioning

Built for one real school, SRK Driving School, and personal to it rather than a generic marketplace. The earlier learner marketplace is frozen and not part of the product. It differs from a booking-only tool by combining the instructor's own public site, enquiry inbox, double-booking protection enforced in the database, and shared progress reports in one deployment.

## Operating Context

- Instructors work from the car and the doorstep, so quick, thumb-friendly, interruption-tolerant flows matter more than dense desktop views.
- Times are shown in the workspace time zone (default Europe/London) and stored as UTC; BST and GMT changes are handled and nonexistent or repeated clock times are rejected.
- Emails (confirmations and 48 h / 24 h reminders) go through durable jobs; locally they are preview-only.
- Runs on Node with SQLite for development and on Vercel with a Neon (PostgreSQL) database when hosted (Turso also supported). `DEMO_MODE=true` turns a deployment into a labelled, non-indexed demo with sample data and one-click sign-in.

## Capabilities and Constraints

- Public pages: `/`, `/services`, `/about`, `/areas`, `/faq`, `/contact`, plus privacy and terms. Server-rendered, work without JavaScript. The contact form creates an enquiry in the admin.
- Learner portal `/account`; instructor admin `/app` (dashboard, calendar day/week/list, learners, enquiries, lessons, progress reports, payment records, settings).
- Business content lives in `business.config.mjs`.
- Strict CSP: scripts and styles from the same origin only, no inline styles or scripts.
- **Scope decision: SRK only for now.** The build serves one business per deployment (`OWNER_EMAILS`, `SITE_WORKSPACE_ID`). Extending to other instructors is a later option, and each would get a site made personal to them rather than a re-skin of SRK's. Do not build multi-tenant features, per-instructor theming or billing (Phase B) until that is decided.
- Not built yet: subscription billing, waiting-list automation, data export and deletion, retention jobs, error monitoring, SMS/WhatsApp reminders, calendar sync.
- Undecided or unconfirmed: real Google sign-in credentials, live email provider, hosting and DNS cut-over, privacy notice and terms wording (drafts with `[TO CONFIRM]`).

## Brand Commitments

- **SRK Driving School**, automatic lessons in Sutton Coldfield and north Birmingham. Everything is written in SRK's voice for SRK's learners.
- Tone in existing copy is calm, patient and plain, aimed at nervous and returning learners.
- The codebase and README call the platform "Lane"; learners see only the SRK brand.

## Evidence on Hand

- Confirmed by the owner (12 Nov 2026): the packages and prices (£40 single lesson, £380 block of 10, £760 intensive, £130 test day), the 5.0 Google rating from 13 reviews (shown with its "as of" date), and the office hours (Mon to Fri 09:30 to 19:00, Sat and Sun 09:00 to 14:00).
- Real content: SRK contact details, areas covered and instructor bio in `business.config.mjs`.
- Nine real Google reviews with names and dates, copied verbatim from the owner's own site (srkdrivingschool.co.uk) into `business.config.mjs`. The old site's initials-only testimonials are not used.
- Absent, do not fabricate: pass rates, learners-passed counts (the old site's "500+ passed" and "98%" are unevidenced), case studies, press. `stats` is deliberately empty.
- Verification report in `VALIDATION.md`: 35 passing tests and 28 browser checks; axe-core found no violations on the pages checked. Real Google sign-in, live email and production D1 are unverified.

## Product Principles

1. The instructor's phone is the main control room; the learner-facing and admin flows must work one-handed at 390px.
2. Never double-book and never lose a booking: correctness and clear conflict messages beat convenience.
3. Show only what is true: figures, ratings and policies carry their date or source, and unconfirmed claims stay out.
4. Calm and plain beats clever: learners may be nervous, and the instructor is busy.
5. Private by default: instructor notes never reach learners, and learner data is scoped to its workspace.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Labelled form fields, skip link, 44px touch targets, status shown as text as well as colour, reduced-motion support. Automated axe checks have passed, but screen-reader and full keyboard walkthroughs have not been done, so this is not a conformance claim.
