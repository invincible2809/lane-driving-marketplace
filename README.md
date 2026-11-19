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

Requires Node.js 22.5+ (the local server uses the built-in `node:sqlite`). Run `npm install` once (libSQL client and Vercel helpers, used for hosting).

```sh
npm run seed      # demo workspace, learners, lessons, a shared report and two enquiries
npm run dev       # http://127.0.0.1:5173
```

Locally, "Sign in" opens a **development identity chooser** (instructor, two learners, platform admin) because Google credentials are not configured. The dev server strips any inbound identity headers; never expose it publicly.

Emails are in **preview mode** by default: nothing is sent; every email is visible under *Settings → Sent emails*.

## Tests

```sh
npm test          # unit + integration tests on SQLite (PostgreSQL tests skip)
TEST_DATABASE_URL=postgres://user@host/db npm run test:postgres   # same integration tests + concurrency checks on PostgreSQL
npm run check     # syntax check of entry points and browser scripts
npm run test:e2e  # Chromium journeys at 390×844; set AXE_PATH=/path/to/axe.min.js for WCAG checks
npm run build     # dist/server/index.js (Cloudflare Worker) + wrangler.json + migrations
```

## Logo

SRK's own logo as it appears on the school's car signs: two slanted stripes (light orange `#fcb074`, deep orange `#fc5c00`) with "SRK DRIVING SCHOOL" in Poppins ExtraBold. Files are in `public/site/brand/` (served at `/site/brand/...`):

| File | Use |
|---|---|
| `srk-logo-on-dark.svg` | Website and app header (black background) |
| `srk-logo-on-light.svg` | White backgrounds, letters, PDFs |
| `srk-logo-black.svg` | One colour (single-colour print) |
| `srk-logo-stacked-on-dark.svg` / `-on-light.svg` | Square spaces: social profiles, posters |
| `srk-logo-sign.svg` | The car-sign panel (black background) |
| `srk-mark.svg`, `favicon-32.png`, `favicon-48.png` | Browser tab icon (`/favicon.ico` serves the PNG) |
| `srk-app-icon.svg`, `apple-touch-icon.png`, `icon-512.png` | Phone home-screen and app icons |

Lettering is converted to outlines so the logo looks the same everywhere. Poppins is under the SIL Open Font Licence; a copy and the licence are in `scripts/brand/fonts/`. To change the logo, edit `scripts/brand/build-logo.py` and run it (`pip install fonttools brotli uharfbuzz`), then `node scripts/brand/render-icons.mjs` for the PNGs. If you have the original logo file from your sign maker, it can replace these.

## Test-day photo reel

The home page shows SRK's 25 test-day photos beside the Google reviews as a horizontal cinema film strip that moves on one photo every 2 seconds. It pauses on hover, keyboard focus, when scrolled out of view, or with its Pause button, and stays still for visitors who ask their device for reduced motion. Photos are in `public/site/passes/` and listed in `business.config.mjs` (`pass_photos`).

To change the photos, put the originals in a folder and run `python3 scripts/brand/prepare-pass-photos.py <folder>` (`pip install pillow`). It resizes them to 600 × 800 and **removes all photo metadata, including GPS location**. Update the count in `business.config.mjs` if it changes. Only use photos of learners who agreed to be shown.

## Architecture

