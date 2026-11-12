// Public website, enquiries and Google sign-in (Google's token endpoint is mocked).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../app.mjs';
import {database} from '../server.mjs';
import {processJobs} from '../lib/jobs.mjs';

const ORIGIN = 'https://school.test';
const assets = async () => '<html>app</html>';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function makeEnv(extra = {}) {
  const google = {claims: {}};
  const env = {
    APP_URL: ORIGIN, GOOGLE_CLIENT_ID: 'client-123', GOOGLE_CLIENT_SECRET: 'secret', OWNER_EMAILS: 'owner@school.test', ADMIN_EMAIL: 'admin@school.test',
    OAUTH_FETCH: async (url, init) => {
      google.lastRequest = {url, body: new URLSearchParams(init.body)};
      return new Response(JSON.stringify({id_token: `x.${b64(google.claims)}.sig`}), {status: 200});
    },
    ...extra
  };
  return {env, google};
}
async function call(db, env, path, {method = 'GET', body, cookie, headers = {}, form} = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('cookie', cookie);
  let payload;
  if (form) { h.set('content-type', 'application/x-www-form-urlencoded'); payload = new URLSearchParams(form).toString(); }
  else if (body) { h.set('content-type', 'application/json'); payload = JSON.stringify(body); }
  const r = await handle(new Request(ORIGIN + path, {method, headers: h, body: payload}), db, env, assets);
  const type = r.headers.get('content-type') || '';
  return {status: r.status, headers: r.headers, data: type.includes('json') ? await r.json() : await r.text()};
}
// Full Google round trip. Returns the session cookie.
async function signIn(db, env, google, {sub, email, verified = true, next = '/account', tamperNonce = false}) {
  const start = await call(db, env, '/auth/google/start?next=' + encodeURIComponent(next));
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('redirect_uri'), ORIGIN + '/auth/google/callback');
  google.claims = {iss: 'https://accounts.google.com', aud: 'client-123', sub, email, email_verified: verified, name: 'Test Person', exp: Math.floor(Date.now() / 1000) + 600, nonce: tamperNonce ? 'wrong' : auth.searchParams.get('nonce')};
  const cb = await call(db, env, `/auth/google/callback?code=abc&state=${auth.searchParams.get('state')}`);
  return {cb, state: auth.searchParams.get('state'), cookie: (cb.headers.get('set-cookie') || '').split(';')[0]};
}
async function ownerWorkspace(db, env, google) {
  const {cookie} = await signIn(db, env, google, {sub: 'owner-sub', email: 'owner@school.test'});
  const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({weekday, start_time: '09:00', end_time: '17:00'}));
  const r = await call(db, env, '/api/w/onboarding', {method: 'POST', cookie, body: {business_name: 'SRK Driving School', contact_email: 'owner@school.test', transmission: 'automatic', lesson_minutes: 60, lesson_price_pence: 4000, buffer_minutes: 15, notice_hours: 24, horizon_days: 56, cancellation_notice_hours: 48, working_hours: hours}});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return cookie;
}

test('public website pages render server-side with business details', async () => {
  const db = database();
  try {
    const {env} = makeEnv();
    const home = await call(db, env, '/');
    assert.equal(home.status, 200);
    assert.match(home.data, /SRK Driving School/);
    assert.match(home.data, /application\/ld\+json/);
    assert.match(home.data, /07852 998967/);
    assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
    const contact = await call(db, env, '/contact?package=block10');
    assert.match(contact.data, /<form id="enquiry"/);
    assert.match(contact.data, /value="Block of 10 lessons" selected/);
    assert.equal((await call(db, env, '/nope')).status, 404);
    assert.equal((await call(db, env, '/account')).data, '<html>app</html>');
  } finally { db.close(); }
});

