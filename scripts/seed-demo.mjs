// Seeds a local demo: the SRK workspace owned by the development instructor
// identity, two learners linked to development learner identities, lessons,
// a shared progress report and two website enquiries.
// Usage: npm run seed   (writes to .data/lane.sqlite unless DATABASE_PATH is set)
import {mkdirSync} from 'node:fs';
import {database} from '../server.mjs';
import {handle} from '../app.mjs';
import {zonedParts, addDays} from '../lib/time.mjs';
mkdirSync('.data', {recursive: true});
const db = database(process.env.DATABASE_PATH || '.data/lane.sqlite');
const env = {TRUST_PLATFORM_IDENTITY: 'true', APP_URL: 'http://127.0.0.1:5173', OWNER_EMAILS: 'preview@lane.test'};
const as = (id, email) => async (path, method = 'GET', body) => {
  const r = await handle(new Request('http://127.0.0.1:5173/api/' + path, {method, headers: {'Content-Type': 'application/json', 'oai-authenticated-user-id': id, 'oai-authenticated-user-email': email}, body: body ? JSON.stringify(body) : undefined}), db, env, async () => null);
  const data = await r.json();
  if (r.status >= 400) throw new Error(`${path}: ${data.error}`);
  return data;
};
if (await db.prepare('SELECT 1 FROM workspaces').first()) { console.log('Database already has a workspace; nothing seeded.'); process.exit(0); }
const owner = as('local-preview', 'preview@lane.test');
const hours = [1, 2, 3, 4, 5].map(weekday => ({weekday, start_time: '09:30', end_time: '19:00'})).concat([6, 7].map(weekday => ({weekday, start_time: '09:00', end_time: '14:00'})));
await owner('w/onboarding', 'POST', {business_name: 'SRK Driving School', contact_email: 'preview@lane.test', timezone: 'Europe/London', transmission: 'automatic', lesson_minutes: 60, lesson_price_pence: 4000, buffer_minutes: 15, notice_hours: 24, horizon_days: 56, cancellation_notice_hours: 48, cancellation_policy_text: 'Please give at least 48 hours\' notice to cancel or move a lesson. Lessons cancelled with less notice may be charged in full. [DEMO TEXT — replace with your own terms]', service_area: 'Sutton Coldfield, Kingstanding, Perry Barr, Garretts Green, Lichfield, Tamworth, Aldridge', working_hours: hours});
const today = zonedParts(Date.now(), 'Europe/London').date;
const amelia = (await owner('w/learners', 'POST', {name: 'Amelia Demo', email: 'learner@lane.test', phone: '07000 000001', transmission: 'automatic', pickup_location: 'Demo pickup — Sutton Coldfield', availability_notes: 'Weekday evenings'})).learner;
const ben = (await owner('w/learners', 'POST', {name: 'Ben Demo', email: 'learner2@lane.test', transmission: 'automatic'})).learner;
await db.prepare('UPDATE learner_records SET user_id=? WHERE id=?').bind('dev-learner', amelia.id).run();
await db.prepare('UPDATE learner_records SET user_id=? WHERE id=?').bind('dev-learner-2', ben.id).run();
const past = (await owner('w/lessons', 'POST', {learner_id: amelia.id, date: addDays(today, 1), time: '10:00'})).lesson;
// Move the first lesson into the past so it can be completed and reported on.
await db.prepare('UPDATE lessons SET start_ms=start_ms-3*86400000, end_ms=end_ms-3*86400000 WHERE id=?').bind(past.id).run();
await owner(`w/lessons/${past.id}`, 'PATCH', {action: 'complete'});
const skills = (await owner('w/skills')).skills;
await owner(`w/lessons/${past.id}/report`, 'PUT', {skills: [{skill_id: skills[0].id, stage: 'consistent'}, {skill_id: skills[1].id, stage: 'improving'}, {skill_id: skills[3].id, stage: 'practising'}], observations: 'Good cockpit checks and smooth moving off. Junction observation is improving.', next_goals: 'Roundabouts on the A5127.'});
await owner(`w/lessons/${past.id}/report/publish`, 'POST', {});
await owner(`w/learners/${amelia.id}/notes`, 'POST', {body: 'Private demo note: prefers a calm pace.'});
await owner('w/lessons', 'POST', {learner_id: amelia.id, date: addDays(today, 3), time: '10:00'});
await owner('w/lessons', 'POST', {learner_id: ben.id, date: addDays(today, 2), time: '12:00'});
const visitor = async body => handle(new Request('http://127.0.0.1:5173/api/enquiries', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.' + Math.floor(Math.random() * 200)}, body: JSON.stringify({...body, contact_consent: true})}), db, env, async () => null);
await visitor({name: 'Chloe Example', phone: '07000 000003', area: 'Kingstanding', package: 'Block of 10 lessons', experience: 'Complete beginner', preferred_times: 'Saturday mornings', message: 'Demo enquiry.'});
await visitor({name: 'Dev Example', email: 'dev.example@lane.test', area: 'Lichfield', package: 'Test day package', experience: 'My test is booked', message: 'Demo enquiry — test in three weeks.'});
console.log('Seeded demo workspace, 2 learners, 3 lessons, 1 shared report and 2 enquiries.');
