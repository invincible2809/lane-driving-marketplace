// External calendar adapters (future Google / Microsoft integration).
// The internal lessons table is always the source of truth. An adapter may
// later mirror lessons out ("push") and import busy times as time blocks
// ("pull"); it must never create, move or cancel a lesson by itself.
//
// Interface:
//   name: string
//   connected: boolean
//   pushLesson(lesson, workspace) -> Promise<{externalId}>
//   removeLesson(externalId) -> Promise<void>
//   listBusy(fromMs, toMs) -> Promise<Array<{start_ms, end_ms}>>
export const nullCalendarAdapter = {
  name: 'none', connected: false,
  async pushLesson() { return {externalId: null}; },
  async removeLesson() {},
  async listBusy() { return []; }
};
export function calendarAdapterFor() { return nullCalendarAdapter; }
