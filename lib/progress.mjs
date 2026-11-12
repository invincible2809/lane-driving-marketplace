// Driving-skills checklist and learner-facing progress reports.
// Descriptive stages only: these are not DVSA assessments or test-readiness judgements.
export const STAGES = ['introduced', 'practising', 'improving', 'consistent'];
export const STAGE_LABEL = {introduced: 'Introduced', practising: 'Practising', improving: 'Improving', consistent: 'Consistent'};
export const DEFAULT_SKILLS = [
  ['Getting started', 'Cockpit checks and controls'],
  ['Getting started', 'Moving off and stopping'],
  ['Getting started', 'Use of mirrors and signals'],
  ['Road skills', 'Junctions'],
  ['Road skills', 'Roundabouts'],
  ['Road skills', 'Crossroads and pedestrian crossings'],
  ['Road skills', 'Dual carriageways and faster roads'],
  ['Manoeuvres', 'Parallel parking'],
  ['Manoeuvres', 'Bay parking'],
  ['Manoeuvres', 'Pulling up on the right'],
  ['Manoeuvres', 'Emergency stop'],
  ['Awareness', 'Observation and planning'],
  ['Awareness', 'Hazard awareness'],
  ['Awareness', 'Independent driving']
];
export function validateReportSkills(skills, allowedIds) {
  if (!Array.isArray(skills)) return [];
  const seen = new Set();
  return skills.filter(s => s && allowedIds.has(s.skill_id) && STAGES.includes(s.stage) && !seen.has(s.skill_id) && seen.add(s.skill_id)).map(s => ({skill_id: s.skill_id, stage: s.stage}));
}
// Latest published stage per skill.
export function skillSummary(reports, skills) {
  const latest = new Map();
  for (const r of [...reports].sort((a, b) => a.lesson_start_ms - b.lesson_start_ms)) for (const s of r.skills) latest.set(s.skill_id, {stage: s.stage, at: r.lesson_start_ms});
  return skills.map(s => ({skill_id: s.id, area: s.area, name: s.name, stage: latest.get(s.id)?.stage || null}));
}
