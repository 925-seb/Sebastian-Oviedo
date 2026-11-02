#!/usr/bin/env node
// Run the pipeline once and exit — handy for an OS cron job / GitHub Action / Task Scheduler:
//   0 7 * * *  cd /path/to/launchpad && npm run run-once
import { runNow } from './service.js';

const run = await runNow('cli', (m) => console.log(`[launchpad] ${m}`));
console.log(`\nStatus: ${run.status}`);
console.log(`New: ${run.counts.new} · Updated: ${run.counts.updated} · Already seen: ${run.counts.alreadySeen} · Excluded: ${run.counts.excluded}`);
for (const w of run.warnings) console.log(`⚠ ${w}`);
for (const e of run.entries.slice(0, 15)) console.log(`  [${e.fit}] ${e.score}  ${e.company} — ${e.role} (${e.location})${e.flag ? `  · ${e.flag}` : ''}`);
process.exit(run.status === 'failed' ? 1 : 0);
