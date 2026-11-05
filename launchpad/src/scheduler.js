// The automated refresh. "My job search runs every morning, even when I don't."
// Frequency comes from the questionnaire: daily, every weekday, twice a week (Mon & Thu), weekly, or manual.
// In-process timer that also catches up on start if a scheduled slot was missed. For always-on hosting,
// `npm run run-once` from cron works too.
import { getBrief, runNow } from './service.js';
import * as store from './store.js';

let timer = null;

/** Does this schedule run on weekday `dow` (0 = Sunday)? */
export function runsOn(schedule, dow) {
  switch (schedule.frequency || 'daily') {
    case 'daily': return true;
    case 'weekdays': return dow >= 1 && dow <= 5;
    case 'twice-weekly': return dow === 1 || dow === 4;
    case 'weekly': return dow === Number(schedule.day ?? 1);
    default: return false;
  }
}

const slotOn = (date, time) => {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
};

/** Next run strictly after `from`, or null when the refresh is manual/off. */
export function nextRunAt(schedule, from = new Date()) {
  if (!schedule || schedule.enabled === false || schedule.frequency === 'manual') return null;
  for (let i = 0; i <= 8; i++) {
    const d = slotOn(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i), schedule.time);
    if (d > from && runsOn(schedule, d.getDay())) return d;
  }
  return null;
}

/** Most recent slot at or before `from`, used to detect a missed run. */
export function lastSlotAt(schedule, from = new Date()) {
  if (!schedule || schedule.enabled === false || schedule.frequency === 'manual') return null;
  for (let i = 0; i <= 8; i++) {
    const d = slotOn(new Date(from.getFullYear(), from.getMonth(), from.getDate() - i), schedule.time);
    if (d <= from && runsOn(schedule, d.getDay())) return d;
  }
  return null;
}

export async function startScheduler(log = console.log) {
  stopScheduler();
  const brief = await getBrief();
  const at = nextRunAt(brief.schedule);
  if (!at) { log('scheduler: manual refresh only'); return null; }

  // Catch-up: the most recent slot passed while nothing ran (machine asleep, server down).
  const runLog = await store.load('runs', store.EMPTY.runs);
  const last = runLog.runs[0]?.startedAt;
  const missed = lastSlotAt(brief.schedule);
  if (brief.completed && missed && (!last || new Date(last) < missed) && Date.now() - missed < 2 * 86_400_000) {
    log('scheduler: missed a scheduled run, catching up');
    runNow('catch-up', log).catch((e) => log(`run failed: ${e.message}`));
  }

  // setTimeout caps at ~24.8 days; a slot is at most 7 days out. Re-arm after each run.
  timer = setTimeout(async () => {
    try { await runNow('scheduled', log); } catch (e) { log(`scheduled run failed: ${e.message}`); }
    startScheduler(log);
  }, at - Date.now());
  timer.unref?.();
  log(`scheduler: ${brief.schedule.frequency}, next run ${at.toLocaleString()}`);
  return at;
}

export function stopScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
}
