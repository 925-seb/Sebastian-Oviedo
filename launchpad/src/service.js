// Application service: everything the API (and CLI) can do, on top of the JSON store.
import { defaultBrief, normalizeBrief, STATUSES, TRACK_PRESETS, PROTECTED_STATUSES } from './brief.js';
import { DISMISS_REASONS, RULES, modeFor } from './rules.js';
import { runPipeline } from './pipeline.js';
import { daysBetween, normalizeKey } from './util.js';
import * as store from './store.js';
import { extractText, MAX_BYTES } from './extract.js';
import { parseResume } from './resume.js';
import { STEPS, QUESTIONNAIRE_VERSION, applyAnswers, answersFromBrief } from './questionnaire.js';

export async function getBrief() {
  const saved = await store.load('brief', null);
  const brief = normalizeBrief(saved || defaultBrief());
  if (process.env.LAUNCHPAD_DEMO === '1' && !saved) return demoBrief(brief);
  return brief;
}

/** Demo mode: a filled-in example brief that only uses the offline demo source. */
function demoBrief(brief) {
  brief.completed = true;
  Object.assign(brief.profile, { name: 'Demo Student', school: 'State University', major: 'Business Administration, MIS', gradDate: '2027-05', yearsExperience: 1, experienceSummary: 'Learning trainer (full time), sales associate, marketing internship, peer mentor.' });
  brief.locations.tiers = [
    { label: 'Local', places: ['Tracy', 'Manteca', 'Lathrop', 'Stockton'] },
    { label: 'Commutable', places: ['Sacramento', 'San Jose'] },
    { label: 'Would relocate', places: ['San Francisco', 'Bay Area'] },
  ];
  brief.employment.earliestStart = '2027-06';
  for (const k of Object.keys(brief.sources)) brief.sources[k].enabled = k === 'demo';
  brief.questionnaire = { version: QUESTIONNAIRE_VERSION, completedAt: new Date().toISOString(), answers: answersFromBrief(brief) };
  return brief;
}

export async function saveBrief(input) {
  const brief = normalizeBrief(input);
  await store.save('brief', brief);
  return brief;
}

let running = null;
export function isRunning() { return !!running; }

/** Single-flight: a second "Run now" while a run is in progress waits for the same run. */
export async function runNow(trigger = 'manual', log) {
  if (running) return running;
  // make sure the brief the pipeline reads is on disk (first run in demo mode)
  if (!(await store.load('brief', null))) await saveBrief(await getBrief());
  running = runPipeline({ trigger, log }).finally(() => { running = null; });
  return running;
}

export async function getDashboard() {
  const [brief, jobs, runLog] = await Promise.all([getBrief(), store.load('jobs', store.EMPTY.jobs), store.load('runs', store.EMPTY.runs)]);
  const lastRun = runLog.runs[0] || null;
  const all = Object.values(jobs);
  const active = all.filter((j) => !['Dismissed', 'Expired'].includes(j.status));
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    newToday: active.filter((j) => (j.firstSeen || '').slice(0, 10) === today).length,
    active: active.length,
    applied: all.filter((j) => ['Applied', 'Interviewing', 'Offer'].includes(j.status)).length,
    interviewing: all.filter((j) => ['Interviewing', 'Offer'].includes(j.status)).length,
  };
  const sorted = all
    .map((j) => ({ ...j, description: undefined, snippet: (j.description || '').slice(0, 320), ageDays: j.postedAt ? daysBetween(j.postedAt) : null }))
    .sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '') || (b.evaluation?.total || 0) - (a.evaluation?.total || 0));
  return {
    brief,
    stats,
    jobs: sorted,
    lastRun: lastRun && { id: lastRun.id, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, status: lastRun.status, counts: lastRun.counts, health: lastRun.health, warnings: lastRun.warnings, excluded: lastRun.excluded },
    running: isRunning(),
    questionnaire: { version: QUESTIONNAIRE_VERSION, steps: STEPS, answers: answersFromBrief(brief), done: brief.questionnaire?.version === QUESTIONNAIRE_VERSION },
    meta: { statuses: STATUSES, protectedStatuses: PROTECTED_STATUSES, dismissReasons: DISMISS_REASONS, trackPresets: TRACK_PRESETS },
  };
}

export async function getJob(id) {
  const jobs = await store.load('jobs', store.EMPTY.jobs);
  return jobs[id] || null;
}

export async function updateJob(id, { status, notes }) {
  const jobs = await store.load('jobs', store.EMPTY.jobs);
  const job = jobs[id];
  if (!job) return null;
  if (status !== undefined) {
    if (!STATUSES.includes(status)) throw Object.assign(new Error(`Unknown status ${status}`), { status: 400 });
    if (status !== job.status) {
      job.status = status;
      job.history = [...(job.history || []), { at: new Date().toISOString(), status }];
      if (status !== 'Expired') job.lastSeen = new Date().toISOString(); // reviving a role resets its expiry clock
    }
  }
  if (notes !== undefined) job.notes = String(notes).slice(0, 4000);
  await store.save('jobs', jobs);
  return job;
}

/**
 * Dismiss with a reason. Reasons are counted; once one repeats `promoteAfter` times it becomes a
 * standing rule (rule switched to exclude, or the company added to the blocklist).
 */
