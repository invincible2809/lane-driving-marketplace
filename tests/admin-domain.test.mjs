// Unit tests for scheduling, time-zone, lesson-state and progress rules.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localToInstant, boundaryToInstant, zonedParts, wallCandidates, startOfLocalDay, addDays, HOUR, MINUTE} from '../lib/time.mjs';
import {dayWindows, generateSlots, evaluateSlot, conflictsWithBusy} from '../lib/availability.mjs';
import {nextStatus, isLateCancellation, proRataPrice} from '../lib/lessons.mjs';
import {reminderSchedule, parseOffsets, jobsForLessonEvent} from '../lib/jobs.mjs';
import {validateReportSkills, skillSummary} from '../lib/progress.mjs';
const TZ = 'Europe/London';
const iso = ms => new Date(ms).toISOString();

test('Europe/London GMT and BST conversions', () => {
  assert.equal(iso(localToInstant('2026-01-15', '09:00', TZ)), '2026-01-15T09:00:00.000Z');
  assert.equal(iso(localToInstant('2026-07-15', '09:00', TZ)), '2026-07-15T08:00:00.000Z');
  assert.deepEqual(zonedParts(Date.parse('2026-07-15T08:00:00Z'), TZ), {date: '2026-07-15', time: '09:00', second: 0, weekday: 3});
});
test('spring-forward gap and autumn overlap are rejected for lesson times', () => {
  // 29 March 2026: 01:00 GMT -> 02:00 BST. 01:30 does not exist.
  assert.throws(() => localToInstant('2026-03-29', '01:30', TZ), /does not exist/);
  assert.equal(wallCandidates('2026-03-29', '01:30', TZ).length, 0);
  // 25 October 2026: 02:00 BST -> 01:00 GMT. 01:30 happens twice.
  assert.throws(() => localToInstant('2026-10-25', '01:30', TZ), /happens twice/);
  assert.equal(wallCandidates('2026-10-25', '01:30', TZ).length, 2);
  assert.equal(iso(localToInstant('2026-03-29', '09:00', TZ)), '2026-03-29T08:00:00.000Z');
  assert.equal(iso(localToInstant('2026-10-25', '09:00', TZ)), '2026-10-25T09:00:00.000Z');
});
test('working-hour boundaries inside a clock change resolve to the change moment', () => {
  assert.equal(iso(boundaryToInstant('2026-03-29', '01:30', TZ, 'start')), '2026-03-29T01:00:00.000Z');
  assert.equal(iso(boundaryToInstant('2026-10-25', '01:30', TZ, 'start')), '2026-10-25T00:30:00.000Z');
  assert.equal(iso(boundaryToInstant('2026-10-25', '01:30', TZ, 'end')), '2026-10-25T01:30:00.000Z');
  // The local day on clock-change Sundays is 23 and 25 hours long.
  assert.equal(startOfLocalDay('2026-03-30', TZ) - startOfLocalDay('2026-03-29', TZ), 23 * HOUR);
  assert.equal(startOfLocalDay('2026-10-26', TZ) - startOfLocalDay('2026-10-25', TZ), 25 * HOUR);
});
const hours = [1, 2, 3, 4, 5, 6, 7].map(d => ({weekday: d, start_time: '09:00', end_time: '17:00'}));
const base = {tz: TZ, workingHours: hours, exceptions: [], blocks: [], busy: [], bufferMinutes: 0, durationMinutes: 60, stepMinutes: 60, noticeHours: 0, horizonDays: 365, now: Date.parse('2026-01-01T00:00:00Z')};
test('slots follow local working hours across both DST transitions', () => {
  for (const date of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26']) {
    const slots = generateSlots({...base, fromDate: date, toDate: date});
    assert.equal(slots.length, 8, date);
    assert.equal(zonedParts(slots[0].start_ms, TZ).time, '09:00', date);
    assert.equal(zonedParts(slots[7].end_ms, TZ).time, '17:00', date);
  }
});
test('travel buffer, blocks, notice and horizon remove slots', () => {
  const date = '2026-02-02';
  const lesson = {start_ms: localToInstant(date, '11:00', TZ), end_ms: localToInstant(date, '12:00', TZ)};
  const withBuffer = generateSlots({...base, fromDate: date, toDate: date, busy: [lesson], bufferMinutes: 30, stepMinutes: 30});
  const times = withBuffer.map(s => zonedParts(s.start_ms, TZ).time);
  assert.ok(!times.includes('10:00') && !times.includes('12:00'), 'buffer must block 10:00 and 12:00 starts');
  assert.ok(times.includes('09:30') && times.includes('12:30'));
  assert.ok(conflictsWithBusy(lesson.end_ms + 29 * MINUTE, lesson.end_ms + 89 * MINUTE, [lesson], 30));
  assert.ok(!conflictsWithBusy(lesson.end_ms + 30 * MINUTE, lesson.end_ms + 90 * MINUTE, [lesson], 30));
  const blocked = generateSlots({...base, fromDate: date, toDate: date, blocks: [{start_ms: localToInstant(date, '09:00', TZ), end_ms: localToInstant(date, '13:00', TZ)}]});
  assert.equal(blocked.length, 4);
  const now = localToInstant(date, '08:00', TZ);
  assert.equal(generateSlots({...base, now, noticeHours: 24, fromDate: date, toDate: date}).length, 0);
  assert.equal(generateSlots({...base, now, horizonDays: 1, fromDate: addDays(date, 2), toDate: addDays(date, 2)}).length, 0);
});
test('date exceptions replace or remove weekly hours', () => {
  const ex = [{day: '2026-02-03', kind: 'closed'}, {day: '2026-02-04', kind: 'hours', start_time: '13:00', end_time: '15:00'}];
  assert.deepEqual(dayWindows('2026-02-03', hours, ex), []);
  assert.deepEqual(dayWindows('2026-02-04', hours, ex), [{start: '13:00', end: '15:00'}]);
  assert.deepEqual(dayWindows('2026-02-05', hours, ex), [{start: '09:00', end: '17:00'}]);
});
test('evaluateSlot explains each failed rule', () => {
  const s = localToInstant('2026-02-02', '18:00', TZ);
  assert.deepEqual(evaluateSlot({...base, start_ms: s, end_ms: s + HOUR}).reasons, ['outside_hours']);
  const t = localToInstant('2026-02-02', '10:00', TZ);
  const r = evaluateSlot({...base, start_ms: t, end_ms: t + HOUR, busy: [{start_ms: t + 70 * MINUTE, end_ms: t + 130 * MINUTE}], bufferMinutes: 15, now: t - HOUR, noticeHours: 2});
  assert.deepEqual(r.reasons, ['notice', 'conflict']);
});
test('lesson state machine', () => {
  const now = Date.parse('2026-02-02T12:00:00Z');
  const future = {status: 'confirmed', start_ms: now + HOUR};
  assert.equal(nextStatus({status: 'requested', start_ms: now + HOUR}, 'confirm', 'instructor', now), 'confirmed');
  assert.throws(() => nextStatus({status: 'requested'}, 'confirm', 'learner', now), /cannot perform/);
  assert.throws(() => nextStatus(future, 'complete', 'instructor', now), /once the lesson has started/);
  assert.equal(nextStatus({status: 'confirmed', start_ms: now - HOUR}, 'complete', 'instructor', now), 'completed');
  assert.throws(() => nextStatus({status: 'cancelled'}, 'cancel', 'learner', now), /cannot be cancelled/);
  assert.equal(nextStatus(future, 'cancel', 'learner', now), 'cancelled');
  assert.ok(isLateCancellation(now + 10 * HOUR, now, 24));
  assert.ok(!isLateCancellation(now + 30 * HOUR, now, 24));
  assert.equal(proRataPrice(4000, 60, 90), 6000);
});
test('reminder schedule skips past offsets and only applies to confirmed lessons', () => {
  const now = Date.parse('2026-02-02T12:00:00Z');
  assert.deepEqual(parseOffsets('24, 48, x, 48'), [48, 24]);
  assert.deepEqual(reminderSchedule({status: 'confirmed', start_ms: now + 72 * HOUR}, '48,24', now).map(r => r.hours), [48, 24]);
  assert.deepEqual(reminderSchedule({status: 'confirmed', start_ms: now + 30 * HOUR}, '48,24', now).map(r => r.hours), [24]);
  assert.deepEqual(reminderSchedule({status: 'requested', start_ms: now + 72 * HOUR}, '48,24', now), []);
  const keys = jobsForLessonEvent('rescheduled', {id: 'L', revision: 3, status: 'confirmed', start_ms: now + 72 * HOUR}, {reminder_offsets: '48,24'}, now).map(j => j.key);
  assert.deepEqual(keys, ['email:L:3:lesson_rescheduled:learner', 'email:L:3:reminder:48:learner', 'email:L:3:reminder:24:learner']);
});
test('progress reports keep only valid skills and summarise the latest stage', () => {
  const ids = new Set(['a', 'b']);
  assert.deepEqual(validateReportSkills([{skill_id: 'a', stage: 'practising'}, {skill_id: 'a', stage: 'consistent'}, {skill_id: 'z', stage: 'introduced'}, {skill_id: 'b', stage: 'expert'}], ids), [{skill_id: 'a', stage: 'practising'}]);
  const summary = skillSummary([{lesson_start_ms: 2, skills: [{skill_id: 'a', stage: 'improving'}]}, {lesson_start_ms: 1, skills: [{skill_id: 'a', stage: 'introduced'}]}], [{id: 'a', area: 'x', name: 'A'}, {id: 'b', area: 'x', name: 'B'}]);
  assert.deepEqual(summary.map(s => s.stage), ['improving', null]);
});
