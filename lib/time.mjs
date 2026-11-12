// Time-zone utilities. All instants are stored as epoch milliseconds (UTC).
// Wall-clock dates ("YYYY-MM-DD") and times ("HH:MM") are always interpreted
// in the instructor workspace's IANA time zone (default Europe/London).
export const DEFAULT_TIME_ZONE = 'Europe/London';
export const MINUTE = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;
const formatters = new Map();
function formatter(tz) {
  if (!formatters.has(tz)) formatters.set(tz, new Intl.DateTimeFormat('en-GB', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'}));
  return formatters.get(tz);
}
const WEEKDAYS = {Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7};
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-GB', {timeZone: tz}); return true; } catch { return false; }
}
export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}
export function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
export const timeToMinutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const minutesToTime = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
// Wall-clock parts of an instant in a zone. weekday: 1 = Monday … 7 = Sunday.
export function zonedParts(ms, tz = DEFAULT_TIME_ZONE) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, second: Number(p.second), weekday: WEEKDAYS[p.weekday]};
}
// Offset of the zone from UTC at an instant, in milliseconds.
export function zoneOffset(ms, tz = DEFAULT_TIME_ZONE) {
  const p = zonedParts(ms, tz);
  const wall = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), +p.time.slice(0, 2), +p.time.slice(3, 5), p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}
export function addDays(date, n) { return new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
export function weekdayOf(date) { const d = new Date(date + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }
// All instants whose wall-clock reading in `tz` equals date+time (0, 1 or 2 results).
export function wallCandidates(date, time, tz = DEFAULT_TIME_ZONE) {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set([zoneOffset(guess - DAY, tz), zoneOffset(guess, tz), zoneOffset(guess + DAY, tz)]);
  return [...offsets].map(o => guess - o).filter(ms => { const p = zonedParts(ms, tz); return p.date === date && p.time === time; }).sort((a, b) => a - b);
}
export class ClockChangeError extends Error {
  constructor(kind, date, time) {
    super(kind === 'gap'
      ? `${time} on ${date} does not exist because the clocks go forward. Choose another time.`
      : `${time} on ${date} happens twice because the clocks go back. Choose another time.`);
    this.kind = kind; this.status = 400;
  }
}
// Strict conversion for user-entered lesson times: rejects nonexistent or ambiguous wall times.
export function localToInstant(date, time, tz = DEFAULT_TIME_ZONE) {
  if (!isDate(date) || !isTime(time)) throw Object.assign(new Error('Choose a valid date and time.'), {status: 400});
  const c = wallCandidates(date, time, tz);
  if (c.length === 0) throw new ClockChangeError('gap', date, time);
  if (c.length > 1) throw new ClockChangeError('overlap', date, time);
  return c[0];
}
// Lenient conversion for working-hours boundaries. A boundary inside a gap moves
// to the moment the clocks change; an ambiguous start uses the earlier instant and
// an ambiguous end the later one, so a window covers the whole elapsed period.
export function boundaryToInstant(date, time, tz, edge) {
  const c = wallCandidates(date, time, tz);
  if (c.length === 1) return c[0];
  if (c.length === 2) return edge === 'start' ? c[0] : c[1];
  const guess = Date.parse(`${date}T${time}:00Z`);
  let lo = guess - zoneOffset(guess + DAY, tz), hi = guess - zoneOffset(guess - DAY, tz);
  if (lo > hi) [lo, hi] = [hi, lo];
  const target = timeToMinutes(time);
  const atOrAfter = ms => { const p = zonedParts(ms, tz); return p.date > date || (p.date === date && timeToMinutes(p.time) >= target); };
  while (hi - lo > MINUTE) { const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE; if (atOrAfter(mid)) hi = mid; else lo = mid; }
  return hi;
}
// Start (inclusive) of a local calendar day as an instant.
export function startOfLocalDay(date, tz) { return boundaryToInstant(date, '00:00', tz, 'start'); }
export const toIso = ms => new Date(ms).toISOString();
export function parseInstant(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw Object.assign(new Error('Choose a valid time.'), {status: 400});
  return ms;
}
export function formatLocal(ms, tz = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-GB', {timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short'}).format(new Date(ms));
}