test('Google sign-in: state, nonce, verified email and session cookie', async () => {
  const db = database();
  try {
    const {env, google} = makeEnv();
    const ok = await signIn(db, env, google, {sub: 's1', email: 'Learner@Example.com'});
    assert.equal(ok.cb.status, 302);
    assert.equal(ok.cb.headers.get('location'), '/account');
    assert.match(ok.cb.headers.get('set-cookie'), /__Host-lane_session=.*HttpOnly.*SameSite=Lax.*Secure/);
    assert.equal(google.lastRequest.body.get('grant_type'), 'authorization_code');
    assert.ok(google.lastRequest.body.get('code_verifier').length >= 43);
    const session = await call(db, env, '/api/session', {cookie: ok.cookie});
    assert.equal(session.data.user.id, 'google:s1');
    assert.equal(session.data.user.email, 'learner@example.com');
    assert.equal(session.data.can_create_workspace, false, 'only owner emails may create the workspace');
    const replay = await call(db, env, `/auth/google/callback?code=abc&state=${ok.state}`);
    assert.equal(replay.status, 400, 'state is single use');
    assert.equal((await signIn(db, env, google, {sub: 's2', email: 'x@example.com', tamperNonce: true})).cb.status, 401);
    assert.equal((await signIn(db, env, google, {sub: 's3', email: 'y@example.com', verified: false})).cb.status, 403);
    const evil = await call(db, env, '/auth/google/start?next=//evil.example');
    const state = new URL(evil.headers.get('location')).searchParams.get('state');
    google.claims = {...google.claims, sub: 's4', email: 'z@example.com', email_verified: true, nonce: (await db.prepare('SELECT nonce FROM oauth_states').first()).nonce};
    const cb = await call(db, env, `/auth/google/callback?code=abc&state=${state}`);
    assert.equal(cb.headers.get('location'), '/account', 'open redirects are refused');
    const out = await call(db, env, '/auth/logout', {method: 'POST', cookie: ok.cookie});
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call(db, env, '/api/session', {cookie: ok.cookie})).data.user, null, 'logout ends the session');
    const {env: unconfigured} = makeEnv({GOOGLE_CLIENT_ID: ''});
    assert.equal((await call(db, unconfigured, '/auth/google/start')).status, 503);
  } finally { db.close(); }
});

test('identity headers cannot be spoofed unless the platform is trusted', async () => {
  const db = database();
  try {
    const {env, google} = makeEnv();
    await ownerWorkspace(db, env, google);
    const spoof = await call(db, env, '/api/w/settings', {headers: {'oai-authenticated-user-id': 'google:owner-sub', 'oai-authenticated-user-email': 'owner@school.test'}});
    assert.equal(spoof.status, 401);
    const other = await signIn(db, env, google, {sub: 'intruder', email: 'intruder@example.com'});
    const r = await call(db, env, '/api/w/onboarding', {method: 'POST', cookie: other.cookie, body: {}});
    assert.equal(r.status, 403, 'non-owners cannot create a workspace on a business deployment');
  } finally { db.close(); }
});

