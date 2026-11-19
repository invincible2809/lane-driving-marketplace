// PostgreSQL (Neon) specific checks. Skipped unless TEST_DATABASE_URL is set.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshPgPool, usingPostgres} from './db.mjs';
import {fetchHandler, __reset} from '../api/index.mjs';
import {runMigrations} from '../scripts/migrate.mjs';
const ORIGIN = 'https://srk.example';
const opts = {skip: usingPostgres ? false : 'set TEST_DATABASE_URL to run PostgreSQL tests'};

async function setup() {
  const {pool, name} = await freshPgPool();
  __reset();
  const {resetDemoFlag} = await import('../lib/demo.mjs'); resetDemoFlag();
  const env = {__PG_POOL: pool, DATABASE_URL: 'postgres://injected', APP_URL: ORIGIN, DEMO_MODE: 'true'};
  const call = async (path, {method = 'GET', cookie, body, form, headers = {}} = {}) => {
    const h = new Headers(headers); if (cookie) h.set('cookie', cookie);
    if (form) h.set('content-type', 'application/x-www-form-urlencoded'); else if (body) h.set('content-type', 'application/json');
    const r = await fetchHandler(new Request(ORIGIN + path, {method, headers: h, body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined}), env);
    return {status: r.status, headers: r.headers, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text()};
  };
  const signIn = async who => (await call('/auth/demo', {method: 'POST', form: {as: who}})).headers.get('set-cookie').split(';')[0];
  return {pool, name, env, call, signIn};
}

test('Vercel function on PostgreSQL: demo data, sign-in, enquiries, reports, reset', opts, async () => {
  const {pool, call, signIn} = await setup();
  try {
    const home = await call('/');
    assert.equal(home.status, 200);
    assert.match(home.data, /demo-banner/);
    const inst = await signIn('instructor');
    const dash = (await call('/api/w/dashboard', {cookie: inst})).data;
    assert.equal(dash.new_enquiries.count, 2);
    assert.equal(dash.active_learners, 2);
    assert.equal(typeof dash.unpaid.pence, 'number', 'sums come back as numbers');
    assert.equal((await call('/api/enquiries', {method: 'POST', headers: {'x-real-ip': '203.0.113.9'}, body: {name: 'Neon Visitor', phone: '07000 000000', contact_consent: true}})).status, 201);
    assert.equal((await call('/api/w/enquiries', {cookie: inst})).data.enquiries[0].name, 'Neon Visitor');
    const amelia = await signIn('learner');
    const learnerHome = (await call('/api/learner/home', {cookie: amelia})).data.records[0];
    assert.equal(learnerHome.reports.length, 1);
    assert.equal(typeof learnerHome.lessons[0].start_ms, 'number');
    assert.ok(!JSON.stringify(learnerHome).includes('Private demo note'));
    const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const range = await call(`/api/w/reports?from=${day(-30)}&to=${day(30)}`, {cookie: inst});
    assert.equal(range.status, 200);
    assert.equal(range.data.recorded_value_pence, 4000);
    assert.equal((await call('/auth/demo/reset', {method: 'POST', cookie: inst})).status, 302);
    assert.equal((await call('/api/w/dashboard', {cookie: inst})).data.new_enquiries.count, 2, 'reset restores sample data');
    const cron = await call('/api/jobs/run');
    assert.equal(cron.status, 401);
  } finally { await pool.end(); }
});

test('PostgreSQL: 20 simultaneous bookings of one slot produce exactly one lesson', opts, async () => {
  const {pool, call, signIn} = await setup();
  try {
    await call('/');
    const inst = await signIn('instructor');
    const learner = (await call('/api/w/learners', {cookie: inst})).data.learners[0];
    const date = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
    const body = {learner_id: learner.id, date, time: '10:00'};
    const results = await Promise.all(Array.from({length: 20}, () => call('/api/w/lessons', {method: 'POST', cookie: inst, body})));
    assert.equal(results.filter(r => r.status === 201).length, 1, results.map(r => r.status).join(','));
    assert.ok(results.every(r => [201, 409].includes(r.status)));
    // Overlapping (not identical) times inside the travel buffer are refused too.
    const near = await Promise.all(['11:05', '11:10', '08:50'].map(t => call('/api/w/lessons', {method: 'POST', cookie: inst, body: {...body, time: t}})));
    assert.deepEqual(near.map(r => r.status), [409, 409, 409]);
    const {rows} = await pool.query(`SELECT count(*)::int n FROM lessons WHERE status IN ('requested','confirmed') AND to_timestamp(start_ms/1000)::date = $1::date`, [date]);
    assert.equal(rows[0].n, 1);
  } finally { await pool.end(); }
});

test('PostgreSQL migrations run through the deploy script and are idempotent', opts, async () => {
  const {pool, name} = await freshPgPool();
  await pool.end();
  const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + name;
  assert.deepEqual(await runMigrations({kind: 'postgres', url: url.toString()}), [], 'already applied by the test setup');
});
