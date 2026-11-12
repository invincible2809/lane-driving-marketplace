// Transactional email templates. Deliberately exclude pickup addresses,
// phone numbers and instructor notes so previews and logs stay minimal.
import {formatLocal} from './time.mjs';
const footer = (w, url) => `\n\nManage your lessons: ${url}/app#/learner\n\n${w.business_name} uses Lane to manage lessons. This is a transactional message about a lesson you booked or were booked into.`;
const when = (l, w) => `${formatLocal(l.start_ms, w.timezone)} (${Math.round((l.end_ms - l.start_ms) / 60000)} minutes)`;
const policy = w => `Cancellation terms: please give at least ${w.cancellation_notice_hours} hours' notice. See ${w.business_name}'s full policy in your lessons page.`;
export const TEMPLATES = {
  lesson_confirmed: (l, w, r, url) => ({subject: `Lesson confirmed – ${formatLocal(l.start_ms, w.timezone)}`, text: `Hello ${r.name.split(' ')[0]},\n\nYour driving lesson with ${w.business_name} is confirmed:\n${when(l, w)}\n\n${policy(w)}${footer(w, url)}`}),
  lesson_requested: (l, w, r, url) => ({subject: 'Lesson request received', text: `Hello ${r.name.split(' ')[0]},\n\n${w.business_name} has received your request for:\n${when(l, w)}\n\nThis is not yet confirmed. You will receive another email when your instructor responds.${footer(w, url)}`}),
  request_received: (l, w, r, url) => ({subject: 'New lesson request', text: `${r.name} has requested a lesson:\n${when(l, w)}\n\nReview it: ${url}/app#/lessons/${l.id}`}),
  lesson_rescheduled: (l, w, r, url) => ({subject: `Lesson moved – ${formatLocal(l.start_ms, w.timezone)}`, text: `Hello ${r.name.split(' ')[0]},\n\nYour lesson with ${w.business_name} has been moved to:\n${when(l, w)}\n\nAny earlier reminders for the previous time no longer apply.${footer(w, url)}`}),
  lesson_cancelled: (l, w, r, url) => ({subject: 'Lesson cancelled', text: `Hello ${r.name.split(' ')[0]},\n\nYour lesson with ${w.business_name} on ${formatLocal(l.start_ms, w.timezone)} has been cancelled.${footer(w, url)}`}),
  lesson_declined: (l, w, r, url) => ({subject: 'Lesson request not accepted', text: `Hello ${r.name.split(' ')[0]},\n\n${w.business_name} could not accept your request for ${formatLocal(l.start_ms, w.timezone)}. Please choose another time.${footer(w, url)}`}),
  learner_cancelled: (l, w, r, url) => ({subject: 'A learner cancelled a lesson', text: `${r.name} cancelled the lesson on ${formatLocal(l.start_ms, w.timezone)}.${l.late_cancellation ? ' This was inside your cancellation notice period.' : ''}\n\n${url}/app#/lessons/${l.id}`}),
  reminder: (l, w, r, url, p) => ({subject: `Reminder: driving lesson ${p.hours >= 48 ? 'in 2 days' : p.hours >= 24 ? 'tomorrow' : 'soon'}`, text: `Hello ${r.name.split(' ')[0]},\n\nThis is a reminder of your driving lesson with ${w.business_name}:\n${when(l, w)}\n\n${policy(w)}${footer(w, url)}`})
};
export function invitationEmail(w, learner, link) {
  return {subject: `${w.business_name} has invited you to manage your driving lessons`, text: `Hello ${learner.name.split(' ')[0]},\n\n${w.business_name} uses Lane to manage lesson bookings and progress reports. Accept your invitation to see your lessons:\n\n${link}\n\nThis link expires in 7 days and can be used once. If you were not expecting it, you can ignore this email.`};
}
