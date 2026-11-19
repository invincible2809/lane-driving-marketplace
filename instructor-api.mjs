// HTTP API for the instructor administration product.
// Routes: /api/session, /api/health, /api/w/* (instructor workspace),
// /api/learner/* (invited learners), /api/invitations/*, /api/platform/*, /api/jobs/*.
// Every query is scoped server-side by the signed-in identity; the client never
// chooses a workspace or role.
import {DEFAULT_TIME_ZONE, HOUR, DAY, MINUTE, isValidTimeZone, isDate, isTime, timeToMinutes, addDays, zonedParts, localToInstant, startOfLocalDay, ClockChangeError} from './lib/time.mjs';
import {evaluateSlot, generateSlots, dayWindows, windowInstants, REASON_TEXT} from './lib/availability.mjs';
import {ACTIVE, nextStatus, isLateCancellation, proRataPrice, PAYMENT_STATUSES, PAYMENT_METHODS, SERIES_MODES} from './lib/lessons.mjs';
import {DEFAULT_SKILLS, STAGES, validateReportSkills, skillSummary} from './lib/progress.mjs';
import {newId, jobsForLessonEvent, enqueueStatement, cancelObsoleteStatement, processJobs, parseOffsets} from './lib/jobs.mjs';
import {invitationEmail} from './lib/templates.mjs';
import {createMailer} from './lib/mailer.mjs';
import {siteWorkspace} from './auth.mjs';