export async function dismissJob(id, reasonId) {
  const reason = DISMISS_REASONS.find((r) => r.id === reasonId) || DISMISS_REASONS.at(-1);
  const [jobs, learned, brief] = await Promise.all([store.load('jobs', store.EMPTY.jobs), store.load('learned', store.EMPTY.learned), getBrief()]);
  const job = jobs[id];
  if (!job) return null;
  const now = new Date().toISOString();
  job.status = 'Dismissed';
  job.dismissReason = reason.label;
  job.history = [...(job.history || []), { at: now, status: 'Dismissed', note: reason.label }];

  const threshold = brief.rules.promoteAfter;
  let promoted = null;
  if (reason.id === 'company') {
    const key = normalizeKey(job.company);
    learned.companyCounts[key] = (learned.companyCounts[key] || 0) + 1;
    if (learned.companyCounts[key] >= Math.min(threshold, 2) && !brief.blocked.companies.some((c) => normalizeKey(c) === key)) {
      brief.blocked.companies.push(job.company);
      promoted = { kind: 'company', label: `Blocked company: ${job.company}`, at: now };
    }
  } else if (reason.id !== 'other') {
    learned.reasonCounts[reason.id] = (learned.reasonCounts[reason.id] || 0) + 1;
    const rule = RULES.find((r) => r.id === reason.id);
    if (rule && learned.reasonCounts[reason.id] >= threshold && modeFor(rule, brief) !== 'exclude') {
      brief.exclusionModes[rule.id] = 'exclude';
      promoted = { kind: 'rule', label: `Standing rule: ${rule.label}`, at: now };
    }
  }
  if (promoted) {
    learned.promoted.unshift(promoted);
    await saveBrief(brief);
  }
  await Promise.all([store.save('jobs', jobs), store.save('learned', learned)]);
  return { job, promoted };
}

export async function getMemory() {
  const [brief, runLog, learned] = await Promise.all([getBrief(), store.load('runs', store.EMPTY.runs), store.load('learned', store.EMPTY.learned)]);
  // count how often each rule excluded something across the detailed runs
  const hits = {};
  for (const r of runLog.runs) for (const e of r.excluded || []) hits[e.rule] = (hits[e.rule] || 0) + 1;
  return {
    runs: runLog.runs.map(({ excluded, ...r }) => ({ ...r, excludedCount: (excluded || []).length })),
    summaries: runLog.summaries,
    rules: RULES.map((r) => ({ id: r.id, label: r.label, mode: modeFor(r, brief), locked: !!r.locked, defaultMode: r.defaultMode, hits: hits[r.id] || 0, dismissals: learned.reasonCounts[r.id] || 0 })),
    fitHits: hits.fit || 0,
    blocked: brief.blocked,
    promoted: learned.promoted,
    promoteAfter: brief.rules.promoteAfter,
  };
}

export async function setRuleMode(ruleId, mode) {
  const rule = RULES.find((r) => r.id === ruleId);
  if (!rule || rule.locked || !['exclude', 'flag', 'off'].includes(mode)) throw Object.assign(new Error('Invalid rule or mode'), { status: 400 });
  const brief = await getBrief();
  brief.exclusionModes[ruleId] = mode;
  await saveBrief(brief);
  return { id: ruleId, mode };
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // keep spreadsheets from treating text as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Tracker export for a spreadsheet. */
export async function exportCsv() {
  const jobs = Object.values(await store.load('jobs', store.EMPTY.jobs));
  const head = ['Company', 'Role', 'Location', 'Track', 'Fit', 'Score', 'Pay', 'Status', 'First seen', 'Posted', 'Link', 'Notes'];
  const rows = jobs.map((j) => [j.company, j.title, j.location, j.evaluation?.track, j.evaluation?.fit, j.evaluation?.total, j.evaluation?.pay?.label, j.status, (j.firstSeen || '').slice(0, 10), (j.postedAt || '').slice(0, 10), j.url, j.notes]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

// ——— Resume / profile ———

const resumeView = (r) => r && { fileName: r.fileName, type: r.type, uploadedAt: r.uploadedAt, characters: r.text.length, preview: r.text.slice(0, 700), extracted: r.extracted };

export async function getResume() {
  return resumeView(await store.load('resume', null));
}

/**
 * Accepts { fileName, data } (base64 file) or { text } (pasted). Extracts text locally, parses it into
 * suggested Brief fields, and keeps it on disk. Nothing is applied to the Brief until the user confirms.
 */
export async function uploadResume({ fileName = '', data, text } = {}) {
  let type = 'text';
  let body = text;
  if (data) {
    const buf = Buffer.from(String(data), 'base64');
    if (!buf.length) throw Object.assign(new Error('The file is empty'), { status: 400 });
    if (buf.length > MAX_BYTES) throw Object.assign(new Error('File is larger than 5 MB'), { status: 413 });
    ({ type, text: body } = extractText(buf, fileName));
  }
  body = String(body || '').slice(0, 200_000).trim();
  if (body.length < 40) throw Object.assign(new Error('Not enough text to read — is this a resume?'), { status: 422 });
  const record = { fileName: String(fileName || 'Pasted text').slice(0, 120), type, uploadedAt: new Date().toISOString(), text: body, extracted: parseResume(body) };
  await store.save('resume', record);
  return resumeView(record);
}

export async function deleteResume() {
  await store.save('resume', null);
  return { ok: true };
}

// ——— Onboarding questionnaire ———

/** Validate the answers, write them into the brief, and save. Throws 400 with per-question errors. */
export async function submitQuestionnaire(answers) {
  const brief = applyAnswers(await getBrief(), answers || {});
  await store.save('brief', brief);
  return brief;
}
