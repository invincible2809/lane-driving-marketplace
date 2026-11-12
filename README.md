# SRK Driving School — website, learner portal and instructor admin

One deployment provides:

| Path | Who | What |
|---|---|---|
| `/`, `/services`, `/about`, `/areas`, `/faq`, `/contact` | Public | SRK's website. The contact form creates an **enquiry** that appears straight away in the instructor admin. |
| `/account` | Learners | Sign in with Google to see lessons, book times, cancel, and read the progress reports the instructor shares. |
| `/app` | Instructor (owner) | Dashboard, calendar (day/week/list), learners, enquiries, lessons, progress reports, payment records, reports, settings. |

Business content (address, phone, prices, areas, instructor bio) lives in **`business.config.mjs`**. Items marked `CONFIRM` need the owner's check — see "Launch blockers".

The original learner marketplace is frozen behind `MARKETPLACE_ENABLED=true` and is not part of this product.

## Run locally

Requires Node.js 22.5+ (uses the built-in `node:sqlite`). No dependencies to install.

```sh
npm run seed      # demo workspace, learners, lessons, a shared report and two enquiries
npm run dev       # http://127.0.0.1:5173
```

Locally, "Sign in" opens a **development identity chooser** (instructor, two learners, platform admin) because Google credentials are not configured. The dev server strips any inbound identity headers; never expose it publicly.

Emails are in **preview mode** by default: nothing is sent; every email is visible under *Settings → Sent emails*.

## Tests

```sh
npm test          # 35 unit + integration tests (domain rules, API, auth, enquiries, build)
npm run check     # syntax check of entry points and browser scripts
npm run test:e2e  # Chromium journeys at 390×844; set AXE_PATH=/path/to/axe.min.js for WCAG checks
npm run build     # dist/server/index.js (Cloudflare Worker) + wrangler.json + migrations
```

## Architecture

- `lib/` — domain rules with no HTTP or database code: time zones and BST (`time.mjs`), availability and buffers (`availability.mjs`), lesson states and cancellation rules (`lessons.mjs`), progress (`progress.mjs`), durable jobs and reminders (`jobs.mjs`), email adapters (`mailer.mjs`), calendar adapter interface (`calendar.mjs`), email templates, public site renderer (`site.mjs`).
- `instructor-api.mjs` — JSON API. Every query is scoped server-side to the signed-in owner's workspace or the learner's own record.
- `auth.mjs` — Google OpenID Connect (authorisation code + PKCE, state, nonce, verified email) and server-side sessions (only a SHA-256 of the session token is stored; cookie is `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` on HTTPS).
- `app.mjs` — router shared by the Node dev server and the Worker. `worker-entry.mjs` adds the cron trigger.
- `public/site/public.css` — the public website's styles; `app.css` holds the shared tokens and the portal. Fonts in `public/site/fonts` are Archivo and Atkinson Hyperlegible (SIL Open Font License), self-hosted because the content security policy only allows same-origin sources.
- `drizzle/` — append-only SQL migrations (SQLite / Cloudflare D1).

**Double-booking protection.** Database triggers refuse any lesson or slot hold that overlaps another active lesson, an unexpired hold, a blocked period, or the travel buffer — so two simultaneous requests cannot both succeed. Learners get a 10-minute hold while they review the details and cancellation terms; the accepted terms version is stored with the booking.

**Reminders.** 48 h and 24 h emails are durable jobs with unique keys. Rescheduling or cancelling cancels the old jobs; a stale job that still runs is discarded because the lesson revision changed. Jobs left mid-run are re-claimed after a 5-minute lease; a message already marked sent is never resent, and the provider receives a stable idempotency key.

**Time.** All instants are stored as UTC milliseconds and shown in the workspace time zone (default Europe/London). Lesson times that do not exist or occur twice at the clock changes are rejected with an explanation.

## Setting up Google sign-in

1. Google Cloud Console → create a project → *Google Auth Platform* / *OAuth consent screen*: app name "SRK Driving School", support email, authorised domain `srkdrivingschool.co.uk`, scopes `openid`, `email`, `profile`. Publish the app (these are non-sensitive scopes).
2. *Credentials → Create OAuth client ID → Web application*. Authorised redirect URI: `https://srkdrivingschool.co.uk/auth/google/callback` (must equal `APP_URL` + `/auth/google/callback`).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (as a secret), `APP_URL` and `OWNER_EMAILS` (the instructor's Google address). Until `OWNER_EMAILS` lists an address, nobody can create the workspace.
4. The instructor signs in at `/app` and completes setup. Learners sign in at `/account`; a learner whose Google email matches exactly one learner record is linked automatically. Otherwise they can send an enquiry, and the instructor links them with **Add as learner**, or sends an invitation link.

## Deploying (Cloudflare Workers + D1)

```sh
npm run build
npx wrangler d1 create lane                      # put the id into dist/server/wrangler.json
npx wrangler d1 migrations apply lane --remote --config dist/server/wrangler.json
npx wrangler secret put GOOGLE_CLIENT_SECRET --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json   # deploy to a workers.dev preview first
```

Set the non-secret variables from `.env.example` in `wrangler.json` `vars` or the dashboard. The cron trigger (every minute) processes reminders and emails. Point `srkdrivingschool.co.uk` at the Worker only after the preview has been checked. Nothing has been deployed from this repository yet.

**Email:** set `EMAIL_MODE=resend`, `RESEND_API_KEY` (secret) and `EMAIL_FROM` on a verified domain. Use `EMAIL_REDIRECT_TO` to send everything to a test inbox first.

## Backups and restore

- D1 Time Travel restores to any minute in the last 30 days: `npx wrangler d1 time-travel restore lane --timestamp <ISO time>`.
- Take a nightly export as well: `npx wrangler d1 export lane --remote --output backup-$(date +%F).sql`, stored outside Cloudflare.
- Restore an export into a fresh database with `npx wrangler d1 execute <new-db> --remote --file backup.sql`, then point the binding at it.
- Locally the database is `.data/lane.sqlite`; copy the file while the server is stopped.

## Launch blockers (not done)

- **Google credentials** are not configured; sign-in was tested only with Google's token endpoint mocked.
- **Live email** is not configured or tested; everything is preview-only.
- **Business content to confirm** in `business.config.mjs`: prices, office vs lesson hours (Maps says 09:30–19:00 / 09:00–14:00; the current site says 9am–9pm 7 days), automatic-only vs "manual or automatic", area spellings, ADI wording/number. Statistics such as "500+ learners" and pass rates from the current site were deliberately **not** copied because they could not be verified.
- **Privacy notice and terms** are drafts with `[TO CONFIRM]` items (legal entity, ICO registration, retention periods, controller/processor roles).
- **Not built yet:** subscription billing (Phase B), waiting-list automation (Phase C), data export/deletion and retention jobs, error monitoring, cookie banner (only essential cookies are used today), SMS/WhatsApp, Google/Microsoft calendar sync, photo gallery.
- Hosting decision and DNS cut-over from the existing site.