test('website enquiries reach the instructor, resist spam and convert to linked learners', async () => {
  const db = database();
  try {
    const {env, google} = makeEnv();
    const owner = await ownerWorkspace(db, env, google);
    const enquiry = {name: 'Chloe Test', phone: '07000 000003', area: 'Kingstanding', package: 'Block of 10 lessons', experience: 'Complete beginner', preferred_times: 'Saturdays', message: 'Hello', contact_consent: true};
    const ip = n => ({'x-forwarded-for': '203.0.113.' + n});
    assert.equal((await call(db, env, '/api/enquiries', {method: 'POST', body: {...enquiry, contact_consent: false}, headers: ip(1)})).status, 400);
    assert.equal((await call(db, env, '/api/enquiries', {method: 'POST', body: {...enquiry, phone: '', email: ''}, headers: ip(1)})).status, 400);
    assert.equal((await call(db, env, '/api/enquiries', {method: 'POST', body: enquiry, headers: ip(1)})).status, 201);
    assert.equal((await call(db, env, '/api/enquiries', {method: 'POST', body: {...enquiry, website: 'http://spam'}, headers: ip(2)})).status, 201);
    const form = await call(db, env, '/api/enquiries', {method: 'POST', form: {name: 'No Script', email: 'noscript@example.com', contact_consent: 'true'}, headers: {...ip(3), origin: ORIGIN}});
    assert.equal(form.status, 303);
    assert.equal(form.headers.get('location'), '/contact?sent=1');
    const formErr = await call(db, env, '/api/enquiries', {method: 'POST', form: {name: 'No Consent', email: 'n@example.com'}, headers: ip(3)});
    assert.match(formErr.headers.get('location'), /^\/contact\?error=/);
    for (let i = 0; i < 3; i++) await call(db, env, '/api/enquiries', {method: 'POST', body: enquiry, headers: ip(9)});
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await call(db, env, '/api/enquiries', {method: 'POST', body: enquiry, headers: ip(9)})).status);
    assert.ok(statuses.includes(429), 'enquiries are rate limited per address');
    const list = await call(db, env, '/api/w/enquiries', {cookie: owner});
    assert.ok(list.data.enquiries.some(e => e.name === 'Chloe Test'));
    assert.ok(!list.data.enquiries.some(e => e.website || /spam/.test(JSON.stringify(e))), 'honeypot submissions are not stored');
    const dash = await call(db, env, '/api/w/dashboard', {cookie: owner});
    assert.ok(dash.data.new_enquiries.count >= 2);
    await processJobs(db, env);
    const notice = await db.prepare(`SELECT * FROM messages WHERE template='enquiry_received' LIMIT 1`).first();
    assert.equal(notice.recipient, 'owner@school.test');
    assert.equal(notice.status, 'previewed', 'no real email is sent in preview mode');
    // A visitor signs in with Google, enquires, and is converted: their account is linked.
    const lead = await signIn(db, env, google, {sub: 'lead', email: 'lead@example.com'});
    const leadHome = await call(db, env, '/api/learner/home', {cookie: lead.cookie});
    assert.equal(leadHome.data.records.length, 0);
    await call(db, env, '/api/enquiries', {method: 'POST', cookie: lead.cookie, body: {...enquiry, name: 'Lead Person', email: 'lead@example.com'}, headers: ip(20)});
    assert.equal((await call(db, env, '/api/learner/home', {cookie: lead.cookie})).data.enquiries.length, 1);
    const leadEnquiry = (await call(db, env, '/api/w/enquiries', {cookie: owner})).data.enquiries.find(e => e.name === 'Lead Person');
    assert.equal(leadEnquiry.has_account, true);
    const converted = await call(db, env, `/api/w/enquiries/${leadEnquiry.id}/convert`, {method: 'POST', cookie: owner, body: {}});
    assert.equal(converted.status, 201);
    assert.equal(converted.data.learner.linked, true);
    assert.equal((await call(db, env, `/api/w/enquiries/${leadEnquiry.id}/convert`, {method: 'POST', cookie: owner, body: {}})).status, 409);
    assert.equal((await call(db, env, '/api/learner/home', {cookie: lead.cookie})).data.records.length, 1);
  } finally { db.close(); }
});

test('signing in with Google links an existing learner record by verified email', async () => {
  const db = database();
  try {
    const {env, google} = makeEnv();
    const owner = await ownerWorkspace(db, env, google);
    await call(db, env, '/api/w/learners', {method: 'POST', cookie: owner, body: {name: 'Existing Learner', email: 'existing@example.com', transmission: 'automatic'}});
    const s = await signIn(db, env, google, {sub: 'existing', email: 'EXISTING@example.com'});
    const home = await call(db, env, '/api/learner/home', {cookie: s.cookie});
    assert.equal(home.data.records.length, 1);
    assert.equal(home.data.records[0].learner.name, 'Existing Learner');
    const stranger = await signIn(db, env, google, {sub: 'stranger', email: 'stranger@example.com'});
    assert.equal((await call(db, env, '/api/learner/home', {cookie: stranger.cookie})).data.records.length, 0);
    const ownerLogin = await signIn(db, env, google, {sub: 'owner-sub', email: 'owner@school.test'});
    assert.equal(ownerLogin.cb.headers.get('location'), '/app', 'the owner lands in the admin');
  } finally { db.close(); }
});
