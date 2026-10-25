# Validation — instructor operations release

## Automated checks

- `npm test`: 9 tests passed (3 baseline marketplace, 6 instructor-operations suites).
- Client, API, operations module, local server and generated Worker syntax checks passed.
- Upgrade test opens an existing baseline SQLite database, applies the additive migration and preserves its learner records; migration replay is idempotent locally.
- Verification tests cover missing evidence, spoofed PDF rejection, document access isolation, administrator-only review, required approval checks, immutable review history and re-verification after identity edits.
- Calendar/booking tests cover partial-window lessons, travel buffers, overlapping reservations, approval request holds, same-instructor proposals and acceptance, cancellations/declines, date blocking, recurring-window conflicts and schedule stopping that preserves bookings.
- Notifications tests cover record ownership/read status, reminder deduplication, worker authorization, honest disabled-email state, mocked provider delivery/idempotency and failure retry. No real email was sent during tests.
- UK-time tests cover GMT/BST conversion and rejected nonexistent/ambiguous clock-change times.

## Browser checks (local Chromium)

- Desktop 1440×1050: private evidence review and administrator approval; instructor profile editing, private file upload and application submission; one-off availability creation, block/reopen and recurring schedule creation passed.
- Mobile 390×844: instructor calendar has no horizontal overflow; 1.5-hour learner booking, confirmation, rescheduling, notifications and mark-all-read passed.
- No browser JavaScript errors were observed.
- Test applicants and evidence exist only in ignored local QA data; they are not copied to hosted D1/R2.

## Deployment checks

The app is deployed only to the existing owner-private Site. Hosted migration, search and reminder-worker checks are performed during the release; the final response reports their returned state. Interactive authenticated workflows were browser-tested locally rather than in the hosted visitor session. Real email delivery remains unverified until a provider key and verified sender are configured.
