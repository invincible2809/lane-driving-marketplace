// Integration tests: permissions, concurrency, jobs, reminders and reports
// through the real HTTP handler against an in-memory SQLite database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../app.mjs';
import {database} from '../server.mjs';
import {processJobs} from '../lib/jobs.mjs';
import {zonedParts, addDays, HOUR, DAY, MINUTE} from '../lib/time.mjs';

const TZ = 'Europe/London';
const noAssets = async () => null;
function client(db, id, env = {}) {
  return async (path, method = 'GET', body) => {
    const headers = new Headers({'Content-Type': 'application/json'});
    if (id) { headers.set('oai-authenticated-user-id', id); headers.set('oai-authenticated-user-email', id + '@test.local'); }
    const r = await handle(new Request('http://localhost/api/' + path, {method, headers, body: body ? JSON.stringify(body) : undefined}), db, {APP_URL: 'http://localhost', ADMIN_EMAIL: 'admin@test.local', TRUST_PLATFORM_IDENTITY: 'true', OWNER_EMAILS: id + '@test.local', ...env}, noAssets);
    return {status: r.status, data: await r.json()};
  };
}
const allWeek = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({weekday, start_time: '08:00', end_time: '18:00'}));
const onboarding = {business_name: 'Test Driving School', contact_email: 'owner@test.local', timezone: TZ, transmission: 'manual', lesson_minutes: 60, lesson_price_pence: 4000, buffer_minutes: 30, notice_hours: 24, horizon_days: 60, cancellation_notice_hours: 48, cancellation_policy_text: 'Give 48 hours notice.', service_area: 'Test town', working_hours: allWeek};
const localDate = days => addDays(zonedParts(Date.now(), TZ).date, days);
async function setup(db) {
  const instructor = client(db, 'owner');
  assert.equal((await instructor('w/onboarding', 'POST', onboarding)).status, 201);
  const learner = (await instructor('w/learners', 'POST', {name: 'Amelia Learner', email: 'amelia@test.local', transmission: 'manual', pickup_location: '1 Private Road, AB1 2CD'})).data.learner;
  return {instructor, learner};
}
async function link(db, instructor, learnerId, userId) {
  const invite = await instructor(`w/learners/${learnerId}/invitations`, 'POST', {});
  assert.equal(invite.status, 201);
  const token = invite.data.link.split('#/invite/')[1];
  const accept = await client(db, userId)('invitations/accept', 'POST', {token});
  assert.equal(accept.status, 200, JSON.stringify(accept.data));
  return {client: client(db, userId), token};
}

