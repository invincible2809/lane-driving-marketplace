# Verification report — SRK website, learner portal and instructor admin

Run on 12 November 2026, Node 22.23, Chromium (Playwright), local SQLite.

## Automated tests — `npm test`: 36 passed, 0 failed

| Area | What is verified |
|---|---|
| Time zones | GMT/BST conversion; 29 Mar and 25 Oct 2026 gap/overlap times rejected; working hours correct on 23- and 25-hour days. |
| Availability | Travel buffers (exact-boundary allowed, one minute inside refused), holidays/blocks, booking notice, horizon, date exceptions. |
| Booking engine | State machine and roles; two simultaneous holds → one 201, one 409; two simultaneous instructor bookings → one succeeds; raw SQL insert of an overlapping lesson is refused by the database trigger; stale edits refused by revision check. |
| Recurring lessons | Preview; "all or nothing" creates nothing on conflict; "skip conflicts" creates the rest and lists skipped dates. |
| Reminders & jobs | Reschedule cancels obsolete reminders; running jobs at the old reminder time sends nothing; a failing provider retries without duplicates; a crashed job is re-claimed without resending; overdue 48 h reminder is skipped once the 24 h one is due. |
| Permissions | Other instructors cannot read learners; learners cannot access another learner's lessons or any workspace endpoint; platform overview contains no learner details. |
| Privacy | Private notes never appear in learner responses; drafts hidden until shared; published reports cannot be edited in place; emails omit pickup addresses. |
| Policies | Accepted cancellation-policy version stored; stale version refused; late learner cancellation requires acknowledgement and is recorded. |
| Google sign-in (token endpoint mocked) | PKCE S256, single-use state, nonce check, verified email required, open redirect refused, secure cookie flags, logout ends session, owner-only workspace creation, spoofed identity headers ignored. |
| Enquiries | Consent required; phone or email required; honeypot dropped; per-address rate limit; no-JavaScript form post; instructor notified (preview); conversion links a signed-in visitor's account. |
| Build | The bundled Worker serves pages, assets, API, auth and runs the cron handler. |
| Vercel + libSQL | The Vercel function on a libSQL database: migrations (idempotent), Google sign-in, enquiries, double-booking trigger, cron secret. `vercel build` (Vercel CLI) completed successfully and the built function served pages and API. |

## Browser journeys — `npm run test:e2e`: 28/28 checks passed (390×844)

Visitor enquiry → instructor dashboard banner → enquiry converted to learner → private note → lesson booked from free times → calendar day/week/list → learner sees shared report and no private notes → learner books (terms shown before confirming) → second learner sees nothing of the first → instructor accepts the request. No horizontal scrolling on any page checked; no browser console errors.

## Accessibility

axe-core 4.10.2 (WCAG 2.0/2.1 A and AA, plus 2.2 AA rules) reported **no violations** on: home, contact, instructor dashboard, calendar, learner home (and enquiry flow pages exercised in the journey). Manually built in: labelled form fields, skip link, focus moved to the page heading on navigation, status shown as text not colour alone, 44 px touch targets, reduced-motion support.

Not done: screen-reader testing (NVDA/VoiceOver), keyboard-only walkthrough of every page, colour-contrast review of screenshots by a person. Automated checks catch roughly a third of WCAG issues, so this is not a conformance claim.

## Not verified

- Real Google sign-in (needs credentials), real email delivery (needs provider), an actual Vercel deployment and hosted Turso database (tested with Vercel's CLI build and a local libSQL file), load/performance.