- `lib/` — domain rules with no HTTP or database code: time zones and BST (`time.mjs`), availability and buffers (`availability.mjs`), lesson states and cancellation rules (`lessons.mjs`), progress (`progress.mjs`), durable jobs and reminders (`jobs.mjs`), email adapters (`mailer.mjs`), calendar adapter interface (`calendar.mjs`), email templates, public site renderer (`site.mjs`).
- `instructor-api.mjs` — JSON API. Every query is scoped server-side to the signed-in owner's workspace or the learner's own record.
- `auth.mjs` — Google OpenID Connect (authorisation code + PKCE, state, nonce, verified email) and server-side sessions (only a SHA-256 of the session token is stored; cookie is `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` on HTTPS).
- `app.mjs` — router shared by the Node dev server and the Worker. `worker-entry.mjs` adds the cron trigger.
- `public/site/public.css` — the public website's styles; `app.css` holds the shared tokens and the portal. Fonts in `public/site/fonts` are Archivo and Atkinson Hyperlegible (SIL Open Font License), self-hosted because the content security policy only allows same-origin sources.
- `migrations-pg/` — PostgreSQL (Neon) schema, used on Vercel. `drizzle/` — SQLite migrations, used locally (and for Turso/D1).
- `lib/pg-db.mjs`, `lib/libsql-db.mjs` — database adapters; the app's SQL runs unchanged on SQLite and PostgreSQL.

**Double-booking protection.** On PostgreSQL (Neon) each booking trigger first takes a per-instructor transaction lock, so simultaneous bookings are checked one after another. Database triggers refuse any lesson or slot hold that overlaps another active lesson, an unexpired hold, a blocked period, or the travel buffer — so two simultaneous requests cannot both succeed. Learners get a 10-minute hold while they review the details and cancellation terms; the accepted terms version is stored with the booking.

**Reminders.** 48 h and 24 h emails are durable jobs with unique keys. Rescheduling or cancelling cancels the old jobs; a stale job that still runs is discarded because the lesson revision changed. Jobs left mid-run are re-claimed after a 5-minute lease; a message already marked sent is never resent, and the provider receives a stable idempotency key.

**Time.** All instants are stored as UTC milliseconds and shown in the workspace time zone (default Europe/London). Lesson times that do not exist or occur twice at the clock changes are rejected with an explanation.

## Setting up Google sign-in

