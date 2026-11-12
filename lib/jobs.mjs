// Durable job queue stored in the database. Jobs survive restarts: a job that was
// claimed but never finished is re-claimed once its lease expires. Every job has a
// unique idempotency key, and every outgoing message has a unique key, so retries
// and repeated runs cannot send the same message twice.
import {HOUR, MINUTE} from './time.mjs';
import {createMailer} from './mailer.mjs';
import {TEMPLATES} from './templates.mjs';
export const newId = () => crypto.randomUUID();
const LEASE_MS = 5 * MINUTE;
export function parseOffsets(text) {
  return [...new Set(String(text || '').split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 1 && n <= 168))].sort((a, b) => b - a);
}
// Reminder run times for a confirmed lesson. Offsets already in the past are
// skipped (e.g. a lesson booked 30 hours ahead gets only the 24-hour reminder).
export function reminderSchedule(lesson, offsetsText, now) {
  if (lesson.status !== 'confirmed') return [];
  return parseOffsets(offsetsText).map(h => ({hours: h, runAt: lesson.start_ms - h * HOUR})).filter(r => r.runAt > now);
}
// Jobs to create for a lesson event. Returned as plain descriptions; the caller
// inserts them in the same database batch as the lesson change.
export function jobsForLessonEvent(event, lesson, workspace, now) {
  const email = (template, to, runAt = now, extra = {}) => ({kind: 'email', key: `email:${lesson.id}:${lesson.revision}:${template}${extra.hours ? ':' + extra.hours : ''}:${to}`, runAt, payload: {template, to, ...extra}});
  const reminders = () => reminderSchedule(lesson, workspace.reminder_offsets, now).map(r => email('reminder', 'learner', r.runAt, {hours: r.hours}));
  switch (event) {
    case 'confirmed': return [email('lesson_confirmed', 'learner'), ...reminders()];
    case 'requested': return [email('lesson_requested', 'learner'), email('request_received', 'instructor')];
    case 'rescheduled': return [email('lesson_rescheduled', 'learner'), ...reminders()];
    case 'cancelled_by_instructor': return [email('lesson_cancelled', 'learner')];
    case 'cancelled_by_learner': return [email('learner_cancelled', 'instructor')];
    case 'declined': return [email('lesson_declined', 'learner')];
    default: return [];
  }
}
// INSERT for a job, optionally guarded so it only lands if the lesson change with
// `changeId` actually committed (protects against stale concurrent edits).
export function enqueueStatement(db, job, {workspaceId = null, lessonId = null, revision = null, changeId = null, now}) {
  return db.prepare(`INSERT OR IGNORE INTO jobs (id,kind,idempotency_key,workspace_id,lesson_id,lesson_revision,payload,run_at_ms,created_ms)
    SELECT ?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM lessons WHERE id=? AND change_id=?)`)
    .bind(newId(), job.kind, job.key, workspaceId, lessonId, revision, JSON.stringify(job.payload || {}), job.runAt, now, changeId, lessonId, changeId);
}
// Cancel queued jobs that belong to an older revision of a lesson.
export function cancelObsoleteStatement(db, lessonId, changeId, now) {
  return db.prepare(`UPDATE jobs SET status='cancelled', finished_ms=?, result='superseded'
    WHERE lesson_id=? AND status='pending' AND lesson_revision < (SELECT revision FROM lessons WHERE id=? AND change_id=?)`).bind(now, lessonId, lessonId, changeId);
}
async function sendMessage(db, mailer, message, now) {
  if (message.status !== 'queued') return message.status;
  try {
    const r = await mailer.send({id: message.id, to: message.recipient, subject: message.subject, text: message.body});
    await db.prepare(`UPDATE messages SET status=?, provider=?, provider_id=?, redirected_to=?, attempts=attempts+1, sent_ms=?, last_error=NULL WHERE id=? AND status='queued'`)
      .bind(r.status, r.provider, r.provider_id || null, r.redirected_to || null, now, message.id).run();
    return r.status;
  } catch (e) {
    await db.prepare(`UPDATE messages SET attempts=attempts+1, last_error=?, status=CASE WHEN ? THEN status ELSE 'failed' END WHERE id=?`).bind(String(e.message).slice(0, 200), e.retryable !== false ? 1 : 0, message.id).run();
    throw e;
  }
}
const handlers = {
  async email(db, job, ctx) {
    const p = JSON.parse(job.payload);
    const lesson = await db.prepare('SELECT * FROM lessons WHERE id=?').bind(job.lesson_id).first();
    if (!lesson || lesson.revision !== job.lesson_revision) return 'obsolete';
    if (p.template === 'reminder' && (lesson.status !== 'confirmed' || lesson.start_ms <= ctx.now)) return 'obsolete';
    const workspace = await db.prepare('SELECT * FROM workspaces WHERE id=?').bind(lesson.workspace_id).first();
    // A late-running reminder is skipped once a closer reminder is also due, so
    // a learner never receives the 48-hour and 24-hour reminders together.
    if (p.template === 'reminder' && parseOffsets(workspace.reminder_offsets).some(h => h < p.hours && lesson.start_ms - h * HOUR <= ctx.now)) return 'superseded';
    const learner = await db.prepare('SELECT * FROM learner_records WHERE id=?').bind(lesson.learner_id).first();
    const recipient = p.to === 'instructor' ? workspace.contact_email : learner.email;
    if (!recipient) return 'no_recipient';
    const content = TEMPLATES[p.template](lesson, workspace, learner, ctx.appUrl, p);
    await db.prepare(`INSERT OR IGNORE INTO messages (id,idempotency_key,workspace_id,lesson_id,template,recipient,subject,body,created_ms) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(newId(), job.idempotency_key, workspace.id, lesson.id, p.template, recipient, content.subject, content.text, ctx.now).run();
    const message = await db.prepare('SELECT * FROM messages WHERE idempotency_key=?').bind(job.idempotency_key).first();
    return sendMessage(db, ctx.mailer, message, ctx.now);
  },
  async send_message(db, job, ctx) {
    const p = JSON.parse(job.payload);
    const message = await db.prepare('SELECT * FROM messages WHERE id=?').bind(p.message_id).first();
    if (!message) return 'obsolete';
    return sendMessage(db, ctx.mailer, message, ctx.now);
  }
};
export async function processJobs(db, env = {}, {now = Date.now(), limit = 25} = {}) {
  const ctx = {now, mailer: createMailer(env), appUrl: (env.APP_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')};
  const summary = {claimed: 0, done: 0, retried: 0, failed: 0, holdsReleased: 0};
  summary.holdsReleased = (await db.prepare('DELETE FROM slot_holds WHERE expires_ms < ?').bind(now).run()).meta?.changes || 0;
  const due = (await db.prepare(`SELECT id FROM jobs WHERE (status='pending' AND run_at_ms<=?) OR (status='running' AND lease_until_ms<?) ORDER BY run_at_ms LIMIT ?`).bind(now, now, limit).all()).results;
  for (const {id} of due) {
    const claim = await db.prepare(`UPDATE jobs SET status='running', lease_until_ms=?, attempts=attempts+1 WHERE id=? AND ((status='pending' AND run_at_ms<=?) OR (status='running' AND lease_until_ms<?))`).bind(now + LEASE_MS, id, now, now).run();
    if (!claim.meta?.changes) continue;
    summary.claimed++;
    const job = await db.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first();
    try {
      const handler = handlers[job.kind];
      if (!handler) throw Object.assign(new Error('Unknown job kind.'), {retryable: false});
      const result = await handler(db, job, ctx);
      await db.prepare(`UPDATE jobs SET status='done', result=?, finished_ms=?, lease_until_ms=NULL, last_error=NULL WHERE id=?`).bind(String(result), now, id).run();
      summary.done++;
    } catch (e) {
      const final = e.retryable === false || job.attempts >= job.max_attempts;
      await db.prepare(`UPDATE jobs SET status=?, run_at_ms=?, lease_until_ms=NULL, last_error=?, finished_ms=? WHERE id=?`)
        .bind(final ? 'failed' : 'pending', now + Math.min(HOUR, MINUTE * 2 ** (job.attempts - 1)), String(e.message).slice(0, 200), final ? now : null, id).run();
      final ? summary.failed++ : summary.retried++;
    }
  }
  return summary;
}