test('only a listed owner email can create the workspace; none listed means nobody can', async () => {
  const db = database();
  try {
    const stranger = client(db, 'stranger', {OWNER_EMAILS: 'owner@test.local'});
    const denied = await stranger('w/onboarding', 'POST', onboarding);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, 'not_owner');
    const noneListed = client(db, 'owner', {OWNER_EMAILS: ''});
    assert.equal((await noneListed('w/onboarding', 'POST', onboarding)).status, 403);
    assert.equal((await db.prepare('SELECT count(*) n FROM workspaces').first()).n, 0);
    assert.equal((await client(db, 'owner', {OWNER_EMAILS: 'Owner@Test.local'})('w/onboarding', 'POST', onboarding)).status, 201);
  } finally { db.close(); }
});
test('onboarding validation, ownership and private workspaces', async () => {
  const db = database();
  try {
    const anon = client(db, null);
    assert.equal((await anon('w/settings')).status, 401);
    const a = client(db, 'owner');
    assert.equal((await a('w/onboarding', 'POST', {...onboarding, business_name: ''})).status, 400);
    assert.equal((await a('w/onboarding', 'POST', {...onboarding, timezone: 'Mars/Base'})).status, 400);
    assert.equal((await a('w/onboarding', 'POST', {...onboarding, working_hours: [{weekday: 1, start_time: '09:00', end_time: '12:00'}, {weekday: 1, start_time: '11:00', end_time: '13:00'}]})).status, 400);
    const created = await a('w/onboarding', 'POST', onboarding);
    assert.equal(created.status, 201);
    assert.equal(created.data.workspace.timezone, TZ);
    assert.equal(created.data.workspace.policy.version, 1);
    assert.deepEqual(created.data.workspace.reminder_offsets, [48, 24]);
    assert.equal((await a('w/onboarding', 'POST', onboarding)).status, 409);
    const learner = (await a('w/learners', 'POST', {name: 'Private Person', transmission: 'manual'})).data.learner;
    const other = client(db, 'other-instructor');
    assert.equal((await other('w/settings')).status, 404);
    assert.equal((await other('w/onboarding', 'POST', {...onboarding, business_name: 'Other School'})).status, 201);
    assert.equal((await other(`w/learners/${learner.id}`)).status, 404, 'other instructors cannot read learners');
    assert.equal((await other('w/learners')).data.learners.length, 0);
    assert.equal((await a('w/learners', 'POST', {name: 'Auto Learner', transmission: 'automatic'})).status, 400, 'manual-only workspace rejects automatic learners');
    const changed = await a('w/settings', 'PATCH', {cancellation_notice_hours: 24});
    assert.equal(changed.data.workspace.policy.version, 2, 'policy changes create a new version');
    assert.equal((await client(db, 'random')('platform/overview')).status, 403);
    const admin = await client(db, 'admin')('platform/overview');
    assert.equal(admin.status, 200);
    assert.equal(admin.data.workspaces.length, 2);
    assert.ok(!JSON.stringify(admin.data).includes('Private Person'), 'platform overview exposes no learner details');
  } finally { db.close(); }
});

test('instructor → learner journey: invite, hold, review terms, confirm, learner sees only own data', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    await instructor(`w/learners/${learner.id}/notes`, 'POST', {body: 'SECRET-PRIVATE-NOTE nervous at roundabouts'});
    const {client: amelia, token} = await link(db, instructor, learner.id, 'amelia');
    assert.equal((await client(db, 'someone-else')('invitations/accept', 'POST', {token})).status, 409, 'invitation tokens are single use');
    const date = localDate(5);
    const slots = await amelia(`learner/${learner.id}/availability?from=${date}&to=${date}&minutes=60`);
    assert.equal(slots.status, 200);
    assert.ok(slots.data.slots.length > 0);
    const start = slots.data.slots[2].start_ms;
    const held = await amelia(`learner/${learner.id}/holds`, 'POST', {start_ms: start, minutes: 60});
    assert.equal(held.status, 201);
    assert.equal(held.data.review.policy.text, 'Give 48 hours notice.');
    assert.equal(held.data.review.price_pence, 4000);
    const holdId = held.data.hold.id;
    assert.equal((await amelia(`learner/${learner.id}/holds/${holdId}/confirm`, 'POST', {policy_version_id: held.data.review.policy.id})).status, 400, 'terms must be accepted');
    assert.equal((await amelia(`learner/${learner.id}/holds/${holdId}/confirm`, 'POST', {policy_version_id: 'stale', accept_terms: true})).status, 409);
    const confirmed = await amelia(`learner/${learner.id}/holds/${holdId}/confirm`, 'POST', {policy_version_id: held.data.review.policy.id, accept_terms: true});
    assert.equal(confirmed.status, 201);
    assert.equal(confirmed.data.lesson.status, 'requested');
    const stored = await db.prepare('SELECT policy_version_id FROM lessons WHERE id=?').bind(confirmed.data.lesson.id).first();
    assert.equal(stored.policy_version_id, held.data.review.policy.id, 'accepted policy version is stored');
    const accepted = await instructor(`w/lessons/${confirmed.data.lesson.id}`, 'PATCH', {action: 'confirm'});
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.lesson.status, 'confirmed');
    const events = (await instructor(`w/lessons/${confirmed.data.lesson.id}`)).data.events.map(e => [e.action, e.actor_role]);
    assert.deepEqual(events, [['created', 'learner'], ['confirm', 'instructor']]);
    // A second learner of the same instructor cannot see or change Amelia's lesson.
    const ben = (await instructor('w/learners', 'POST', {name: 'Ben Second', email: 'ben@test.local', transmission: 'manual'})).data.learner;
    const {client: benClient} = await link(db, instructor, ben.id, 'ben');
    const benHome = await benClient('learner/home');
    assert.equal(benHome.data.records.length, 1);
    assert.equal(benHome.data.records[0].lessons.length, 0);
    assert.equal((await benClient(`learner/${learner.id}/availability?from=${date}`)).status, 404);
    assert.equal((await benClient(`learner/${ben.id}/lessons/${confirmed.data.lesson.id}`, 'PATCH', {action: 'cancel', acknowledge_late: true})).status, 404);
    assert.equal((await amelia('w/learners')).status, 404, 'learners have no instructor workspace access');
    const home = await amelia('learner/home');
    assert.equal(home.data.records[0].lessons[0].status, 'confirmed');
    assert.ok(!JSON.stringify(home.data).includes('SECRET-PRIVATE-NOTE'));
    // Emails: request, request notification to instructor, confirmation and two reminders are queued.
    const jobs = (await db.prepare(`SELECT idempotency_key, status FROM jobs ORDER BY idempotency_key`).all()).results;
    assert.ok(jobs.some(j => j.idempotency_key.endsWith(':reminder:48:learner')));
    assert.ok(jobs.some(j => j.idempotency_key.endsWith(':reminder:24:learner')));
    // The "request received" emails were superseded by the confirmation before the
    // worker ran, so only current-state messages are produced.
    const run = await processJobs(db, {}, {now: Date.now()});
    assert.ok(run.done >= 3);
    const templates = (await db.prepare('SELECT template FROM messages ORDER BY template').all()).results.map(m => m.template);
    assert.deepEqual(templates, ['invitation', 'invitation', 'lesson_confirmed']);
    const messages = (await instructor('w/messages')).data.messages;
    assert.ok(messages.every(m => m.status === 'previewed'), 'development mode never claims a real send');
    assert.ok(!JSON.stringify(messages).includes('Private Road'), 'messages omit pickup addresses');
  } finally { db.close(); }
});

