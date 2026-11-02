// Step 2 of the pipeline picture — the daily run. "My job search runs every morning, even when I don't."
// In-process scheduler: fires once a day at brief.schedule.time (server local time), and catches up
// on start if today's run was missed. For always-on hosting, `npm run run-once` from cron works too.
import { getBrief, runNow } from './service.js';
import * as store from './store.js';

let timer = null;

export function nextRunAt(time, from = new Date()) {
  const [h, m] = time.split(':').map(Number);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}

export async function startScheduler(log = console.log) {
  stopScheduler();
  const brief = await getBrief();
  if (!brief.schedule.enabled) { log('scheduler: off'); return null; }

  // Catch-up: if it's past today's slot and nothing ran today, run now.
  const runLog = await store.load('runs', store.EMPTY.runs);
  const last = runLog.runs[0]?.startedAt;
  const todaySlot = nextRunAt(brief.schedule.time, new Date(new Date().setHours(0, 0, 0, 0)));
  if (brief.completed && new Date() > todaySlot && (!last || new Date(last) < todaySlot)) {
    log('scheduler: missed today’s run — catching up');
    runNow('catch-up', log).catch((e) => log(`run failed: ${e.message}`));
  }

  const at = nextRunAt(brief.schedule.time);
  // setTimeout caps at ~24.8 days; a day is well within that. Re-arm after each run.
  timer = setTimeout(async () => {
    try { await runNow('scheduled', log); } catch (e) { log(`scheduled run failed: ${e.message}`); }
    startScheduler(log);
  }, at - Date.now());
  timer.unref?.();
  log(`scheduler: next run ${at.toLocaleString()}`);
  return at;
}

export function stopScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
}
