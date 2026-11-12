// Availability rules. Pure functions: no database or HTTP access.
import {MINUTE, HOUR, DAY, addDays, weekdayOf, boundaryToInstant, zonedParts, timeToMinutes, isTime} from './time.mjs';
// Working windows ("HH:MM"–"HH:MM") for one local date.
// Date-specific exceptions replace weekly hours for that date: a "closed"
// exception removes the whole day; "hours" exceptions become the only windows.
export function dayWindows(date, workingHours, exceptions) {
  const own = exceptions.filter(x => x.day === date);
  if (own.some(x => x.kind === 'closed')) return [];
  const source = own.length ? own.filter(x => x.kind === 'hours') : workingHours.filter(h => h.weekday === weekdayOf(date));
  return source.map(x => ({start: x.start_time, end: x.end_time})).filter(w => isTime(w.start) && isTime(w.end) && timeToMinutes(w.end) > timeToMinutes(w.start)).sort((a, b) => a.start.localeCompare(b.start));
}
export function windowInstants(date, windows, tz) {
  return windows.map(w => ({start_ms: boundaryToInstant(date, w.start, tz, 'start'), end_ms: boundaryToInstant(date, w.end, tz, 'end')})).filter(w => w.end_ms > w.start_ms);
}
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;
// Does [start,end) collide with a busy interval once the travel buffer is applied on both sides?
export function conflictsWithBusy(start, end, busy, bufferMinutes) {
  const gap = bufferMinutes * MINUTE;
  return busy.some(b => overlaps(start, end, b.start_ms - gap, b.end_ms + gap));
}
// Explain whether a proposed lesson fits. Returns {ok, reasons[]}.
// Reasons: outside_hours | notice | horizon | blocked | conflict | past
export function evaluateSlot({start_ms, end_ms, tz, workingHours, exceptions, blocks, busy, bufferMinutes = 0, noticeHours = 0, horizonDays = 365, now}) {
  const reasons = [];
  if (start_ms <= now) reasons.push('past');
  else if (start_ms < now + noticeHours * HOUR) reasons.push('notice');
  if (start_ms > now + horizonDays * DAY) reasons.push('horizon');
  const date = zonedParts(start_ms, tz).date;
  const windows = [...windowInstants(addDays(date, -1), dayWindows(addDays(date, -1), workingHours, exceptions), tz), ...windowInstants(date, dayWindows(date, workingHours, exceptions), tz)];
  if (!windows.some(w => start_ms >= w.start_ms && end_ms <= w.end_ms)) reasons.push('outside_hours');
  if (blocks.some(b => overlaps(start_ms, end_ms, b.start_ms, b.end_ms))) reasons.push('blocked');
  if (conflictsWithBusy(start_ms, end_ms, busy, bufferMinutes)) reasons.push('conflict');
  return {ok: reasons.length === 0, reasons};
}
export const REASON_TEXT = {
  past: 'That time has already passed.',
  notice: 'That time is inside the minimum booking notice.',
  horizon: 'That time is beyond how far ahead lessons can be booked.',
  outside_hours: 'That time is outside working hours.',
  blocked: 'That time is blocked in the calendar.',
  conflict: 'That time overlaps another lesson or its travel buffer.'
};
// Bookable start times between two local dates (inclusive).
export function generateSlots({fromDate, toDate, tz, workingHours, exceptions, blocks, busy, bufferMinutes = 0, durationMinutes, stepMinutes = 30, noticeHours = 0, horizonDays = 365, now}) {
  const slots = [];
  const duration = durationMinutes * MINUTE, step = stepMinutes * MINUTE;
  const earliest = now + noticeHours * HOUR, latest = now + horizonDays * DAY;
  for (let date = fromDate, n = 0; date <= toDate && n < 400; date = addDays(date, 1), n++) {
    for (const w of windowInstants(date, dayWindows(date, workingHours, exceptions), tz)) {
      for (let t = w.start_ms; t + duration <= w.end_ms; t += step) {
        const end = t + duration;
        if (t < earliest || t > latest) continue;
        if (blocks.some(b => overlaps(t, end, b.start_ms, b.end_ms))) continue;
        if (conflictsWithBusy(t, end, busy, bufferMinutes)) continue;
        slots.push({start_ms: t, end_ms: end, date});
      }
    }
  }
  return slots;
}