test('two simultaneous requests cannot reserve the same slot', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    const {client: a} = await link(db, instructor, learner.id, 'learner-a');
    const second = (await instructor('w/learners', 'POST', {name: 'Second Learner', transmission: 'manual'})).data.learner;
    const {client: b} = await link(db, instructor, second.id, 'learner-b');
    const date = localDate(6);
    const start = (await a(`learner/${learner.id}/availability?from=${date}`)).data.slots[0].start_ms;
    const race = await Promise.all([a(`learner/${learner.id}/holds`, 'POST', {start_ms: start}), b(`learner/${second.id}/holds`, 'POST', {start_ms: start})]);
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
    // Even bypassing application checks, the database refuses overlapping lessons.
    const w = await db.prepare('SELECT id FROM workspaces').first();
    const insert = id => db.prepare(`INSERT INTO lessons (id,workspace_id,learner_id,start_ms,end_ms,status,created_by,created_role,change_id,created_ms,updated_ms) VALUES (?,?,?,?,?,'confirmed','x','instructor',?,0,0)`).bind(id, w.id, second.id, start + 3 * DAY, start + 3 * DAY + HOUR, id).run();
    await insert('raw-1');
    await assert.rejects(insert('raw-2'), /lesson_conflict/);
    // Instructor-created lessons racing for the same time.
    const t = {learner_id: learner.id, date: localDate(8), time: '10:00', minutes: 60};
    const both = await Promise.all([instructor('w/lessons', 'POST', t), instructor('w/lessons', 'POST', t)]);
    assert.deepEqual(both.map(r => r.status).sort(), [201, 409]);
  } finally { db.close(); }
});

