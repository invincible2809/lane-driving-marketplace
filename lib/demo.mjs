// Demo mode (DEMO_MODE=true): one-click sign-in as sample users, sample data
// created automatically, a visible demo banner and no search-engine indexing.
// Never enable it on a site holding real learner data: anyone can sign in as
// the instructor.
import {handleInstructorApi} from '../instructor-api.mjs';
import {zonedParts, addDays} from './time.mjs';
export const demoEnabled = env => String(env.DEMO_MODE || '').toLowerCase() === 'true';
export const DEMO_USERS = {
  instructor: {id: 'demo:instructor', email: 'instructor@example.com', name: 'Shahrukh (demo instructor)', label: 'Try as the instructor', next: '/app'},
  learner: {id: 'demo:learner', email: 'amelia@example.com', name: 'Amelia (demo learner)', label: 'Try as a learner (Amelia)', next: '/account'},
  learner2: {id: 'demo:learner2', email: 'ben@example.com', name: 'Ben (demo learner)', label: 'Try as another learner (Ben)', next: '/account'}
};
// Creates the sample workspace through the real API, so all the normal rules apply.
// ids: {instructor:{id,email}, learner:{id}, learner2:{id}}
export async function seedDemo(db, env, ids = DEMO_USERS) {
  const seedEnv = {...env, TRUST_PLATFORM_IDENTITY: 'true', OWNER_EMAILS: ids.instructor.email, APP_URL: env.APP_URL || 'http://127.0.0.1:5173'};
  const call = async (id, email, path, method = 'GET', body, headers = {}) => {
    const r = await handleInstructorApi(new Request('http://demo.local/api/' + path, {method, headers: {'Content-Type': 'application/json', ...(id ? {'oai-authenticated-user-id': id, 'oai-authenticated-user-email': email} : {}), ...headers}, body: body ? JSON.stringify(body) : undefined}), db, seedEnv);
    const data = await r.json();
    if (r.status >= 400) throw Object.assign(new Error(`${path}: ${data.error}`), {status: r.status});
    return data;
  };
  const owner = (path, method, body) => call(ids.instructor.id, ids.instructor.email, path, method, body);
  const hours = [1, 2, 3, 4, 5].map(weekday => ({weekday, start_time: '09:30', end_time: '19:00'})).concat([6, 7].map(weekday => ({weekday, start_time: '09:00', end_time: '14:00'})));
  await owner('w/onboarding', 'POST', {business_name: 'SRK Driving School', contact_email: ids.instructor.email, timezone: 'Europe/London', transmission: 'automatic', lesson_minutes: 60, lesson_price_pence: 4000, buffer_minutes: 15, notice_hours: 24, horizon_days: 56, cancellation_notice_hours: 48, cancellation_policy_text: 'Please give at least 48 hours\' notice to cancel or move a lesson. Lessons cancelled with less notice may be charged in full. [DEMO TEXT — replace with your own terms]', service_area: 'Sutton Coldfield, Kingstanding, Perry Barr, Garretts Green, Lichfield, Tamworth, Aldridge', working_hours: hours});
  const today = zonedParts(Date.now(), 'Europe/London').date;
  const amelia = (await owner('w/learners', 'POST', {name: 'Amelia Demo', email: 'amelia@example.com', phone: '07000 000001', transmission: 'automatic', pickup_location: 'Demo pickup — Sutton Coldfield', availability_notes: 'Weekday evenings'})).learner;
  const ben = (await owner('w/learners', 'POST', {name: 'Ben Demo', email: 'ben@example.com', transmission: 'automatic'})).learner;
  await db.prepare('UPDATE learner_records SET user_id=? WHERE id=?').bind(ids.learner.id, amelia.id).run();
  await db.prepare('UPDATE learner_records SET user_id=? WHERE id=?').bind(ids.learner2.id, ben.id).run();
  // A lesson moved into the past so it can be completed and reported on.
  const past = (await owner('w/lessons', 'POST', {learner_id: amelia.id, date: addDays(today, 1), time: '10:00'})).lesson;
  await db.prepare('UPDATE lessons SET start_ms=start_ms-3*86400000, end_ms=end_ms-3*86400000 WHERE id=?').bind(past.id).run();
  await owner(`w/lessons/${past.id}`, 'PATCH', {action: 'complete'});
  const skills = (await owner('w/skills')).skills;
  await owner(`w/lessons/${past.id}/report`, 'PUT', {skills: [{skill_id: skills[0].id, stage: 'consistent'}, {skill_id: skills[1].id, stage: 'improving'}, {skill_id: skills[3].id, stage: 'practising'}], observations: 'Good cockpit checks and smooth moving off. Junction observation is improving.', next_goals: 'Roundabouts on the A5127.'});
  await owner(`w/lessons/${past.id}/report/publish`, 'POST', {});
  await owner(`w/learners/${amelia.id}/notes`, 'POST', {body: 'Private demo note: prefers a calm pace.'});
  await owner('w/lessons', 'POST', {learner_id: amelia.id, date: addDays(today, 3), time: '10:00'});
  await owner('w/lessons', 'POST', {learner_id: ben.id, date: addDays(today, 2), time: '12:00'});
  const visitor = (body, n) => call(null, null, 'enquiries', 'POST', {...body, contact_consent: true}, {'x-real-ip': 'demo-seed-' + n});
  await visitor({name: 'Chloe Example', phone: '07000 000003', area: 'Kingstanding', package: 'Block of 10 lessons', experience: 'Complete beginner', preferred_times: 'Saturday mornings', message: 'Demo enquiry.'}, 1);
  await visitor({name: 'Dev Example', email: 'dev.example@example.com', area: 'Lichfield', package: 'Test day package', experience: 'My test is booked', message: 'Demo enquiry — test in three weeks.'}, 2);
}
let seeded = false, seeding = null;
// Seed once, lazily, the first time a demo deployment is used.
export async function ensureDemoData(db, env) {
  if (seeded) return;
  if (!seeding) seeding = (async () => {
    if (!(await db.prepare('SELECT 1 FROM workspaces LIMIT 1').first())) {
      try { await seedDemo(db, env); } catch (e) { if (e.status !== 409) throw e; } // another instance seeded first
    }
    seeded = true;
  })().finally(() => { seeding = null; });
  return seeding;
}
const DATA_TABLES = ['rate_limits', 'oauth_states', 'messages', 'jobs', 'lesson_events', 'lesson_reports', 'slot_holds', 'lessons', 'lesson_series', 'invitations', 'learner_notes', 'enquiries', 'learner_records', 'skills', 'time_blocks', 'availability_exceptions', 'working_hours', 'audit_log', 'policy_versions', 'workspaces'];
export async function resetDemo(db, env) {
  await db.batch(DATA_TABLES.map(t => db.prepare(`DELETE FROM ${t}`)));
  seeded = false;
  await ensureDemoData(db, env);
}
export const resetDemoFlag = () => { seeded = false; };
export function demoSignInPage(next, googleReady) {
  const users = Object.entries(DEMO_USERS).map(([key, u]) => `<form method="post" action="/auth/demo"><input type="hidden" name="as" value="${key}"><button class="btn${key === 'instructor' ? '' : ' secondary'}" type="submit">${u.label}</button></form>`).join('');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Demo sign in</title><link rel="stylesheet" href="/site/app.css"><link rel="icon" href="/site/brand/srk-mark.svg" type="image/svg+xml"><link rel="icon" href="/site/brand/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/site/brand/apple-touch-icon.png"></head>
<body><main id="main" class="card demo-signin"><img class="demo-logo" src="/site/brand/srk-logo-on-dark.svg" alt="SRK Driving School" width="249" height="64"><h1>Try the demo</h1><p>This is a demonstration with sample data. Choose who to sign in as — no account needed.</p><div class="grid">${users}</div>
${googleReady ? `<p class="small muted">Or <a href="/auth/google/start?next=${encodeURIComponent(next)}">sign in with Google</a>.</p>` : ''}
<p class="small muted">Emails are not sent in the demo; the instructor can read them under Settings → Sent emails.</p><p><a href="/">Back to the website</a></p></main></body></html>`;
}
