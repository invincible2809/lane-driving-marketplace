// The Vercel function running on libSQL (the engine behind Turso), using a
// local database file: migrations, triggers, Google sign-in, enquiries, cron.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {migrate} from '../lib/libsql-db.mjs';
import {migrationFiles} from '../scripts/migrate.mjs';
import {fetchHandler, __reset} from '../api/index.mjs';

const ORIGIN = 'https://srk.example';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
test('Vercel function on libSQL: migrations, sign-in, enquiries, booking conflicts, cron', async () => {
  const client = createClient({url: 'file:' + join(mkdtempSync(join(tmpdir(), 'lane-vercel-')), 'db.sqlite')});
  assert.equal((await migrate(client, migrationFiles())).length, 4);
  assert.equal((await migrate(client, migrationFiles())).length, 0, 'migrations are idempotent');
  __reset();
  let claims = {};
  const env = {__LIBSQL_CLIENT: client, TURSO_DATABASE_URL: 'file:unused', APP_URL: ORIGIN, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's', OWNER_EMAILS: 'owner@srk.example', CRON_SECRET: 'cron-secret',
    OAUTH_FETCH: async () => new Response(JSON.stringify({id_token: `x.${b64(claims)}.y`}))};
  const call = async (path, {method = 'GET', body, cookie, headers = {}} = {}) => {
    const h = new Headers(headers); if (cookie) h.set('cookie', cookie); if (body) h.set('content-type', 'application/json');
    const r = await fetchHandler(new Request(ORIGIN + path, {method, headers: h, body: body ? JSON.stringify(body) : undefined}), env);
    return {status: r.status, headers: r.headers, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text()};
  };
  const home = await call('/');
  assert.equal(home.status, 200);
  assert.match(home.data, /SRK Driving School/);
  assert.equal((await call('/account')).status, 200, 'learner portal page is served from included files');
  // Google sign-in for the owner.
  const start = await call('/auth/google/start?next=/app');
  const auth = new URL(start.headers.get('location'));
  claims = {iss: 'https://accounts.google.com', aud: 'cid', sub: 'owner', email: 'owner@srk.example', email_verified: true, exp: Math.floor(Date.now() / 1000) + 300, nonce: auth.searchParams.get('nonce')};
  const cb = await call(`/auth/google/callback?code=c&state=${auth.searchParams.get('state')}`);
  assert.equal(cb.status, 302);
  const cookie = cb.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^__Host-lane_session=/);
  const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({weekday, start_time: '09:00', end_time: '17:00'}));
  const ws = await call('/api/w/onboarding', {method: 'POST', cookie, body: {business_name: 'SRK Driving School', transmission: 'automatic', lesson_minutes: 60, lesson_price_pence: 4000, buffer_minutes: 15, notice_hours: 24, horizon_days: 56, cancellation_notice_hours: 48, working_hours: hours}});
  assert.equal(ws.status, 201, JSON.stringify(ws.data));
  // Public enquiry appears for the instructor.
  assert.equal((await call('/api/enquiries', {method: 'POST', headers: {'x-real-ip': '198.51.100.7'}, body: {name: 'Vercel Visitor', phone: '07000 000000', contact_consent: true}})).status, 201);
  assert.equal((await call('/api/w/enquiries', {cookie})).data.enquiries[0].name, 'Vercel Visitor');
  // Database triggers enforce no double booking on libSQL too.
  const learner = (await call('/api/w/learners', {method: 'POST', cookie, body: {name: 'Test Learner', transmission: 'automatic'}})).data.learner;
  const date = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const lesson = {learner_id: learner.id, date, time: '10:00'};
  const both = await Promise.all([call('/api/w/lessons', {method: 'POST', cookie, body: lesson}), call('/api/w/lessons', {method: 'POST', cookie, body: lesson})]);
  assert.deepEqual(both.map(r => r.status).sort(), [201, 409]);
  const ws2 = (await client.execute('SELECT id FROM workspaces')).rows[0][0];
  await assert.rejects(client.execute({sql: `INSERT INTO lessons (id,workspace_id,learner_id,start_ms,end_ms,status,created_by,created_role,change_id,created_ms,updated_ms) SELECT 'raw',?,?,start_ms+600000,end_ms+600000,'confirmed','x','instructor','c',0,0 FROM lessons LIMIT 1`, args: [ws2, learner.id]}), /lesson_conflict/);
  // Vercel Cron call needs CRON_SECRET.
  assert.equal((await call('/api/jobs/run')).status, 401);
  const cron = await call('/api/jobs/run', {headers: {authorization: 'Bearer cron-secret'}});
  assert.equal(cron.status, 200);
  assert.ok('claimed' in cron.data);
  client.close();
});