1. Google Cloud Console → create a project → *Google Auth Platform* / *OAuth consent screen*: app name "SRK Driving School", support email, authorised domain `srkdrivingschool.co.uk`, scopes `openid`, `email`, `profile`. Publish the app (these are non-sensitive scopes).
2. *Credentials → Create OAuth client ID → Web application*. Authorised redirect URI: `https://srkdrivingschool.co.uk/auth/google/callback` (must equal `APP_URL` + `/auth/google/callback`).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (as a secret), `APP_URL` and `OWNER_EMAILS` (the instructor's Google address). Until `OWNER_EMAILS` lists an address, nobody can create the workspace.
4. The instructor signs in at `/app` and completes setup. Learners sign in at `/account`; a learner whose Google email matches exactly one learner record is linked automatically. Otherwise they can send an enquiry, and the instructor links them with **Add as learner**, or sends an invitation link.

## Quick demo on Vercel (no Google, no email setup)

For showing the product, set **`DEMO_MODE=true`**. The site then:
- offers one-click "Try as the instructor / learner" sign-in (no Google account or credentials needed);
- creates sample data automatically on first visit, and the instructor dashboard has **Reset demo data**;
- shows a "Demo site" banner on every page and tells search engines not to index it, so it never competes with the real srkdrivingschool.co.uk;
- never sends email (messages are visible under Settings → Sent emails).

Steps:
1. Vercel → *Add New → Project* → import this repository (branch `claude/driving-instructor-admin-ripn2y`), Framework Preset **Other**.
2. Project → *Storage* → **Neon** (Postgres) → create a free database and connect it to the project (the site needs a hosted database because Vercel does not keep files). This adds `DATABASE_URL`; the tables are created automatically on each deploy.
3. Project → *Settings → Environment Variables* → add `DEMO_MODE` = `true`.
4. Deploy (or *Redeploy* after adding the database and variable). Open the `*.vercel.app` address.

The free Hobby plan is fine for a demo. Do not turn on demo mode for a site with real learner data: anyone can sign in as the instructor.

## Deploying on Vercel

You need: a GitHub account (this repo), a Vercel account, and a **Neon** Postgres database (added from Vercel's Storage tab). Vercel has no permanent disk, so the database must be hosted. Turso (hosted SQLite) is also supported as an alternative: set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` instead of `DATABASE_URL`.

> **Plan note:** Vercel's free Hobby plan is for non-commercial personal use. A business website such as SRK's should use the **Pro** plan. Check Vercel's current terms.

1. **Import the project.** Vercel dashboard → *Add New → Project* → import `lane-driving-marketplace`, branch `claude/driving-instructor-admin-ripn2y` (or `main` after merging). Leave *Framework Preset* as **Other**. `vercel.json` already sets the install, build and output settings.
2. **Add the database.** Project → *Storage* → **Neon** → create a database and connect it to the project (Production and Preview). This adds `DATABASE_URL` (the pooled connection). Migrations in `migrations-pg/` run automatically on every build.
3. **Set environment variables** (Project → *Settings → Environment Variables*). Use `.env.example` as the list. At minimum:
   - `APP_URL` — e.g. `https://srkdrivingschool.co.uk` (or your `*.vercel.app` address at first)
   - `OWNER_EMAILS` — Shahrukh's Google address
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (see "Setting up Google sign-in"; the redirect URI is `APP_URL/auth/google/callback`)
   - `CRON_SECRET` (any long random string — Vercel sends it with the daily cron call)
   - `JOB_SECRET` (another long random string, for the external scheduler below)
4. **Deploy**, open the site, sign in at `/app` with the owner's Google account and complete setup.
5. **Reminder timing.** Background work (reminders, emails, expired holds) runs (a) after ordinary site visits, at most once a minute, (b) from the daily Vercel cron in `vercel.json`, and (c) — recommended — from a free external scheduler such as cron-job.org: every 10 minutes send `POST https://<your domain>/api/jobs/run` with header `Authorization: Bearer <JOB_SECRET>`. On the Pro plan you can instead change the cron schedule in `vercel.json` to `*/10 * * * *`.
6. **Domain.** Project → *Settings → Domains* → add `srkdrivingschool.co.uk` and follow the DNS instructions. Do this only after checking the site on its `*.vercel.app` address. Remember to update `APP_URL` and the Google redirect URI when the domain changes. Google sign-in works only on the address registered with Google, not on preview deployment URLs.

Manual migration, if ever needed: `DATABASE_URL=postgres://... npm run migrate`.

An alternative Cloudflare Workers build is still available (`npm run build`, output in `dist/`), but Vercel is the supported path.

## Backups and restore

- Neon keeps a restore window (point-in-time restore); restore from the Neon console (*Branches → Restore*). Check your Neon plan's retention period.
- Take a regular off-site copy as well: `pg_dump "$DATABASE_URL" > backup-$(date +%F).sql`, and restore with `psql "$NEW_DATABASE_URL" -f backup.sql`.
- Locally the database is `.data/lane.sqlite`; copy the file while the server is stopped.

## Launch blockers (not done)

- **Google credentials** are not configured; sign-in was tested only with Google's token endpoint mocked.
- **Live email** is not configured or tested; everything is preview-only.
- **Business content to confirm** in `business.config.mjs`: prices, office vs lesson hours (Maps says 09:30–19:00 / 09:00–14:00; the current site says 9am–9pm 7 days), automatic-only vs "manual or automatic", area spellings, ADI wording/number. Statistics such as "500+ learners" and pass rates from the current site were deliberately **not** copied because they could not be verified.
- **Privacy notice and terms** are drafts with `[TO CONFIRM]` items (legal entity, ICO registration, retention periods, controller/processor roles).
- **Not built yet:** subscription billing (Phase B), waiting-list automation (Phase C), data export/deletion and retention jobs, error monitoring, cookie banner (only essential cookies are used today), SMS/WhatsApp, Google/Microsoft calendar sync, photo gallery.
- Vercel + Neon accounts, environment variables and DNS cut-over from the existing site (not done; nothing has been deployed).