test('travel buffers, blocks and working hours prevent invalid bookings', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    const date = localDate(10);
    assert.equal((await instructor('w/lessons', 'POST', {learner_id: learner.id, date, time: '10:00', minutes: 60})).status, 201);
    const tooClose = await instructor('w/lessons', 'POST', {learner_id: learner.id, date, time: '11:15', minutes: 60});
    assert.equal(tooClose.status, 409);
    assert.match(tooClose.data.error, /travel buffer/);
    assert.equal((await instructor('w/lessons', 'POST', {learner_id: learner.id, date, time: '11:30', minutes: 60})).status, 201);
    const outside = await instructor('w/lessons', 'POST', {learner_id: learner.id, date, time: '19:00', minutes: 60});
    assert.equal(outside.data.code, 'outside_hours');
    const override = await instructor('w/lessons', 'POST', {learner_id: learner.id, date, time: '19:00', minutes: 60, allow_outside_hours: true});
    assert.equal(override.status, 201);
    assert.equal(override.data.lesson.outside_hours, true);
    assert.equal((await instructor('w/blocks', 'POST', {from_date: date, to_date: date, reason: 'Holiday'})).status, 409, 'cannot block over lessons');
    const holiday = localDate(12);
    assert.equal((await instructor('w/blocks', 'POST', {from_date: holiday, to_date: holiday, reason: 'Holiday'})).status, 201);
    assert.equal((await instructor('w/lessons', 'POST', {learner_id: learner.id, date: holiday, time: '10:00'})).status, 409);
    assert.equal((await instructor(`w/availability?date=${holiday}`)).data.slots.length, 0);
    assert.equal((await instructor('w/lessons', 'POST', {learner_id: learner.id, date: '2027-03-28', time: '01:30'})).status, 400, 'nonexistent BST time is rejected');
    const cal = await instructor(`w/calendar?from=${date}&to=${addDays(date, 6)}`);
    assert.equal(cal.data.lessons.length, 3);
    assert.equal(cal.data.days.length, 7);
  } finally { db.close(); }
});

test('rescheduling invalidates obsolete reminders; stale edits are refused', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    const lesson = (await instructor('w/lessons', 'POST', {learner_id: learner.id, date: localDate(5), time: '10:00'})).data.lesson;
    const pending = async () => (await db.prepare(`SELECT idempotency_key k, lesson_revision r, run_at_ms FROM jobs WHERE lesson_id=? AND status='pending' AND idempotency_key LIKE '%reminder%'`).bind(lesson.id).all()).results;
    assert.equal((await pending()).length, 2);
    const oldReminder = (await pending())[0];
    const moved = await instructor(`w/lessons/${lesson.id}`, 'PATCH', {action: 'reschedule', date: localDate(7), time: '14:00', expected_revision: lesson.revision});
    assert.equal(moved.status, 200);
    assert.equal(moved.data.lesson.revision, 2);
    const after = await pending();
    assert.equal(after.length, 2);
    assert.ok(after.every(j => j.r === 2));
    const cancelled = await db.prepare(`SELECT count(*) n FROM jobs WHERE lesson_id=? AND status='cancelled' AND idempotency_key LIKE '%reminder%'`).bind(lesson.id).first();
    assert.equal(cancelled.n, 2);
    // Running jobs at the old reminder time sends nothing for the old time.
    await processJobs(db, {}, {now: oldReminder.run_at_ms + MINUTE});
    const reminders = await db.prepare(`SELECT count(*) n FROM messages WHERE template='reminder'`).first();
    assert.equal(reminders.n, 0);
    const stale = await instructor(`w/lessons/${lesson.id}`, 'PATCH', {action: 'reschedule', date: localDate(9), time: '14:00', expected_revision: 1});
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'stale');
    const c = await instructor(`w/lessons/${lesson.id}`, 'PATCH', {action: 'cancel', reason: 'Car in garage'});
    assert.equal(c.data.lesson.status, 'cancelled');
    assert.equal((await pending()).length, 0, 'cancellation removes reminders');
    assert.equal((await instructor(`w/lessons/${lesson.id}`, 'PATCH', {action: 'complete'})).status, 409);
  } finally { db.close(); }
});

