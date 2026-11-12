// Lesson state machine, cancellation-policy and pricing rules.
import {HOUR} from './time.mjs';
export const STATUSES = ['requested', 'confirmed', 'completed', 'cancelled', 'no_show', 'declined'];
export const ACTIVE = ['requested', 'confirmed'];
export const STATUS_LABEL = {requested: 'Requested', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show', declined: 'Declined'};
// action -> {from: [statuses], to, roles, afterStart?}
export const ACTIONS = {
  confirm: {from: ['requested'], to: 'confirmed', roles: ['instructor']},
  decline: {from: ['requested'], to: 'declined', roles: ['instructor']},
  cancel: {from: ['requested', 'confirmed'], to: 'cancelled', roles: ['instructor', 'learner']},
  reschedule: {from: ['requested', 'confirmed'], to: null, roles: ['instructor']},
  complete: {from: ['confirmed'], to: 'completed', roles: ['instructor'], afterStart: true},
  no_show: {from: ['confirmed'], to: 'no_show', roles: ['instructor'], afterStart: true}
};
const ACTION_PAST = {confirm: 'confirmed', decline: 'declined', cancel: 'cancelled', reschedule: 'rescheduled', complete: 'marked as completed', no_show: 'marked as a no-show'};
export class TransitionError extends Error { constructor(message) { super(message); this.status = 409; } }
export function nextStatus(lesson, action, role, now) {
  const rule = ACTIONS[action];
  if (!rule) throw Object.assign(new Error('Unknown lesson action.'), {status: 400});
  if (!rule.roles.includes(role)) throw Object.assign(new Error('You cannot perform that action on this lesson.'), {status: 403});
  if (!rule.from.includes(lesson.status)) throw new TransitionError(`A ${STATUS_LABEL[lesson.status].toLowerCase()} lesson cannot be ${ACTION_PAST[action]}.`);
  if (rule.afterStart && now < lesson.start_ms) throw new TransitionError('This can only be recorded once the lesson has started.');
  return rule.to ?? lesson.status;
}
// A cancellation is "late" when made inside the instructor's notice period.
// Lane records this fact only; it does not decide whether a fee is payable.
export function isLateCancellation(startMs, now, noticeHours) { return startMs - now < noticeHours * HOUR; }
export function proRataPrice(standardPence, standardMinutes, minutes) { return Math.round(standardPence * minutes / standardMinutes); }
export const PAYMENT_STATUSES = ['unpaid', 'paid', 'waived'];
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'other'];
export const formatPence = p => '£' + (p / 100).toFixed(2);
// Recurring series conflict handling, shown to the instructor before creation.
export const SERIES_MODES = {
  all_or_nothing: 'If any date conflicts, no lessons in the series are created.',
  skip_conflicts: 'Dates that conflict are skipped and listed for you to resolve individually.'
};
