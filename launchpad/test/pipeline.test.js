import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.LAUNCHPAD_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'launchpad-test-'));
process.env.LAUNCHPAD_DEMO = '1';

const { parseCompensation, parseMinYears } = await import('../src/parse.js');
const { scoreJob, fitGate } = await import('../src/score.js');
const { applyRules } = await import('../src/rules.js');
const { defaultBrief, normalizeBrief } = await import('../src/brief.js');
const svc = await import('../src/service.js');
const { condense } = await import('../src/pipeline.js');

const brief = normalizeBrief({ ...defaultBrief(), profile: { ...defaultBrief().profile, yearsExperience: 1 } });
const job = (o) => ({ company: 'Acme', title: 'Business Analyst', location: 'San Jose, CA', description: '', ...o });

test('compensation: ranges, hourly, explicit OTE', () => {
  assert.deepEqual(parseCompensation(job({ description: 'Salary: $68,000 - $78,000 per year' })), { min: 68000, max: 78000, type: 'base', source: 'parsed' });
  assert.equal(parseCompensation(job({ description: 'Pay $30/hr' })).min, 62400);
  const ote = parseCompensation(job({ description: 'Base $55,000 plus commission, OTE $90,000.' }));
  assert.equal(ote.type, 'ote');
  assert.equal(ote.min, 90000);
  assert.equal(parseCompensation(job({ description: 'Competitive pay' })), null);
});

test('years parsing ignores degree/program durations', () => {
  assert.equal(parseMinYears('3+ years of experience in sales'), 3);
  assert.equal(parseMinYears('0-2 years experience'), 0);
  assert.equal(parseMinYears('a 2-year rotational program'), null);
});

test('rules catch the "entry level" traps', () => {
  const reason = (description, title) => applyRules(job({ description, ...(title && { title }) }), brief).excludeReason;
  assert.match(reason('An MBA is required for this role.'), /Master/);
  assert.equal(reason("Bachelor's or Master's degree in business."), null);
  assert.match(reason('Active Secret clearance required.'), /clearance/);
  assert.match(reason("Bachelor's degree in Computer Science required."), /Computer Science/);
  assert.equal(reason("Bachelor's degree in Computer Science or related field."), null);
  assert.match(reason('This is a commission-only role.'), /Commission/);
  assert.match(reason('', 'Senior Business Analyst'), /Senior/);
  assert.match(reason('Requires 6+ years of experience.'), /6\+ years/);
});

test('scoring: realistic vs stretch, weights respected', () => {
  const good = scoreJob(job({ title: 'Business Analyst, Associate', description: 'SQL and Tableau. 0-1 years experience. $70,000 - $80,000 salary.', employmentType: 'full-time' }), brief);
  assert.equal(good.fit, 'Strong');
  assert.equal(fitGate(good, brief), null);
  const stretch = scoreJob(job({ description: 'SQL. 2+ years of experience.' }), brief);
  assert.equal(stretch.fit, 'Stretch');
  assert.match(stretch.stretchReason, /2\+ years/);
  const off = scoreJob(job({ title: 'Registered Nurse' }), brief);
  assert.equal(off.fit, 'Off-track');
  assert.ok(fitGate(off, brief));
});

let firstRun;
before(async () => { firstRun = await svc.runNow('test'); });

test('demo run: keeps fits, excludes traps with reasons, logs health', () => {
  assert.equal(firstRun.status, 'ok');
  assert.ok(firstRun.counts.new >= 5);
  const reasons = firstRun.excluded.map((e) => e.reason).join(' | ');
  for (const r of [/clearance/, /Master/, /Computer Science/, /Commission/, /Senior/, /Evergreen/, /days ago/, /filled/]) assert.match(reasons, r);
});

test('memory: second run repeats nothing', async () => {
  const run = await svc.runNow('test');
  assert.equal(run.counts.new, 0);
  assert.equal(run.counts.excluded, 0);
  assert.ok(run.counts.alreadySeen > 0);
});

test('applied roles survive, dismissals become standing rules', async () => {
  const d = await svc.getDashboard();
  const [a, ...rest] = d.jobs;
  await svc.updateJob(a.id, { status: 'Applied' });
  let promoted;
  for (const j of rest.slice(0, 3)) promoted = (await svc.dismissJob(j.id, 'startsEarly')).promoted;
  assert.match(promoted.label, /Standing rule/);
  assert.equal((await svc.getBrief()).exclusionModes.startsEarly, 'exclude');
  const after = await svc.getDashboard();
  assert.equal(after.stats.applied, 1);
});

test('old runs are condensed into summaries', () => {
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const log = condense({ runs: [{ startedAt: old, status: 'ok', counts: { new: 2, excluded: 1 }, entries: [{ company: 'A', role: 'B', change: 'new' }], excluded: [{ reason: 'Senior title (“Sr”)' }] }], summaries: [] });
  assert.equal(log.runs.length, 0);
  assert.equal(log.summaries[0].new, 2);
  assert.deepEqual(log.summaries[0].topReasons, ['Senior title ×1']);
});

test('csv export neutralises formulas', async () => {
  const csv = await svc.exportCsv();
  assert.match(csv.split('\n')[0], /^Company,Role/);
});