const HOLD_MS = 10 * MINUTE;
const INVITE_MS = 7 * DAY;
const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
class HttpError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; } }
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
const TRIGGER_ERRORS = {
  lesson_conflict: 'That time overlaps another lesson or its travel buffer.',
  lesson_held: 'Someone is reviewing that time right now. Choose another time or try again in a few minutes.',
  lesson_blocked: 'That time is blocked in the calendar.',
  block_has_lesson: 'There are lessons in that period. Move or cancel them before blocking it.',
  report_published: 'This report has been shared. Withdraw it before editing.'
};
function mapDbError(e) {
  for (const [code, message] of Object.entries(TRIGGER_ERRORS)) if (String(e.message).includes(code)) return new HttpError(409, message, {code});
  if (/UNIQUE constraint failed: learner_records/.test(e.message)) return new HttpError(409, 'This account is already linked to another learner record with this instructor.');
  return null;
}
// ---------- input helpers ----------
const str = (v, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const emailOk = s => s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function int(v, min, max, label) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label} must be a whole number between ${min} and ${max}.`);
  return n;
}
const oneOf = (v, list, label) => { if (!list.includes(v)) fail(400, `Choose a valid ${label}.`); return v; };
const minutesOk = (v, label = 'Lesson length') => { const n = int(v, 30, 240, label); if (n % 15) fail(400, `${label} must be in 15-minute steps.`); return n; };
async function readBody(request) {
  const text = await request.text();
  if (text.length > 65536) fail(413, 'Request is too large.');
  if (!text) return {};
  try { const v = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; } catch { fail(400, 'Request body must be a JSON object.'); }
}
async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
async function rateLimit(db, key, limit, windowMs, now) {
  const row = await db.prepare(`INSERT INTO rate_limits (key, window_start_ms, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start_ms < ? THEN 1 ELSE count + 1 END,
    window_start_ms = CASE WHEN window_start_ms < ? THEN ? ELSE window_start_ms END RETURNING count`).bind(key, now, now - windowMs, now - windowMs, now).first();
  if (row.count > limit) fail(429, 'Too many attempts. Please wait a few minutes and try again.');
}
// ---------- shapes ----------
const workspaceOut = (w, policy) => ({
  id: w.id, business_name: w.business_name, contact_email: w.contact_email, timezone: w.timezone, transmission: w.transmission,
  lesson_minutes: w.lesson_minutes, lesson_price_pence: w.lesson_price_pence, buffer_minutes: w.buffer_minutes, notice_hours: w.notice_hours,
  horizon_days: w.horizon_days, slot_step_minutes: w.slot_step_minutes, cancellation_notice_hours: w.cancellation_notice_hours,
  auto_confirm: !!w.auto_confirm, reminder_offsets: parseOffsets(w.reminder_offsets), service_area: w.service_area,
  policy: policy ? {id: policy.id, version: policy.version, notice_hours: policy.notice_hours, text: policy.policy_text} : null
});
const lessonOut = l => ({
  id: l.id, learner_id: l.learner_id, series_id: l.series_id, start_ms: l.start_ms, end_ms: l.end_ms, minutes: Math.round((l.end_ms - l.start_ms) / MINUTE),
  status: l.status, transmission: l.transmission, pickup_location: l.pickup_location, price_pence: l.price_pence, payment_status: l.payment_status,
  payment_method: l.payment_method, paid_ms: l.paid_ms, outside_hours: !!l.outside_hours, late_cancellation: !!l.late_cancellation,
  cancel_reason: l.cancel_reason, created_role: l.created_role, revision: l.revision, policy_version_id: l.policy_version_id, learner_name: l.learner_name
});
// Learner-facing lesson: explicit allow-list of fields.
const learnerLessonOut = l => ({id: l.id, start_ms: l.start_ms, end_ms: l.end_ms, minutes: Math.round((l.end_ms - l.start_ms) / MINUTE), status: l.status, transmission: l.transmission, pickup_location: l.pickup_location, price_pence: l.price_pence, payment_status: l.payment_status, late_cancellation: !!l.late_cancellation, revision: l.revision});
const learnerOut = r => ({id: r.id, name: r.name, email: r.email, phone: r.phone, preferred_minutes: r.preferred_minutes, transmission: r.transmission, pickup_location: r.pickup_location, availability_notes: r.availability_notes, status: r.status, marketing_opt_in: !!r.marketing_opt_in, linked: !!r.user_id, created_ms: r.created_ms});
const reportOut = r => r && ({id: r.id, lesson_id: r.lesson_id, learner_id: r.learner_id, skills: JSON.parse(r.skills), observations: r.observations, next_goals: r.next_goals, status: r.status, published_ms: r.published_ms, updated_ms: r.updated_ms, lesson_start_ms: r.lesson_start_ms});

export async function instructorApi(request, db, env = {}) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  const now = env.clock ? env.clock() : Date.now();
  const uid = request.headers.get('oai-authenticated-user-id');
  const email = (request.headers.get('oai-authenticated-user-email') || '').toLowerCase();
  const user = uid ? {id: uid, email} : null;
  const platformAdmin = !!uid && ((env.ADMIN_USER_ID && uid === env.ADMIN_USER_ID) || (env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase()));
  // Hosting platforms set these headers themselves; take the first (client) address.
  const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  const requireUser = () => { if (!user) fail(401, 'Please sign in to continue.'); return user; };
  if (!['GET', 'HEAD'].includes(method)) { const o = request.headers.get('origin'); if (o && o !== url.origin) fail(403, 'Request origin is not allowed.'); }
  const audit = (ws, role, action, type, id, detail = {}) => db.prepare('INSERT INTO audit_log (id,workspace_id,actor_id,actor_role,action,subject_type,subject_id,detail,created_ms) VALUES (?,?,?,?,?,?,?,?,?)').bind(newId(), ws, uid || 'system', role, action, type, id, JSON.stringify(detail), now);
  const run = async stmts => { try { return await db.batch(stmts); } catch (e) { throw mapDbError(e) || e; } };
  // ----- workspace helpers -----
  const ownWorkspace = async () => { requireUser(); return db.prepare('SELECT * FROM workspaces WHERE owner_id=?').bind(uid).first(); };
  const requireWorkspace = async () => { const w = await ownWorkspace(); if (!w) fail(404, 'Set up your workspace first.', {code: 'no_workspace'}); return w; };
  const policyOf = w => w.policy_version_id ? db.prepare('SELECT * FROM policy_versions WHERE id=?').bind(w.policy_version_id).first() : null;
  const learnerIn = async (w, id) => { const r = await db.prepare('SELECT * FROM learner_records WHERE id=? AND workspace_id=?').bind(id, w.id).first(); if (!r) fail(404, 'Learner not found.'); return r; };
  const lessonIn = async (w, id) => { const l = await db.prepare('SELECT l.*, r.name learner_name FROM lessons l JOIN learner_records r ON r.id=l.learner_id WHERE l.id=? AND l.workspace_id=?').bind(id, w.id).first(); if (!l) fail(404, 'Lesson not found.'); return l; };
  async function scheduleData(w, fromMs, toMs, {excludeLesson = null, excludeHold = null} = {}) {
    const [hours, exceptions, blocks, lessons, holds] = await Promise.all([
      db.prepare('SELECT weekday,start_time,end_time FROM working_hours WHERE workspace_id=?').bind(w.id).all(),
      db.prepare('SELECT * FROM availability_exceptions WHERE workspace_id=? ORDER BY day,start_time').bind(w.id).all(),
      db.prepare('SELECT * FROM time_blocks WHERE workspace_id=? AND start_ms<? AND end_ms>? ORDER BY start_ms').bind(w.id, toMs, fromMs).all(),
      db.prepare(`SELECT start_ms,end_ms,id FROM lessons WHERE workspace_id=? AND status IN ('requested','confirmed') AND start_ms<? AND end_ms>? AND id<>?`).bind(w.id, toMs + 3 * HOUR, fromMs - 3 * HOUR, excludeLesson || '').all(),
      db.prepare('SELECT start_ms,end_ms,id FROM slot_holds WHERE workspace_id=? AND expires_ms>? AND start_ms<? AND end_ms>? AND id<>?').bind(w.id, now, toMs + 3 * HOUR, fromMs - 3 * HOUR, excludeHold || '').all()
    ]);
    return {tz: w.timezone, workingHours: hours.results, exceptions: exceptions.results, blocks: blocks.results, busy: [...lessons.results, ...holds.results], bufferMinutes: w.buffer_minutes};
  }
  async function evaluate(w, start, end, rules, exclude) {
    const data = await scheduleData(w, start - DAY, end + DAY, exclude);
    return evaluateSlot({...data, start_ms: start, end_ms: end, now, ...rules});
  }
  const instructorRules = {noticeHours: 0, horizonDays: 730};
  const learnerRules = w => ({noticeHours: w.notice_hours, horizonDays: w.horizon_days});
  // Lesson change pipeline: one guarded batch for the update, audit event,
  // superseded-job cancellation and new notifications.
  async function applyLessonChange(w, lesson, {set, event, action, role, detail = {}, expectedRevision}) {
    const changeId = newId();
    const cols = Object.keys(set);
    const updated = {...lesson, ...set, revision: lesson.revision + 1};
    const stmts = [
      db.prepare(`UPDATE lessons SET ${cols.map(c => c + '=?').join(',')}, revision=revision+1, change_id=?, updated_ms=? WHERE id=? AND revision=?`).bind(...cols.map(c => set[c]), changeId, now, lesson.id, expectedRevision ?? lesson.revision),
      db.prepare(`INSERT INTO lesson_events (id,lesson_id,workspace_id,actor_id,actor_role,action,from_status,to_status,detail,revision,created_ms) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM lessons WHERE id=? AND change_id=?)`)
        .bind(newId(), lesson.id, w.id, uid, role, action, lesson.status, updated.status, JSON.stringify(detail), updated.revision, now, lesson.id, changeId),
      cancelObsoleteStatement(db, lesson.id, changeId, now),
      ...jobsForLessonEvent(event, updated, w, now).map(j => enqueueStatement(db, j, {workspaceId: w.id, lessonId: lesson.id, revision: updated.revision, changeId, now}))
    ];
    await run(stmts);
    const after = await db.prepare('SELECT change_id FROM lessons WHERE id=?').bind(lesson.id).first();
    if (after.change_id !== changeId) fail(409, 'This lesson changed since you opened it. Refresh and try again.', {code: 'stale'});
    return lessonIn(w, lesson.id);
  }
  function insertLessonStatements(w, l, {event, role, detail = {}}) {
    return [
      db.prepare(`INSERT INTO lessons (id,workspace_id,learner_id,series_id,start_ms,end_ms,status,transmission,pickup_location,price_pence,policy_version_id,outside_hours,created_by,created_role,revision,change_id,created_ms,updated_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`)
        .bind(l.id, w.id, l.learner_id, l.series_id || null, l.start_ms, l.end_ms, l.status, l.transmission, l.pickup_location, l.price_pence, l.policy_version_id || null, l.outside_hours ? 1 : 0, uid, role, l.change_id, now, now),
      db.prepare('INSERT INTO lesson_events (id,lesson_id,workspace_id,actor_id,actor_role,action,from_status,to_status,detail,revision,created_ms) VALUES (?,?,?,?,?,?,?,?,?,1,?)').bind(newId(), l.id, w.id, uid, role, 'created', null, l.status, JSON.stringify(detail), now),
      ...jobsForLessonEvent(event, {...l, revision: 1}, w, now).map(j => enqueueStatement(db, j, {workspaceId: w.id, lessonId: l.id, revision: 1, now}))
    ];
  }
  const reasonsMessage = reasons => reasons.map(r => REASON_TEXT[r]).join(' ');
  function settingsInput(b, partial) {
    const out = {};
    const has = k => !partial || b[k] !== undefined;
    if (has('business_name')) { out.business_name = str(b.business_name, 80); if (out.business_name.length < 2) fail(400, 'Enter your business name.'); }
    if (has('contact_email')) { out.contact_email = str(b.contact_email, 120).toLowerCase(); if (!emailOk(out.contact_email)) fail(400, 'Enter a valid contact email.'); }
    if (has('timezone')) { out.timezone = str(b.timezone, 60) || DEFAULT_TIME_ZONE; if (!isValidTimeZone(out.timezone)) fail(400, 'Choose a valid time zone.'); }
    if (has('transmission')) out.transmission = oneOf(b.transmission, ['manual', 'automatic', 'both'], 'transmission');
    if (has('lesson_minutes')) out.lesson_minutes = minutesOk(b.lesson_minutes, 'Standard lesson length');
    if (has('lesson_price_pence')) out.lesson_price_pence = int(b.lesson_price_pence, 0, 100000, 'Lesson price (pence)');
    if (has('buffer_minutes')) out.buffer_minutes = int(b.buffer_minutes, 0, 120, 'Travel buffer');
    if (has('notice_hours')) out.notice_hours = int(b.notice_hours, 0, 336, 'Booking notice');
    if (has('horizon_days')) out.horizon_days = int(b.horizon_days, 1, 365, 'Booking horizon');
    if (has('slot_step_minutes')) out.slot_step_minutes = oneOf(Number(b.slot_step_minutes ?? 30), [15, 30, 60], 'start-time interval');
    if (has('cancellation_notice_hours')) out.cancellation_notice_hours = int(b.cancellation_notice_hours, 0, 336, 'Cancellation notice');
    if (has('auto_confirm')) out.auto_confirm = b.auto_confirm ? 1 : 0;
    if (has('reminder_offsets')) { const o = parseOffsets(Array.isArray(b.reminder_offsets) ? b.reminder_offsets.join(',') : b.reminder_offsets); out.reminder_offsets = o.join(','); }
    if (has('service_area')) out.service_area = str(b.service_area, 500);
    return out;
  }
  function hoursInput(list) {
    if (!Array.isArray(list) || list.length > 50) fail(400, 'Provide your working hours.');
    const rows = list.map(h => ({weekday: int(h.weekday, 1, 7, 'Weekday'), start_time: h.start_time, end_time: h.end_time}));
    for (const h of rows) { if (!isTime(h.start_time) || !isTime(h.end_time) || h.end_time <= h.start_time) fail(400, 'Each working period needs a start time before its end time.'); }
    for (let d = 1; d <= 7; d++) {
      const day = rows.filter(h => h.weekday === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (let i = 1; i < day.length; i++) if (day[i].start_time < day[i - 1].end_time) fail(400, 'Working periods on the same day must not overlap.');
    }
    return rows;
  }
  const policyText = (b, fallbackHours) => str(b.cancellation_policy_text, 2000) || `Please give at least ${fallbackHours} hours' notice to cancel or move a lesson. Lessons cancelled with less notice may be charged at your instructor's discretion.`;

  // ================= public / session =================
  if (path === '/api/health' && method === 'GET') {
    const row = await db.prepare('SELECT 1 ok').first();
    const pending = await db.prepare(`SELECT count(*) n, min(run_at_ms) oldest FROM jobs WHERE status='pending' AND run_at_ms<?`).bind(now - 15 * MINUTE).first();
    return json({ok: row?.ok === 1, database: 'ok', overdue_jobs: pending.n, time: new Date(now).toISOString()});
  }
  if (path === '/api/session' && method === 'GET') {
    const site = await siteWorkspace(db, env);
    const siteInfo = {business_name: site?.business_name || null, google_sign_in: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)};
    if (!user) return json({user: null, site: siteInfo});
    const w = await ownWorkspace();
    const links = (await db.prepare(`SELECT r.id learner_id, w.id workspace_id, w.business_name FROM learner_records r JOIN workspaces w ON w.id=r.workspace_id WHERE r.user_id=? AND r.status='active'`).bind(uid).all()).results;
    return json({user, site: siteInfo, can_create_workspace: !String(env.OWNER_EMAILS || '').trim() || String(env.OWNER_EMAILS).toLowerCase().split(',').map(x => x.trim()).includes(email), platform_admin: platformAdmin, workspace: w ? {id: w.id, business_name: w.business_name, timezone: w.timezone} : null, learner_links: links, email_mode: createMailer(env).name});
  }
  // ================= invitations =================
  if (path === '/api/invitations/inspect' && method === 'POST') {
    await rateLimit(db, 'inspect:' + ip, 30, 10 * MINUTE, now);
    const b = await readBody(request);
    const inv = await db.prepare(`SELECT i.*, w.business_name, r.name FROM invitations i JOIN workspaces w ON w.id=i.workspace_id JOIN learner_records r ON r.id=i.learner_id WHERE i.token_hash=?`).bind(await sha256(str(b.token, 100))).first();
    if (!inv || inv.revoked_ms) fail(404, 'This invitation link is not valid. Ask your instructor for a new one.');
    const state = inv.accepted_ms ? 'accepted' : inv.expires_ms < now ? 'expired' : 'valid';
    return json({business_name: inv.business_name, first_name: inv.name.split(' ')[0], state, expires_ms: inv.expires_ms});
  }
  if (path === '/api/invitations/accept' && method === 'POST') {
    requireUser();
    await rateLimit(db, 'accept:' + uid, 10, 10 * MINUTE, now);
    const b = await readBody(request);
    const inv = await db.prepare('SELECT i.*, w.owner_id FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE token_hash=?').bind(await sha256(str(b.token, 100))).first();
    if (!inv || inv.revoked_ms) fail(404, 'This invitation link is not valid. Ask your instructor for a new one.');
    if (inv.accepted_ms) fail(409, inv.accepted_by === uid ? 'You have already accepted this invitation.' : 'This invitation has already been used.');
    if (inv.expires_ms < now) fail(410, 'This invitation has expired. Ask your instructor for a new one.');
    if (inv.owner_id === uid) fail(409, 'You cannot accept an invitation to your own workspace.');
    const claimed = await db.prepare('UPDATE invitations SET accepted_ms=?, accepted_by=? WHERE id=? AND accepted_ms IS NULL AND revoked_ms IS NULL AND expires_ms>?').bind(now, uid, inv.id, now).run();
    if (!claimed.meta?.changes) fail(409, 'This invitation has already been used.');
    try {
      const linked = await db.prepare('UPDATE learner_records SET user_id=?, updated_ms=? WHERE id=? AND (user_id IS NULL OR user_id=?)').bind(uid, now, inv.learner_id, uid).run();
      if (!linked.meta?.changes) fail(409, 'This learner record is already linked to another account. Ask your instructor for help.');
    } catch (e) {
      await db.prepare('UPDATE invitations SET accepted_ms=NULL, accepted_by=NULL WHERE id=?').bind(inv.id).run();
      throw mapDbError(e) || e;
    }
    await audit(inv.workspace_id, 'learner', 'invitation.accepted', 'learner', inv.learner_id).run();
    return json({learner_id: inv.learner_id});
  }
  // ================= public website enquiries =================
  if (path === '/api/site' && method === 'GET') {
    const w = await siteWorkspace(db, env);
    return json({ready: !!w, business_name: w?.business_name || null});
  }
  if (path === '/api/enquiries' && method === 'POST') {
    // Plain HTML form posts (no JavaScript) are supported and answered with a redirect.
    const formPost = (request.headers.get('content-type') || '').startsWith('application/x-www-form-urlencoded');
    if (formPost) {
      try { await submitEnquiry(Object.fromEntries(new URLSearchParams(await request.text()))); return new Response(null, {status: 303, headers: {Location: '/contact?sent=1'}}); }
      catch (e) { if (!(e instanceof HttpError)) throw e; return new Response(null, {status: 303, headers: {Location: '/contact?error=' + encodeURIComponent(e.message)}}); }
    }
    return submitEnquiry(await readBody(request));
  }
  async function submitEnquiry(b) {
    if (typeof b.contact_consent === 'string') b.contact_consent = b.contact_consent === 'true';
    if (typeof b.marketing_opt_in === 'string') b.marketing_opt_in = b.marketing_opt_in === 'true';
    await rateLimit(db, 'enquiry:' + ip, 5, HOUR, now);
    // Honeypot field and a minimum fill time quietly drop most automated spam.
    if (str(b.website, 200) || (Number(b.started_ms) && now - Number(b.started_ms) < 2500)) return json({ok: true}, 201);
    const w = await siteWorkspace(db, env);
    if (!w) fail(503, 'Enquiries are not available yet. Please phone or email us instead.');
    const e = {name: str(b.name, 80), email: str(b.email, 120).toLowerCase(), phone: str(b.phone, 30), area: str(b.area, 80), package: str(b.package, 80), experience: str(b.experience, 80), preferred_times: str(b.preferred_times, 300), message: str(b.message, 2000)};
    if (e.name.length < 2) fail(400, 'Please enter your name.');
    if (!e.email && !e.phone) fail(400, 'Please give an email address or phone number so we can reply.');
    if (!emailOk(e.email)) fail(400, 'Please enter a valid email address.');
    if (e.phone && !/^[+\d][\d\s()-]{6,}$/.test(e.phone)) fail(400, 'Please enter a valid phone number.');
    if (b.contact_consent !== true) fail(400, 'Please confirm we may contact you about your enquiry.');
    const id = newId();
    const stmts = [db.prepare(`INSERT INTO enquiries (id,workspace_id,user_id,name,email,phone,area,package,experience,preferred_times,message,contact_consent,marketing_opt_in,created_ms,updated_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`)
      .bind(id, w.id, uid, e.name, e.email, e.phone, e.area, e.package, e.experience, e.preferred_times, e.message, b.marketing_opt_in ? 1 : 0, now, now)];
    if (w.contact_email) {
      const messageId = newId();
      const text = `New enquiry from the website.\n\nName: ${e.name}\nPhone: ${e.phone || '—'}\nEmail: ${e.email || '—'}\nArea: ${e.area || '—'}\nInterested in: ${e.package || '—'}\nExperience: ${e.experience || '—'}\nPreferred times: ${e.preferred_times || '—'}\n\n${e.message}\n\nOpen your enquiries: ${(env.APP_URL || url.origin).replace(/\/$/, '')}/app#/enquiries`;
      stmts.push(db.prepare('INSERT INTO messages (id,idempotency_key,workspace_id,template,recipient,subject,body,created_ms) VALUES (?,?,?,?,?,?,?,?)').bind(messageId, 'enquiry:' + id, w.id, 'enquiry_received', w.contact_email, `New enquiry: ${e.name}`, text, now));
      stmts.push(enqueueStatement(db, {kind: 'send_message', key: 'enquiry:' + id, runAt: now, payload: {message_id: messageId}}, {workspaceId: w.id, now}));
    }
    await run(stmts);
    return json({ok: true, id}, 201);
  }
  // ================= jobs =================
  if (path === '/api/jobs/run' && ['GET', 'POST'].includes(method)) {
    // POST: external scheduler with JOB_SECRET. GET: Vercel Cron, which sends CRON_SECRET.
    const auth = request.headers.get('authorization') || '';
    const secret = method === 'GET' ? env.CRON_SECRET : env.JOB_SECRET;
    if (!(secret && safeEqual(auth, 'Bearer ' + secret)) && !platformAdmin) fail(401, 'Job access requires the job secret or an administrator.');
    return json(await processJobs(db, env, {now}));
  }
  // ================= platform administrator =================
  if (path === '/api/platform/overview' && method === 'GET') {
    requireUser(); if (!platformAdmin) fail(403, 'Administrator access is required.');
    const workspaces = (await db.prepare(`SELECT w.id, w.business_name, w.created_ms,
      (SELECT count(*) FROM learner_records r WHERE r.workspace_id=w.id AND r.status='active') active_learners,
      (SELECT count(*) FROM lessons l WHERE l.workspace_id=w.id) lessons FROM workspaces w ORDER BY w.created_ms DESC LIMIT 200`).all()).results;
    const jobs = (await db.prepare('SELECT status, count(*) n FROM jobs GROUP BY status').all()).results;
    const messages = (await db.prepare('SELECT status, count(*) n FROM messages GROUP BY status').all()).results;
    const failures = (await db.prepare(`SELECT id, kind, attempts, last_error, finished_ms FROM jobs WHERE status='failed' ORDER BY finished_ms DESC LIMIT 20`).all()).results;
    return json({workspaces, jobs, messages, failures, email_mode: createMailer(env).name});
  }

  // ================= instructor workspace =================
  if (path === '/api/w/onboarding' && method === 'POST') {
    requireUser();
    await rateLimit(db, 'onboard:' + uid, 20, HOUR, now);
    if (await ownWorkspace()) fail(409, 'Your workspace is already set up. Change details in Settings.');
    // Fail closed: only the listed owner emails may create the workspace. With none configured nobody can,
    // so a stranger cannot take the slot and make siteWorkspace() ambiguous.
    const owners = String(env.OWNER_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    if (!owners.includes(email)) fail(403, 'Only the driving school owner can set up this workspace.', {code: 'not_owner'});
    const b = await readBody(request);
    const s = settingsInput({timezone: DEFAULT_TIME_ZONE, slot_step_minutes: 30, auto_confirm: false, reminder_offsets: '48,24', service_area: '', contact_email: email, ...b}, false);
    const hours = hoursInput(b.working_hours || []);
    if (!hours.length) fail(400, 'Add at least one working period.');
    const id = newId(), policyId = newId();
    await run([
      db.prepare(`INSERT INTO workspaces (id,owner_id,business_name,contact_email,timezone,transmission,lesson_minutes,lesson_price_pence,buffer_minutes,notice_hours,horizon_days,slot_step_minutes,cancellation_notice_hours,policy_version_id,auto_confirm,reminder_offsets,service_area,created_ms,updated_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, uid, s.business_name, s.contact_email, s.timezone, s.transmission, s.lesson_minutes, s.lesson_price_pence, s.buffer_minutes, s.notice_hours, s.horizon_days, s.slot_step_minutes, s.cancellation_notice_hours, policyId, s.auto_confirm, s.reminder_offsets, s.service_area, now, now),
      db.prepare('INSERT INTO policy_versions (id,workspace_id,version,notice_hours,policy_text,created_ms) VALUES (?,?,1,?,?,?)').bind(policyId, id, s.cancellation_notice_hours, policyText(b, s.cancellation_notice_hours), now),
      ...hours.map(h => db.prepare('INSERT INTO working_hours (id,workspace_id,weekday,start_time,end_time) VALUES (?,?,?,?,?)').bind(newId(), id, h.weekday, h.start_time, h.end_time)),
      ...DEFAULT_SKILLS.map(([area, name], i) => db.prepare('INSERT INTO skills (id,workspace_id,area,name,position) VALUES (?,?,?,?,?)').bind(newId(), id, area, name, i)),
      audit(id, 'instructor', 'workspace.created', 'workspace', id)
    ]);
    const w = await ownWorkspace();
    return json({workspace: workspaceOut(w, await policyOf(w))}, 201);
  }
  if (!path.startsWith('/api/w/') && !path.startsWith('/api/learner/')) return null;

  if (path.startsWith('/api/w/')) {
    const w = await requireWorkspace();
    const seg = path.slice('/api/w/'.length).split('/');
    if (path === '/api/w/settings' && method === 'GET') return json({workspace: workspaceOut(w, await policyOf(w))});
    if (path === '/api/w/settings' && method === 'PATCH') {
      const b = await readBody(request);
      const s = settingsInput(b, true);
      const stmts = [];
      const policy = await policyOf(w);
      const newText = b.cancellation_policy_text !== undefined ? policyText(b, s.cancellation_notice_hours ?? w.cancellation_notice_hours) : policy.policy_text;
      const newHours = s.cancellation_notice_hours ?? w.cancellation_notice_hours;
      if (newText !== policy.policy_text || newHours !== policy.notice_hours) {
        s.policy_version_id = newId();
        stmts.push(db.prepare('INSERT INTO policy_versions (id,workspace_id,version,notice_hours,policy_text,created_ms) VALUES (?,?,?,?,?,?)').bind(s.policy_version_id, w.id, policy.version + 1, newHours, newText, now));
      }
      const cols = Object.keys(s);
      if (cols.length) stmts.push(db.prepare(`UPDATE workspaces SET ${cols.map(c => c + '=?').join(',')}, updated_ms=? WHERE id=?`).bind(...cols.map(c => s[c]), now, w.id));
      stmts.push(audit(w.id, 'instructor', 'settings.updated', 'workspace', w.id, {fields: cols}));
      await run(stmts);
      const fresh = await ownWorkspace();
      return json({workspace: workspaceOut(fresh, await policyOf(fresh))});
    }
    if (path === '/api/w/hours' && method === 'GET') return json({hours: (await db.prepare('SELECT weekday,start_time,end_time FROM working_hours WHERE workspace_id=? ORDER BY weekday,start_time').bind(w.id).all()).results});
    if (path === '/api/w/hours' && method === 'PUT') {
      const hours = hoursInput((await readBody(request)).hours);
      await run([db.prepare('DELETE FROM working_hours WHERE workspace_id=?').bind(w.id), ...hours.map(h => db.prepare('INSERT INTO working_hours (id,workspace_id,weekday,start_time,end_time) VALUES (?,?,?,?,?)').bind(newId(), w.id, h.weekday, h.start_time, h.end_time)), audit(w.id, 'instructor', 'hours.updated', 'workspace', w.id)]);
      return json({hours});
    }
    if (path === '/api/w/exceptions' && method === 'GET') return json({exceptions: (await db.prepare('SELECT * FROM availability_exceptions WHERE workspace_id=? AND day>=? ORDER BY day,start_time').bind(w.id, zonedParts(now, w.timezone).date).all()).results});
    if (path === '/api/w/exceptions' && method === 'POST') {
      const b = await readBody(request);
      if (!isDate(b.day)) fail(400, 'Choose a valid date.');
      const kind = oneOf(b.kind, ['closed', 'hours'], 'exception type');
      if (kind === 'hours' && (!isTime(b.start_time) || !isTime(b.end_time) || b.end_time <= b.start_time)) fail(400, 'Choose a start time before the end time.');
      const id = newId();
      await run([db.prepare('INSERT INTO availability_exceptions (id,workspace_id,day,kind,start_time,end_time,note) VALUES (?,?,?,?,?,?,?)').bind(id, w.id, b.day, kind, kind === 'hours' ? b.start_time : null, kind === 'hours' ? b.end_time : null, str(b.note, 200)), audit(w.id, 'instructor', 'exception.created', 'exception', id, {day: b.day, kind})]);
      return json({id}, 201);
    }
    if (seg[0] === 'exceptions' && seg[1] && method === 'DELETE') {
      const r = await db.prepare('DELETE FROM availability_exceptions WHERE id=? AND workspace_id=?').bind(seg[1], w.id).run();
      if (!r.meta?.changes) fail(404, 'Not found.');
      await audit(w.id, 'instructor', 'exception.deleted', 'exception', seg[1]).run();
      return json({ok: true});
    }
    if (path === '/api/w/blocks' && method === 'POST') {
      const b = await readBody(request);
      let start, end;
      if (b.from_date) {
        if (!isDate(b.from_date) || !isDate(b.to_date || b.from_date) || (b.to_date || b.from_date) < b.from_date) fail(400, 'Choose a valid date range.');
        start = startOfLocalDay(b.from_date, w.timezone); end = startOfLocalDay(addDays(b.to_date || b.from_date, 1), w.timezone);
      } else {
        start = localToInstant(b.date, b.start_time, w.timezone); end = localToInstant(b.date, b.end_time, w.timezone);
        if (end <= start) fail(400, 'Choose a start time before the end time.');
      }
      const id = newId();
      await run([db.prepare('INSERT INTO time_blocks (id,workspace_id,start_ms,end_ms,kind,reason) VALUES (?,?,?,?,?,?)').bind(id, w.id, start, end, b.from_date ? 'holiday' : 'blocked', str(b.reason, 120)), audit(w.id, 'instructor', 'block.created', 'block', id)]);
      return json({id, start_ms: start, end_ms: end}, 201);
    }
    if (seg[0] === 'blocks' && seg[1] && method === 'DELETE') {
      const r = await db.prepare('DELETE FROM time_blocks WHERE id=? AND workspace_id=?').bind(seg[1], w.id).run();
      if (!r.meta?.changes) fail(404, 'Not found.');
      await audit(w.id, 'instructor', 'block.deleted', 'block', seg[1]).run();
      return json({ok: true});
    }
    if (path === '/api/w/calendar' && method === 'GET') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to') || from;
      if (!isDate(from) || !isDate(to) || to < from || Date.parse(to) - Date.parse(from) > 62 * DAY) fail(400, 'Choose a date range of up to 62 days.');
      const fromMs = startOfLocalDay(from, w.timezone), toMs = startOfLocalDay(addDays(to, 1), w.timezone);
      const data = await scheduleData(w, fromMs, toMs);
      const lessons = (await db.prepare(`SELECT l.*, r.name learner_name FROM lessons l JOIN learner_records r ON r.id=l.learner_id WHERE l.workspace_id=? AND l.start_ms<? AND l.end_ms>? ORDER BY l.start_ms`).bind(w.id, toMs, fromMs).all()).results;
      const days = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push({date: d, windows: windowInstants(d, dayWindows(d, data.workingHours, data.exceptions), w.timezone), exception: data.exceptions.find(x => x.day === d) || null});
      const holds = (await db.prepare('SELECT start_ms,end_ms,expires_ms FROM slot_holds WHERE workspace_id=? AND expires_ms>? AND start_ms<? AND end_ms>?').bind(w.id, now, toMs, fromMs).all()).results;
      return json({timezone: w.timezone, buffer_minutes: w.buffer_minutes, days, lessons: lessons.map(lessonOut), blocks: data.blocks, holds});
    }
    if (path === '/api/w/availability' && method === 'GET') {
      const date = url.searchParams.get('date');
      if (!isDate(date)) fail(400, 'Choose a valid date.');
      const minutes = minutesOk(Number(url.searchParams.get('minutes') || w.lesson_minutes));
      const data = await scheduleData(w, startOfLocalDay(addDays(date, -1), w.timezone), startOfLocalDay(addDays(date, 2), w.timezone));
      return json({slots: generateSlots({...data, fromDate: date, toDate: date, durationMinutes: minutes, stepMinutes: w.slot_step_minutes, now, ...instructorRules})});
    }
    // ----- learners -----
    if (path === '/api/w/learners' && method === 'GET') {
      const status = url.searchParams.get('status') === 'archived' ? 'archived' : 'active';
      const rows = (await db.prepare(`SELECT r.*,
        (SELECT min(start_ms) FROM lessons l WHERE l.learner_id=r.id AND l.status IN ('requested','confirmed') AND l.start_ms>?) next_lesson_ms,
        (SELECT max(start_ms) FROM lessons l WHERE l.learner_id=r.id AND l.status='completed') last_lesson_ms,
        (SELECT coalesce(sum(price_pence),0) FROM lessons l WHERE l.learner_id=r.id AND l.status='completed' AND l.payment_status='unpaid') unpaid_pence
        FROM learner_records r WHERE r.workspace_id=? AND r.status=? ORDER BY r.name COLLATE NOCASE`).bind(now, w.id, status).all()).results;
      return json({learners: rows.map(r => ({...learnerOut(r), next_lesson_ms: r.next_lesson_ms, last_lesson_ms: r.last_lesson_ms, unpaid_pence: r.unpaid_pence}))});
    }
    const learnerInput = (b, partial) => {
      const o = {};
      const has = k => !partial || b[k] !== undefined;
      if (has('name')) { o.name = str(b.name, 80); if (o.name.length < 2) fail(400, 'Enter the learner\'s name.'); }
      if (has('email')) { o.email = str(b.email, 120).toLowerCase(); if (!emailOk(o.email)) fail(400, 'Enter a valid email address.'); }
      if (has('phone')) { o.phone = str(b.phone, 30); if (o.phone && !/^[+\d][\d\s()-]{6,}$/.test(o.phone)) fail(400, 'Enter a valid phone number.'); }
      if (has('preferred_minutes')) o.preferred_minutes = b.preferred_minutes ? minutesOk(Number(b.preferred_minutes), 'Preferred lesson length') : null;
      if (has('transmission')) o.transmission = oneOf(b.transmission || 'manual', ['manual', 'automatic'], 'transmission');
      if (has('pickup_location')) o.pickup_location = str(b.pickup_location, 200);
      if (has('availability_notes')) o.availability_notes = str(b.availability_notes, 500);
      return o;
    };
    if (path === '/api/w/learners' && method === 'POST') {
      const o = learnerInput(await readBody(request), false);
      if (w.transmission !== 'both' && o.transmission !== w.transmission) fail(400, `Your workspace offers ${w.transmission} lessons only. Change this in Settings if you teach both.`);
      const id = newId();
      await run([db.prepare(`INSERT INTO learner_records (id,workspace_id,name,email,phone,preferred_minutes,transmission,pickup_location,availability_notes,created_ms,updated_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id, w.id, o.name, o.email, o.phone, o.preferred_minutes, o.transmission, o.pickup_location, o.availability_notes, now, now), audit(w.id, 'instructor', 'learner.created', 'learner', id)]);
      return json({learner: learnerOut(await learnerIn(w, id))}, 201);
    }
    if (seg[0] === 'learners' && seg[1]) {
      const r = await learnerIn(w, seg[1]);
      if (!seg[2] && method === 'GET') {
        const lessons = (await db.prepare('SELECT * FROM lessons WHERE learner_id=? AND workspace_id=? ORDER BY start_ms DESC').bind(r.id, w.id).all()).results;
        const reports = (await db.prepare('SELECT p.*, l.start_ms lesson_start_ms FROM lesson_reports p JOIN lessons l ON l.id=p.lesson_id WHERE p.learner_id=? AND p.workspace_id=? ORDER BY l.start_ms DESC').bind(r.id, w.id).all()).results.map(reportOut);
        const notes = (await db.prepare('SELECT id, body, created_ms FROM learner_notes WHERE learner_id=? AND workspace_id=? ORDER BY created_ms DESC').bind(r.id, w.id).all()).results;
        const invitations = (await db.prepare('SELECT id, expires_ms, accepted_ms, revoked_ms, created_ms FROM invitations WHERE learner_id=? ORDER BY created_ms DESC LIMIT 5').bind(r.id).all()).results;
        const skills = (await db.prepare('SELECT * FROM skills WHERE workspace_id=? AND archived=0 ORDER BY position').bind(w.id).all()).results;
        return json({learner: learnerOut(r), lessons: lessons.map(lessonOut), reports, notes, invitations, progress: skillSummary(reports.filter(x => x.status === 'published'), skills)});
      }
      if (!seg[2] && method === 'PATCH') {
        const b = await readBody(request);
        const o = learnerInput(b, true);
        if (b.status !== undefined) o.status = oneOf(b.status, ['active', 'archived'], 'status');
        if (o.transmission && w.transmission !== 'both' && o.transmission !== w.transmission) fail(400, `Your workspace offers ${w.transmission} lessons only.`);
        const cols = Object.keys(o);
        if (cols.length) await run([db.prepare(`UPDATE learner_records SET ${cols.map(c => c + '=?').join(',')}, updated_ms=? WHERE id=? AND workspace_id=?`).bind(...cols.map(c => o[c]), now, r.id, w.id), audit(w.id, 'instructor', 'learner.updated', 'learner', r.id, {fields: cols})]);
        return json({learner: learnerOut(await learnerIn(w, r.id))});
      }
      if (seg[2] === 'notes' && method === 'POST') {
        const body = str((await readBody(request)).body, 4000);
        if (!body) fail(400, 'Write a note first.');
        const id = newId();
        await db.prepare('INSERT INTO learner_notes (id,workspace_id,learner_id,body,created_by,created_ms) VALUES (?,?,?,?,?,?)').bind(id, w.id, r.id, body, uid, now).run();
        return json({id}, 201);
      }
      if (seg[2] === 'notes' && seg[3] && method === 'DELETE') {
        const d = await db.prepare('DELETE FROM learner_notes WHERE id=? AND learner_id=? AND workspace_id=?').bind(seg[3], r.id, w.id).run();
        if (!d.meta?.changes) fail(404, 'Not found.');
        return json({ok: true});
      }
      if (seg[2] === 'invitations' && method === 'POST') {
        if (r.status !== 'active') fail(409, 'Restore this learner before inviting them.');
        if (r.user_id) fail(409, 'This learner has already linked an account.');
        await rateLimit(db, 'invite:' + w.id, 50, DAY, now);
        const token = randomToken(), id = newId();
        const link = `${(env.APP_URL || url.origin).replace(/\/$/, '')}/app#/invite/${token}`;
        const stmts = [
          db.prepare('UPDATE invitations SET revoked_ms=? WHERE learner_id=? AND accepted_ms IS NULL AND revoked_ms IS NULL').bind(now, r.id),
          db.prepare('INSERT INTO invitations (id,workspace_id,learner_id,token_hash,expires_ms,created_ms) VALUES (?,?,?,?,?,?)').bind(id, w.id, r.id, await sha256(token), now + INVITE_MS, now),
          audit(w.id, 'instructor', 'invitation.created', 'learner', r.id)
        ];
        let emailed = false;
        if (r.email) {
          const m = invitationEmail(w, r, link), messageId = newId();
          stmts.push(db.prepare('INSERT INTO messages (id,idempotency_key,workspace_id,template,recipient,subject,body,created_ms) VALUES (?,?,?,?,?,?,?,?)').bind(messageId, 'invite:' + id, w.id, 'invitation', r.email, m.subject, m.text, now));
          stmts.push(enqueueStatement(db, {kind: 'send_message', key: 'invite:' + id, runAt: now, payload: {message_id: messageId}}, {workspaceId: w.id, now}));
          emailed = true;
        }
        await run(stmts);
        return json({link, expires_ms: now + INVITE_MS, emailed}, 201);
      }
    }
    // ----- lessons -----
    const lessonTimes = (b, defaultMinutes) => {
      const minutes = minutesOk(Number(b.minutes || defaultMinutes));
      const start = localToInstant(b.date, b.time, w.timezone);
      return {start, end: start + minutes * MINUTE, minutes};
    };
    if (path === '/api/w/lessons' && method === 'POST') {
      const b = await readBody(request);
      const r = await learnerIn(w, b.learner_id);
      if (r.status !== 'active') fail(409, 'Restore this learner before booking lessons.');
      const {start, end, minutes} = lessonTimes(b, r.preferred_minutes || w.lesson_minutes);
      const check = await evaluate(w, start, end, instructorRules);
      const hard = check.reasons.filter(x => x !== 'outside_hours');
      if (hard.length) fail(hard.includes('past') ? 400 : 409, reasonsMessage(hard), {reasons: hard});
      if (check.reasons.includes('outside_hours') && !b.allow_outside_hours) fail(409, 'That time is outside your working hours. Confirm to book it anyway.', {reasons: ['outside_hours'], code: 'outside_hours'});
      const status = b.status === 'requested' ? 'requested' : 'confirmed';
      const price = b.price_pence !== undefined ? int(b.price_pence, 0, 100000, 'Price (pence)') : proRataPrice(w.lesson_price_pence, w.lesson_minutes, minutes);
      const l = {id: newId(), change_id: newId(), learner_id: r.id, start_ms: start, end_ms: end, status, transmission: r.transmission, pickup_location: str(b.pickup_location, 200) || r.pickup_location, price_pence: price, policy_version_id: w.policy_version_id, outside_hours: check.reasons.includes('outside_hours')};
      const stmts = insertLessonStatements(w, l, {event: status === 'confirmed' ? 'confirmed' : 'none', role: 'instructor'});
      if (l.outside_hours) stmts.push(audit(w.id, 'instructor', 'lesson.outside_hours_override', 'lesson', l.id));
      await run(stmts);
      return json({lesson: lessonOut(await lessonIn(w, l.id))}, 201);
    }
    if (path === '/api/w/lessons/series' && method === 'POST') {
      const b = await readBody(request);
      const r = await learnerIn(w, b.learner_id);
      if (r.status !== 'active') fail(409, 'Restore this learner before booking lessons.');
      const mode = oneOf(b.mode || 'all_or_nothing', Object.keys(SERIES_MODES), 'conflict rule');
      const count = int(b.count, 2, 26, 'Number of lessons'), every = int(b.every_weeks ?? 1, 1, 4, 'Repeat interval');
      const minutes = minutesOk(Number(b.minutes || r.preferred_minutes || w.lesson_minutes));
      if (!isDate(b.date) || !isTime(b.time)) fail(400, 'Choose a valid first date and time.');
      const price = b.price_pence !== undefined ? int(b.price_pence, 0, 100000, 'Price (pence)') : proRataPrice(w.lesson_price_pence, w.lesson_minutes, minutes);
      const plan = [];
      for (let i = 0; i < count; i++) {
        const date = addDays(b.date, i * 7 * every);
        let start;
        try { start = localToInstant(date, b.time, w.timezone); } catch (e) { plan.push({date, ok: false, reasons: ['clock_change'], message: e.message}); continue; }
        const end = start + minutes * MINUTE;
        const check = await evaluate(w, start, end, instructorRules);
        const reasons = check.reasons.filter(x => x !== 'outside_hours' || !b.allow_outside_hours);
        plan.push({date, start_ms: start, end_ms: end, ok: reasons.length === 0, reasons, outside_hours: check.reasons.includes('outside_hours'), message: reasonsMessage(reasons)});
      }
      const conflicts = plan.filter(p => !p.ok);
      if (b.dry_run) return json({plan, mode, mode_text: SERIES_MODES[mode]});
      if (mode === 'all_or_nothing' && conflicts.length) fail(409, `${conflicts.length} of ${count} dates conflict, so no lessons were created.`, {plan});
      const ok = plan.filter(p => p.ok);
      if (!ok.length) fail(409, 'None of the dates are available.', {plan});
      const seriesId = newId();
      const stmts = [db.prepare('INSERT INTO lesson_series (id,workspace_id,learner_id,conflict_mode,skipped,created_ms) VALUES (?,?,?,?,?,?)').bind(seriesId, w.id, r.id, mode, JSON.stringify(conflicts.map(c => ({date: c.date, reasons: c.reasons}))), now)];
      for (const p of ok) stmts.push(...insertLessonStatements(w, {id: newId(), change_id: newId(), series_id: seriesId, learner_id: r.id, start_ms: p.start_ms, end_ms: p.end_ms, status: 'confirmed', transmission: r.transmission, pickup_location: r.pickup_location, price_pence: price, policy_version_id: w.policy_version_id, outside_hours: p.outside_hours}, {event: 'confirmed', role: 'instructor', detail: {series_id: seriesId}}));
      stmts.push(audit(w.id, 'instructor', 'series.created', 'series', seriesId, {created: ok.length, skipped: conflicts.map(c => c.date)}));
      await run(stmts);
      return json({series_id: seriesId, created: ok.length, skipped: conflicts}, 201);
    }
    if (seg[0] === 'lessons' && seg[1]) {
      const l = await lessonIn(w, seg[1]);
      if (!seg[2] && method === 'GET') {
        const [events, report, policy, learner] = await Promise.all([
          db.prepare('SELECT action, actor_role, from_status, to_status, detail, revision, created_ms FROM lesson_events WHERE lesson_id=? ORDER BY created_ms, revision').bind(l.id).all(),
          db.prepare('SELECT p.*, ? lesson_start_ms FROM lesson_reports p WHERE lesson_id=?').bind(l.start_ms, l.id).first(),
          l.policy_version_id ? db.prepare('SELECT id, version, notice_hours, policy_text FROM policy_versions WHERE id=?').bind(l.policy_version_id).first() : null,
          learnerIn(w, l.learner_id)
        ]);
        const skills = (await db.prepare('SELECT id, area, name FROM skills WHERE workspace_id=? AND archived=0 ORDER BY position').bind(w.id).all()).results;
        return json({lesson: lessonOut(l), learner: learnerOut(learner), events: events.results.map(e => ({...e, detail: JSON.parse(e.detail)})), report: reportOut(report), policy, skills, stages: STAGES});
      }
      if (!seg[2] && method === 'PATCH') {
        const b = await readBody(request);
        const expectedRevision = b.expected_revision !== undefined ? int(b.expected_revision, 1, 1e6, 'Revision') : l.revision;
        if (b.action === 'payment') {
          const ps = oneOf(b.payment_status, PAYMENT_STATUSES, 'payment status');
          const pm = ps === 'paid' ? oneOf(b.payment_method, PAYMENT_METHODS, 'payment method') : null;
          const price = b.price_pence !== undefined ? int(b.price_pence, 0, 100000, 'Price (pence)') : l.price_pence;
          await run([
            db.prepare('UPDATE lessons SET payment_status=?, payment_method=?, paid_ms=?, price_pence=?, updated_ms=? WHERE id=?').bind(ps, pm, ps === 'paid' ? now : null, price, now, l.id),
            db.prepare('INSERT INTO lesson_events (id,lesson_id,workspace_id,actor_id,actor_role,action,from_status,to_status,detail,revision,created_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(newId(), l.id, w.id, uid, 'instructor', 'payment', l.status, l.status, JSON.stringify({payment_status: ps, payment_method: pm, price_pence: price}), l.revision, now)
          ]);
          return json({lesson: lessonOut(await lessonIn(w, l.id))});
        }
        const to = nextStatus(l, b.action, 'instructor', now);
        if (b.action === 'reschedule') {
          const {start, end} = lessonTimes(b, Math.round((l.end_ms - l.start_ms) / MINUTE));
          const check = await evaluate(w, start, end, instructorRules, {excludeLesson: l.id});
          const hard = check.reasons.filter(x => x !== 'outside_hours');
          if (hard.length) fail(hard.includes('past') ? 400 : 409, reasonsMessage(hard), {reasons: hard});
          if (check.reasons.includes('outside_hours') && !b.allow_outside_hours) fail(409, 'That time is outside your working hours. Confirm to move it anyway.', {reasons: ['outside_hours'], code: 'outside_hours'});
          const updated = await applyLessonChange(w, l, {set: {start_ms: start, end_ms: end, outside_hours: check.reasons.includes('outside_hours') ? 1 : 0}, event: l.status === 'confirmed' ? 'rescheduled' : 'none', action: 'rescheduled', role: 'instructor', detail: {from: [l.start_ms, l.end_ms], to: [start, end]}, expectedRevision});
          return json({lesson: lessonOut(updated)});
        }
        const set = {status: to};
        let event = 'none';
        if (b.action === 'cancel') { set.cancel_reason = str(b.reason, 300); set.late_cancellation = 0; event = 'cancelled_by_instructor'; }
        if (b.action === 'confirm') event = 'confirmed';
        if (b.action === 'decline') { set.cancel_reason = str(b.reason, 300); event = 'declined'; }
        const updated = await applyLessonChange(w, l, {set, event, action: b.action, role: 'instructor', detail: set.cancel_reason ? {reason: set.cancel_reason} : {}, expectedRevision});
        return json({lesson: lessonOut(updated)});
      }
      if (seg[2] === 'report') {
        const existing = await db.prepare('SELECT * FROM lesson_reports WHERE lesson_id=?').bind(l.id).first();
        if (!seg[3] && method === 'PUT') {
          if (l.status !== 'completed') fail(409, 'Mark the lesson as completed before writing a report.');
          if (existing?.status === 'published') fail(409, TRIGGER_ERRORS.report_published);
          const b = await readBody(request);
          const ids = new Set((await db.prepare('SELECT id FROM skills WHERE workspace_id=?').bind(w.id).all()).results.map(s => s.id));
          const skills = JSON.stringify(validateReportSkills(b.skills, ids));
          const observations = str(b.observations, 4000), goals = str(b.next_goals, 2000);
          if (existing) await run([db.prepare('UPDATE lesson_reports SET skills=?, observations=?, next_goals=?, updated_ms=? WHERE id=?').bind(skills, observations, goals, now, existing.id)]);
          else await run([db.prepare('INSERT INTO lesson_reports (id,workspace_id,lesson_id,learner_id,skills,observations,next_goals,updated_ms) VALUES (?,?,?,?,?,?,?,?)').bind(newId(), w.id, l.id, l.learner_id, skills, observations, goals, now)]);
          return json({report: reportOut(await db.prepare('SELECT p.*, ? lesson_start_ms FROM lesson_reports p WHERE lesson_id=?').bind(l.start_ms, l.id).first())});
        }
        if ((seg[3] === 'publish' || seg[3] === 'withdraw') && method === 'POST') {
          if (!existing) fail(404, 'Write the report first.');
          const publish = seg[3] === 'publish';
          if (publish && !existing.observations && !existing.next_goals && existing.skills === '[]') fail(400, 'Add at least one skill, observation or goal before sharing.');
          await run([db.prepare('UPDATE lesson_reports SET status=?, published_ms=?, updated_ms=? WHERE id=?').bind(publish ? 'published' : 'draft', publish ? now : null, now, existing.id), audit(w.id, 'instructor', publish ? 'report.published' : 'report.withdrawn', 'report', existing.id)]);
          return json({report: reportOut(await db.prepare('SELECT p.*, ? lesson_start_ms FROM lesson_reports p WHERE lesson_id=?').bind(l.start_ms, l.id).first())});
        }
      }
    }
    // ----- enquiries -----
    if (path === '/api/w/enquiries' && method === 'GET') {
      const status = url.searchParams.get('status');
      const rows = (await db.prepare(`SELECT e.*, (e.user_id IS NOT NULL) has_account FROM enquiries e WHERE e.workspace_id=? AND (? IS NULL OR e.status=?) ORDER BY e.created_ms DESC LIMIT 200`).bind(w.id, status || null, status || null).all()).results;
      const counts = (await db.prepare('SELECT status, count(*) n FROM enquiries WHERE workspace_id=? GROUP BY status').bind(w.id).all()).results;
      return json({enquiries: rows.map(r => ({...r, has_account: !!r.has_account, user_id: undefined})), counts});
    }
    if (seg[0] === 'enquiries' && seg[1]) {
      const e = await db.prepare('SELECT * FROM enquiries WHERE id=? AND workspace_id=?').bind(seg[1], w.id).first();
      if (!e) fail(404, 'Enquiry not found.');
      if (!seg[2] && method === 'PATCH') {
        const b = await readBody(request);
        const status = b.status !== undefined ? oneOf(b.status, ['new', 'contacted', 'closed'], 'status') : e.status;
        if (e.status === 'converted' && b.status !== undefined) fail(409, 'This enquiry is already linked to a learner record.');
        await run([db.prepare('UPDATE enquiries SET status=?, instructor_note=?, updated_ms=? WHERE id=?').bind(status, b.instructor_note !== undefined ? str(b.instructor_note, 1000) : e.instructor_note, now, e.id), audit(w.id, 'instructor', 'enquiry.updated', 'enquiry', e.id, {status})]);
        return json({ok: true});
      }
      if (seg[2] === 'convert' && method === 'POST') {
        if (e.status === 'converted') fail(409, 'This enquiry is already linked to a learner record.');
        const b = await readBody(request);
        const transmission = oneOf(b.transmission || (w.transmission === 'both' ? 'manual' : w.transmission), ['manual', 'automatic'], 'transmission');
        let linkUser = null;
        if (e.user_id && !(await db.prepare('SELECT 1 FROM learner_records WHERE workspace_id=? AND user_id=?').bind(w.id, e.user_id).first()) && e.user_id !== w.owner_id) linkUser = e.user_id;
        const id = newId();
        await run([
          db.prepare(`INSERT INTO learner_records (id,workspace_id,user_id,name,email,phone,transmission,availability_notes,marketing_opt_in,created_ms,updated_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id, w.id, linkUser, e.name, e.email, e.phone, transmission, e.preferred_times, e.marketing_opt_in, now, now),
          db.prepare(`UPDATE enquiries SET status='converted', learner_id=?, updated_ms=? WHERE id=? AND status<>'converted'`).bind(id, now, e.id),
          audit(w.id, 'instructor', 'enquiry.converted', 'enquiry', e.id, {learner_id: id, linked_account: !!linkUser})
        ]);
        return json({learner: learnerOut(await learnerIn(w, id))}, 201);
      }
    }
    // ----- skills -----
    if (path === '/api/w/skills' && method === 'GET') return json({skills: (await db.prepare('SELECT id, area, name, position, archived FROM skills WHERE workspace_id=? ORDER BY position').bind(w.id).all()).results, stages: STAGES});
    if (path === '/api/w/skills' && method === 'POST') {
      const b = await readBody(request);
      const name = str(b.name, 80), area = str(b.area, 60) || 'Other';
      if (name.length < 2) fail(400, 'Enter a skill name.');
      const pos = await db.prepare('SELECT coalesce(max(position),0)+1 p FROM skills WHERE workspace_id=?').bind(w.id).first();
      const id = newId();
      await db.prepare('INSERT INTO skills (id,workspace_id,area,name,position) VALUES (?,?,?,?,?)').bind(id, w.id, area, name, pos.p).run();
      return json({id}, 201);
    }
    if (seg[0] === 'skills' && seg[1] && method === 'PATCH') {
      const b = await readBody(request);
      const s = await db.prepare('SELECT * FROM skills WHERE id=? AND workspace_id=?').bind(seg[1], w.id).first();
      if (!s) fail(404, 'Not found.');
      const name = b.name !== undefined ? str(b.name, 80) : s.name, area = b.area !== undefined ? str(b.area, 60) : s.area;
      if (name.length < 2) fail(400, 'Enter a skill name.');
      await db.prepare('UPDATE skills SET name=?, area=?, archived=? WHERE id=?').bind(name, area, b.archived !== undefined ? (b.archived ? 1 : 0) : s.archived, s.id).run();
      return json({ok: true});
    }
    // ----- dashboard & reporting -----
    if (path === '/api/w/dashboard' && method === 'GET') {
      const today = zonedParts(now, w.timezone).date;
      const dayStart = startOfLocalDay(today, w.timezone), dayEnd = startOfLocalDay(addDays(today, 1), w.timezone), weekEnd = startOfLocalDay(addDays(today, 8), w.timezone);
      const q = (sql, ...a) => db.prepare(sql).bind(...a).all().then(r => r.results);
      const base = `SELECT l.*, r.name learner_name FROM lessons l JOIN learner_records r ON r.id=l.learner_id WHERE l.workspace_id=?`;
      const [todayL, upcoming, requests, cancellations, unpaid, missing, reportsDue, drafts, published, learners] = await Promise.all([
        q(`${base} AND l.start_ms>=? AND l.start_ms<? AND l.status NOT IN ('cancelled','declined') ORDER BY l.start_ms`, w.id, dayStart, dayEnd),
        q(`${base} AND l.start_ms>=? AND l.start_ms<? AND l.status='confirmed' ORDER BY l.start_ms LIMIT 20`, w.id, dayEnd, weekEnd),
        q(`${base} AND l.status='requested' AND l.start_ms>? ORDER BY l.start_ms`, w.id, now),
        q(`${base} AND l.status='cancelled' AND l.updated_ms>? ORDER BY l.updated_ms DESC LIMIT 10`, w.id, now - 14 * DAY),
        db.prepare(`SELECT count(*) n, coalesce(sum(price_pence),0) pence FROM lessons WHERE workspace_id=? AND status='completed' AND payment_status='unpaid'`).bind(w.id).first(),
        q(`SELECT r.id, r.name, (SELECT max(start_ms) FROM lessons l WHERE l.learner_id=r.id AND l.status='completed') last_lesson_ms FROM learner_records r WHERE r.workspace_id=? AND r.status='active' AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.learner_id=r.id AND l.status IN ('requested','confirmed') AND l.start_ms>?) ORDER BY r.name COLLATE NOCASE LIMIT 20`, w.id, now),
        q(`${base} AND l.status='completed' AND l.start_ms>? AND NOT EXISTS (SELECT 1 FROM lesson_reports p WHERE p.lesson_id=l.id) ORDER BY l.start_ms DESC LIMIT 10`, w.id, now - 30 * DAY),
        q(`SELECT p.id, p.lesson_id, r.name learner_name, l.start_ms lesson_start_ms FROM lesson_reports p JOIN lessons l ON l.id=p.lesson_id JOIN learner_records r ON r.id=p.learner_id WHERE p.workspace_id=? AND p.status='draft' ORDER BY l.start_ms DESC LIMIT 10`, w.id),
        db.prepare(`SELECT count(*) n FROM lesson_reports WHERE workspace_id=? AND status='published'`).bind(w.id).first(),
        db.prepare(`SELECT count(*) n FROM learner_records WHERE workspace_id=? AND status='active'`).bind(w.id).first()
      ]);
      const enquiries = (await db.prepare(`SELECT id, name, package, created_ms FROM enquiries WHERE workspace_id=? AND status='new' ORDER BY created_ms DESC LIMIT 5`).bind(w.id).all()).results;
      const newEnquiries = await db.prepare(`SELECT count(*) n FROM enquiries WHERE workspace_id=? AND status='new'`).bind(w.id).first();
      return json({new_enquiries: {count: newEnquiries.n, latest: enquiries}, today, timezone: w.timezone, today_lessons: todayL.map(lessonOut), upcoming: upcoming.map(lessonOut), requests: requests.map(lessonOut), recent_cancellations: cancellations.map(lessonOut), unpaid, learners_without_booking: missing, reports_due: reportsDue.map(lessonOut), draft_reports: drafts, published_reports: published.n, active_learners: learners.n});
    }
    if (path === '/api/w/reports' && method === 'GET') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (!isDate(from) || !isDate(to) || to < from || Date.parse(to) - Date.parse(from) > 400 * DAY) fail(400, 'Choose a date range of up to 400 days.');
      const a = startOfLocalDay(from, w.timezone), z = startOfLocalDay(addDays(to, 1), w.timezone);
      const byStatus = (await db.prepare('SELECT status, count(*) n, coalesce(sum(price_pence),0) pence FROM lessons WHERE workspace_id=? AND start_ms>=? AND start_ms<? GROUP BY status').bind(w.id, a, z).all()).results;
      const late = await db.prepare(`SELECT count(*) n FROM lessons WHERE workspace_id=? AND start_ms>=? AND start_ms<? AND status='cancelled' AND late_cancellation=1`).bind(w.id, a, z).first();
      const recorded = await db.prepare(`SELECT coalesce(sum(price_pence),0) pence FROM lessons WHERE workspace_id=? AND start_ms>=? AND start_ms<? AND status='completed'`).bind(w.id, a, z).first();
      const received = (await db.prepare(`SELECT payment_method method, count(*) n, coalesce(sum(price_pence),0) pence FROM lessons WHERE workspace_id=? AND paid_ms>=? AND paid_ms<? AND payment_status='paid' GROUP BY payment_method`).bind(w.id, a, z).all()).results;
      const unpaid = await db.prepare(`SELECT count(*) n, coalesce(sum(price_pence),0) pence FROM lessons WHERE workspace_id=? AND start_ms>=? AND start_ms<? AND status='completed' AND payment_status='unpaid'`).bind(w.id, a, z).first();
      return json({from, to, by_status: byStatus, late_cancellations: late.n, recorded_value_pence: recorded.pence, marked_paid: received, unpaid});
    }
    if (path === '/api/w/messages' && method === 'GET') {
      const rows = (await db.prepare('SELECT id, template, recipient, subject, body, status, provider, redirected_to, attempts, last_error, created_ms, sent_ms FROM messages WHERE workspace_id=? ORDER BY created_ms DESC LIMIT 50').bind(w.id).all()).results;
      return json({messages: rows, email_mode: createMailer(env).name});
    }
    if (path === '/api/w/audit' && method === 'GET') {
      const rows = (await db.prepare('SELECT action, actor_role, subject_type, subject_id, detail, created_ms FROM audit_log WHERE workspace_id=? ORDER BY created_ms DESC LIMIT 100').bind(w.id).all()).results;
      return json({entries: rows.map(r => ({...r, detail: JSON.parse(r.detail)}))});
    }
    fail(404, 'Not found.');
  }

  // ================= learner =================
  if (path.startsWith('/api/learner/')) {
    requireUser();
    const seg = path.slice('/api/learner/'.length).split('/');
    if (path === '/api/learner/home' && method === 'GET') {
      const records = (await db.prepare(`SELECT * FROM learner_records WHERE user_id=? ORDER BY created_ms`).bind(uid).all()).results;
      const out = [];
      for (const r of records) {
        const w = await db.prepare('SELECT * FROM workspaces WHERE id=?').bind(r.workspace_id).first();
        const policy = await policyOf(w);
        const lessons = (await db.prepare('SELECT * FROM lessons WHERE learner_id=? ORDER BY start_ms DESC').bind(r.id).all()).results;
        // Only published reports, explicit columns. Private notes live in a separate table and are never queried here.
        const reports = (await db.prepare(`SELECT p.id, p.lesson_id, p.skills, p.observations, p.next_goals, p.published_ms, l.start_ms lesson_start_ms FROM lesson_reports p JOIN lessons l ON l.id=p.lesson_id WHERE p.learner_id=? AND p.status='published' ORDER BY l.start_ms DESC`).bind(r.id).all()).results.map(x => ({...x, skills: JSON.parse(x.skills)}));
        const skills = (await db.prepare('SELECT id, area, name FROM skills WHERE workspace_id=? AND archived=0 ORDER BY position').bind(w.id).all()).results;
        out.push({
          learner: learnerOut(r),
          instructor: {business_name: w.business_name, timezone: w.timezone, lesson_minutes: w.lesson_minutes, lesson_price_pence: w.lesson_price_pence, notice_hours: w.notice_hours, horizon_days: w.horizon_days, cancellation_notice_hours: w.cancellation_notice_hours, auto_confirm: !!w.auto_confirm, service_area: w.service_area, policy: {id: policy.id, version: policy.version, notice_hours: policy.notice_hours, text: policy.policy_text}},
          lessons: lessons.map(learnerLessonOut), reports, skills, progress: skillSummary(reports, skills)
        });
      }
      const enquiries = (await db.prepare(`SELECT e.id, e.status, e.package, e.created_ms, w.business_name FROM enquiries e JOIN workspaces w ON w.id=e.workspace_id WHERE e.user_id=? ORDER BY e.created_ms DESC LIMIT 10`).bind(uid).all()).results;
      return json({records: out, enquiries});
    }
    const r = await db.prepare('SELECT * FROM learner_records WHERE id=? AND user_id=?').bind(seg[0], uid).first();
    if (!r) fail(404, 'Not found.');
    const w = await db.prepare('SELECT * FROM workspaces WHERE id=?').bind(r.workspace_id).first();
    const requireActive = () => { if (r.status !== 'active') fail(403, 'Your instructor has archived your record. Contact them to book.'); };
    if (seg[1] === 'profile' && method === 'PATCH') {
      const b = await readBody(request);
      const o = {};
      if (b.phone !== undefined) { o.phone = str(b.phone, 30); if (o.phone && !/^[+\d][\d\s()-]{6,}$/.test(o.phone)) fail(400, 'Enter a valid phone number.'); }
      if (b.pickup_location !== undefined) o.pickup_location = str(b.pickup_location, 200);
      if (b.availability_notes !== undefined) o.availability_notes = str(b.availability_notes, 500);
      if (b.preferred_minutes !== undefined) o.preferred_minutes = b.preferred_minutes ? minutesOk(Number(b.preferred_minutes)) : null;
      if (b.marketing_opt_in !== undefined) o.marketing_opt_in = b.marketing_opt_in ? 1 : 0;
      const cols = Object.keys(o);
      if (cols.length) await run([db.prepare(`UPDATE learner_records SET ${cols.map(c => c + '=?').join(',')}, updated_ms=? WHERE id=?`).bind(...cols.map(c => o[c]), now, r.id), audit(w.id, 'learner', 'learner.self_updated', 'learner', r.id, {fields: cols})]);
      return json({learner: learnerOut(await db.prepare('SELECT * FROM learner_records WHERE id=?').bind(r.id).first())});
    }
    if (seg[1] === 'availability' && method === 'GET') {
      requireActive();
      const from = url.searchParams.get('from'), to = url.searchParams.get('to') || from;
      if (!isDate(from) || !isDate(to) || to < from || Date.parse(to) - Date.parse(from) > 31 * DAY) fail(400, 'Choose a date range of up to 31 days.');
      const minutes = minutesOk(Number(url.searchParams.get('minutes') || r.preferred_minutes || w.lesson_minutes));
      const data = await scheduleData(w, startOfLocalDay(addDays(from, -1), w.timezone), startOfLocalDay(addDays(to, 2), w.timezone));
      const slots = generateSlots({...data, fromDate: from, toDate: to, durationMinutes: minutes, stepMinutes: w.slot_step_minutes, now, ...learnerRules(w)});
      return json({timezone: w.timezone, minutes, price_pence: proRataPrice(w.lesson_price_pence, w.lesson_minutes, minutes), slots: slots.map(s => ({start_ms: s.start_ms, end_ms: s.end_ms}))});
    }
    if (seg[1] === 'holds' && !seg[2] && method === 'POST') {
      requireActive();
      await rateLimit(db, 'hold:' + uid, 30, 10 * MINUTE, now);
      const b = await readBody(request);
      const minutes = minutesOk(Number(b.minutes || r.preferred_minutes || w.lesson_minutes));
      const start = Number(b.start_ms);
      if (!Number.isInteger(start)) fail(400, 'Choose a time.');
      const end = start + minutes * MINUTE;
      await db.prepare('DELETE FROM slot_holds WHERE learner_id=?').bind(r.id).run();
      const check = await evaluate(w, start, end, learnerRules(w));
      if (!check.ok) fail(409, reasonsMessage(check.reasons) + ' Please choose another time.', {reasons: check.reasons});
      const id = newId();
      await run([db.prepare('INSERT INTO slot_holds (id,workspace_id,learner_id,start_ms,end_ms,expires_ms,created_ms) VALUES (?,?,?,?,?,?,?)').bind(id, w.id, r.id, start, end, now + HOLD_MS, now)]);
      const policy = await policyOf(w);
      return json({hold: {id, start_ms: start, end_ms: end, minutes, expires_ms: now + HOLD_MS}, review: {business_name: w.business_name, timezone: w.timezone, price_pence: proRataPrice(w.lesson_price_pence, w.lesson_minutes, minutes), pickup_location: r.pickup_location, transmission: r.transmission, needs_confirmation: !w.auto_confirm, policy: {id: policy.id, version: policy.version, notice_hours: policy.notice_hours, text: policy.policy_text}}}, 201);
    }
    if (seg[1] === 'holds' && seg[2] && !seg[3] && method === 'DELETE') {
      await db.prepare('DELETE FROM slot_holds WHERE id=? AND learner_id=?').bind(seg[2], r.id).run();
      return json({ok: true});
    }
    if (seg[1] === 'holds' && seg[2] && seg[3] === 'confirm' && method === 'POST') {
      requireActive();
      const b = await readBody(request);
      const hold = await db.prepare('SELECT * FROM slot_holds WHERE id=? AND learner_id=?').bind(seg[2], r.id).first();
      if (!hold || hold.expires_ms <= now) fail(410, 'Your hold on this time has expired. Please choose the time again.', {code: 'hold_expired'});
      if (b.accept_terms !== true) fail(400, 'Please confirm you have read the cancellation terms.');
      if (b.policy_version_id !== w.policy_version_id) fail(409, 'The cancellation terms have changed. Please review them again.', {code: 'policy_changed'});
      const check = await evaluate(w, hold.start_ms, hold.end_ms, {...learnerRules(w), noticeHours: Math.max(0, w.notice_hours - HOLD_MS / HOUR)}, {excludeHold: hold.id});
      if (!check.ok) fail(409, reasonsMessage(check.reasons), {reasons: check.reasons});
      const minutes = Math.round((hold.end_ms - hold.start_ms) / MINUTE);
      const status = w.auto_confirm ? 'confirmed' : 'requested';
      const pickup = b.pickup_location !== undefined ? str(b.pickup_location, 200) : r.pickup_location;
      const l = {id: newId(), change_id: newId(), learner_id: r.id, start_ms: hold.start_ms, end_ms: hold.end_ms, status, transmission: r.transmission, pickup_location: pickup, price_pence: proRataPrice(w.lesson_price_pence, w.lesson_minutes, minutes), policy_version_id: w.policy_version_id};
      // Release the hold and create the lesson atomically; the lesson trigger re-checks overlap.
      const del = db.prepare('DELETE FROM slot_holds WHERE id=? AND learner_id=?').bind(hold.id, r.id);
      await run([del, ...insertLessonStatements(w, l, {event: status === 'confirmed' ? 'confirmed' : 'requested', role: 'learner', detail: {policy_version_id: w.policy_version_id}})]);
      const lesson = await db.prepare('SELECT * FROM lessons WHERE id=?').bind(l.id).first();
      return json({lesson: learnerLessonOut(lesson)}, 201);
    }
    if (seg[1] === 'lessons' && seg[2] && method === 'PATCH') {
      const l = await db.prepare('SELECT * FROM lessons WHERE id=? AND learner_id=?').bind(seg[2], r.id).first();
      if (!l) fail(404, 'Lesson not found.');
      const b = await readBody(request);
      if (b.action !== 'cancel') fail(400, 'Learners can cancel lessons. To move a lesson, cancel and book again or contact your instructor.');
      nextStatus(l, 'cancel', 'learner', now);
      const policy = l.policy_version_id ? await db.prepare('SELECT * FROM policy_versions WHERE id=?').bind(l.policy_version_id).first() : null;
      const late = isLateCancellation(l.start_ms, now, policy?.notice_hours ?? w.cancellation_notice_hours);
      if (late && b.acknowledge_late !== true) fail(409, `This is less than ${policy?.notice_hours ?? w.cancellation_notice_hours} hours before the lesson, which is inside ${w.business_name}'s cancellation notice period. Confirm to cancel anyway.`, {code: 'late_cancellation'});
      const updated = await applyLessonChange(w, {...l, learner_name: r.name}, {set: {status: 'cancelled', late_cancellation: late ? 1 : 0, cancel_reason: str(b.reason, 300)}, event: 'cancelled_by_learner', action: 'cancel', role: 'learner', detail: {late}, expectedRevision: b.expected_revision ?? l.revision});
      return json({lesson: learnerLessonOut(updated)});
    }
    fail(404, 'Not found.');
  }
  return null;
}
export {HttpError};
export async function handleInstructorApi(request, db, env) {
  try { return await instructorApi(request, db, env); }
  catch (e) {
    const mapped = e instanceof HttpError ? e : mapDbError(e) || (e instanceof ClockChangeError || e.status ? new HttpError(e.status || 400, e.message) : null);
    if (mapped) return json({error: mapped.message, ...mapped.extra}, mapped.status);
    console.error('instructor-api error', e && e.name, e && String(e.message).slice(0, 120));
    return json({error: 'Something went wrong. Please try again.'}, 500);
  }
}