test('retries and restarts never send duplicate reminders', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    const lesson = (await instructor('w/lessons', 'POST', {learner_id: learner.id, date: localDate(4), time: '09:00'})).data.lesson;
    const sends = [];
    let failNext = true;
    const env = {MAILER: {name: 'test', async send(m) { if (failNext) { failNext = false; throw Object.assign(new Error('provider timeout'), {retryable: true}); } sends.push(m.id); return {status: 'sent', provider: 'test', provider_id: 'p-' + sends.length}; }}};
    const reminderAt = lesson.start_ms - 24 * HOUR + MINUTE;
    const first = await processJobs(db, env, {now: reminderAt});
    assert.ok(first.retried >= 1);
    for (let i = 1; i <= 4; i++) await processJobs(db, env, {now: reminderAt + i * 10 * MINUTE});
    const counts = (await db.prepare(`SELECT template, count(*) n FROM messages GROUP BY template`).all()).results;
    assert.ok(counts.every(c => c.n === 1), JSON.stringify(counts));
    assert.equal(new Set(sends).size, sends.length, 'each message id sent once');
    // Simulate a crash: a job left "running" with an expired lease is reclaimed, but its message is not resent.
    const job = await db.prepare(`SELECT id FROM jobs WHERE idempotency_key LIKE '%reminder:24%'`).first();
    await db.prepare(`UPDATE jobs SET status='running', lease_until_ms=? WHERE id=?`).bind(reminderAt, job.id).run();
    const before = sends.length;
    const recovered = await processJobs(db, env, {now: reminderAt + HOUR});
    assert.ok(recovered.claimed >= 1);
    assert.equal(sends.length, before);
    // Enqueuing the same lesson event twice creates one job.
    const n = await db.prepare(`SELECT count(*) n FROM jobs WHERE lesson_id=?`).bind(lesson.id).first();
    await db.prepare(`INSERT OR IGNORE INTO jobs (id,kind,idempotency_key,run_at_ms,created_ms) SELECT 'dup','email',idempotency_key,0,0 FROM jobs WHERE id=?`).bind(job.id).run();
    assert.equal((await db.prepare(`SELECT count(*) n FROM jobs WHERE lesson_id=?`).bind(lesson.id).first()).n, n.n);
  } finally { db.close(); }
});

test('private notes never appear in learner reports; drafts stay private until published', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    const {client: amelia} = await link(db, instructor, learner.id, 'amelia');
    const lesson = (await instructor('w/lessons', 'POST', {learner_id: learner.id, date: localDate(2), time: '10:00'})).data.lesson;
    assert.equal((await instructor(`w/lessons/${lesson.id}/report`, 'PUT', {observations: 'x'})).status, 409, 'report needs a completed lesson');
    await db.prepare('UPDATE lessons SET start_ms=start_ms-? , end_ms=end_ms-? WHERE id=?').bind(5 * DAY, 5 * DAY, lesson.id).run();
    assert.equal((await instructor(`w/lessons/${lesson.id}`, 'PATCH', {action: 'complete'})).status, 200);
    await instructor(`w/learners/${learner.id}/notes`, 'POST', {body: 'PRIVATE-ONLY anxious about tests'});
    const skills = (await instructor('w/skills')).data.skills;
    const draft = await instructor(`w/lessons/${lesson.id}/report`, 'PUT', {skills: [{skill_id: skills[3].id, stage: 'practising'}], observations: 'Good mirror checks at junctions.', next_goals: 'Roundabouts next time.'});
    assert.equal(draft.data.report.status, 'draft');
    assert.equal((await amelia('learner/home')).data.records[0].reports.length, 0, 'drafts are hidden');
    assert.equal((await instructor(`w/lessons/${lesson.id}/report/publish`, 'POST')).status, 200);
    assert.equal((await instructor(`w/lessons/${lesson.id}/report`, 'PUT', {observations: 'edit'})).status, 409, 'published reports are not edited in place');
    const home = (await amelia('learner/home')).data.records[0];
    assert.equal(home.reports.length, 1);
    assert.equal(home.reports[0].observations, 'Good mirror checks at junctions.');
    assert.equal(home.progress.find(p => p.skill_id === skills[3].id).stage, 'practising');
    const text = JSON.stringify(home);
    assert.ok(!text.includes('PRIVATE-ONLY'));
    assert.ok(!('notes' in home));
    // Payment records are separate from subscriptions and recorded manually.
    const paid = await instructor(`w/lessons/${lesson.id}`, 'PATCH', {action: 'payment', payment_status: 'paid', payment_method: 'bank_transfer'});
    assert.equal(paid.data.lesson.payment_status, 'paid');
    const report = await instructor(`w/reports?from=${localDate(-10)}&to=${localDate(10)}`);
    assert.equal(report.data.recorded_value_pence, 4000);
    assert.equal(report.data.marked_paid[0].method, 'bank_transfer');
  } finally { db.close(); }
});

test('learner cancellation inside the notice period requires acknowledgement and is recorded', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    const {client: amelia} = await link(db, instructor, learner.id, 'amelia');
    const soon = (await instructor('w/lessons', 'POST', {learner_id: learner.id, date: localDate(1), time: '12:00'})).data.lesson;
    const first = await amelia(`learner/${learner.id}/lessons/${soon.id}`, 'PATCH', {action: 'cancel'});
    assert.equal(first.status, 409);
    assert.equal(first.data.code, 'late_cancellation');
    const done = await amelia(`learner/${learner.id}/lessons/${soon.id}`, 'PATCH', {action: 'cancel', acknowledge_late: true});
    assert.equal(done.status, 200);
    assert.equal(done.data.lesson.late_cancellation, true);
    assert.equal((await amelia(`learner/${learner.id}/lessons/${soon.id}`, 'PATCH', {action: 'reschedule'})).status, 400);
    const dash = await instructor('w/dashboard');
    assert.equal(dash.data.recent_cancellations.length, 1);
    assert.equal(dash.data.learners_without_booking.length, 1);
  } finally { db.close(); }
});

test('recurring series: conflicts block the whole series or are skipped and listed', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    const first = localDate(14);
    await instructor('w/lessons', 'POST', {learner_id: learner.id, date: addDays(first, 14), time: '10:00'});
    const preview = await instructor('w/lessons/series', 'POST', {learner_id: learner.id, date: first, time: '10:00', count: 4, dry_run: true});
    assert.deepEqual(preview.data.plan.map(p => p.ok), [true, true, false, true]);
    const blocked = await instructor('w/lessons/series', 'POST', {learner_id: learner.id, date: first, time: '10:00', count: 4, mode: 'all_or_nothing'});
    assert.equal(blocked.status, 409);
    assert.equal((await db.prepare('SELECT count(*) n FROM lessons').first()).n, 1);
    const skipped = await instructor('w/lessons/series', 'POST', {learner_id: learner.id, date: first, time: '10:00', count: 4, mode: 'skip_conflicts'});
    assert.equal(skipped.status, 201);
    assert.equal(skipped.data.created, 3);
    assert.equal(skipped.data.skipped[0].date, addDays(first, 14));
  } finally { db.close(); }
});

test('invitations expire and marketplace routes are disabled by default', async () => {
  const db = database();
  try {
    const {instructor, learner} = await setup(db);
    const invite = await instructor(`w/learners/${learner.id}/invitations`, 'POST', {});
    const token = invite.data.link.split('#/invite/')[1];
    await db.prepare('UPDATE invitations SET expires_ms=?').bind(Date.now() - 1).run();
    assert.equal((await client(db, 'late')('invitations/accept', 'POST', {token})).status, 410);
    assert.equal((await client(db, null)('invitations/inspect', 'POST', {token: 'nope'})).status, 404);
    assert.equal((await client(db, 'x')('instructors?postcode=B1%201AA')).status, 404);
    assert.equal((await client(db, null)('health')).data.ok, true);
  } finally { db.close(); }
});
