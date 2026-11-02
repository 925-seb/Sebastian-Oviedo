// The daily run: Brief → Search → Verify + score → Log + publish.
// "Every run reads yesterday's log before it searches."
import { SOURCES } from './sources/index.js';
import { normalizeBrief, PROTECTED_STATUSES } from './brief.js';
import { applyCheapRules, applyRules } from './rules.js';
import { fitGate, scoreJob } from './score.js';
import { verifyJob } from './verify.js';
import { contentHash, daysBetween, fingerprint, mapLimit, uid } from './util.js';
import * as store from './store.js';

const DETAILED_RUN_DAYS = 7; // older runs are condensed into one-line summaries
const MAX_EXCLUDED_LOGGED = 300;

export async function runPipeline({ trigger = 'manual', log = () => {} } = {}) {
  const started = new Date();
  // 1. Read memory first.
  const brief = normalizeBrief(await store.load('brief', {}));
  const jobs = await store.load('jobs', store.EMPTY.jobs);
  const runLog = await store.load('runs', store.EMPTY.runs);
  const health = [];

  // 2. Search every enabled source. A failing source is logged, never fatal.
  let raw = [];
  for (const src of SOURCES) {
    const t0 = Date.now();
    try {
      const res = await src.search(brief);
      if (res.skipped) continue;
      raw = raw.concat(res.jobs);
      health.push({ source: src.meta.label, ok: !(res.errors || []).length || res.jobs.length > 0, count: res.jobs.length, ms: Date.now() - t0, errors: res.errors || [] });
    } catch (e) {
      health.push({ source: src.meta.label, ok: false, count: 0, ms: Date.now() - t0, errors: [e.message] });
    }
    log(`searched ${src.meta.id}: ${health.at(-1)?.count ?? 0}`);
  }

  // 3. De-duplicate across sources; prefer the employer's own board over an aggregator copy.
  const byPrint = new Map();
  for (const j of raw) {
    if (!j.title || !j.company) continue;
    j.id = `${j.source}:${j.externalId}`;
    j.fingerprint = fingerprint(j);
    j.hash = contentHash(j);
    const prev = byPrint.get(j.fingerprint);
    if (!prev || (prev.sourceKind !== 'ats' && j.sourceKind === 'ats')) byPrint.set(j.fingerprint, j);
  }

  const now = started.toISOString();
  const counts = { fetched: raw.length, unique: byPrint.size, alreadySeen: 0, updated: 0, new: 0, excluded: 0, overCap: 0, expired: 0, verifyFailed: 0 };
  const excluded = [];
  runLog.excludedSeen ||= {};
  const exclude = (j, reason, rule) => {
    // remember exclusions too, so tomorrow's "Excluded today" only shows fresh decisions
    if (rule !== 'cap') runLog.excludedSeen[j.fingerprint] = { hash: j.hash, at: now, reason };
    if (excluded.length < MAX_EXCLUDED_LOGGED) excluded.push({ company: j.company, title: j.title, location: j.location, url: j.url, reason, rule });
  };
  const byFingerprint = new Map(Object.values(jobs).map((r) => [r.fingerprint, r]));

  // 4. Memory: skip anything seen in the dedupe window unless something actually changed.
  const candidates = [];
  for (const j of byPrint.values()) {
    const known = jobs[j.id] || byFingerprint.get(j.fingerprint);
    const prevExcluded = !known && runLog.excludedSeen[j.fingerprint];
    if (prevExcluded && prevExcluded.hash === j.hash && daysBetween(prevExcluded.at) < brief.rules.dedupeDays) { counts.alreadySeen++; continue; }
    if (known) {
      known.lastSeen = now;
      const recent = daysBetween(known.lastEvaluated || known.firstSeen) < brief.rules.dedupeDays;
      if (recent && known.hash === j.hash && known.verification?.live !== null) { counts.alreadySeen++; continue; }
      j._known = known;
    }
    const cheap = applyCheapRules(j, brief);
    if (cheap) { exclude(j, cheap.excludeReason, cheap.excludeRule); counts.excluded++; continue; }
    candidates.push(j);
  }

  // 5. Verify (only the survivors, to keep requests low) and score.
  if (brief.rules.verifyLive) {
    await mapLimit(candidates, 4, async (j) => { j.verification = await verifyJob(j); });
  } else {
    candidates.forEach((j) => { j.verification = { live: null, confirmed: j.sourceKind === 'ats', note: 'Verification off' }; });
  }

  const kept = [];
  for (const j of candidates) {
    if (j.verification.live === null && brief.rules.verifyLive) counts.verifyFailed++;
    const rules = applyRules(j, brief);
    if (rules.excludeReason) {
      exclude(j, rules.excludeReason, rules.excludeRule);
      counts.excluded++;
      const known = j._known;
      if (known && rules.excludeRule === 'closed') {
        known.verification = j.verification;
        if (!PROTECTED_STATUSES.includes(known.status) && known.status !== 'Dismissed') {
          known.status = 'Expired';
          known.history = [...(known.history || []), { at: now, status: 'Expired', note: j.verification.note }];
          counts.expired++;
        }
      }
      continue;
    }
    const evaluation = scoreJob(j, brief);
    const gate = fitGate(evaluation, brief);
    if (gate) { exclude(j, gate, 'fit'); counts.excluded++; continue; }
    if (j.verification.live === null) rules.flags.push({ rule: 'unverified', reason: j.verification.note || 'Could not confirm the posting is live' });
    if (evaluation.fit === 'Stretch' && evaluation.stretchReason) rules.flags.push({ rule: 'stretch', reason: evaluation.stretchReason });
    kept.push({ job: j, evaluation, flags: rules.flags });
  }

  // 6. "Do not pad the list": best first, capped. Overflow isn't marked seen, so it's reconsidered tomorrow.
  kept.sort((a, b) => fitRank(b.evaluation) - fitRank(a.evaluation) || b.evaluation.total - a.evaluation.total);
  let newCount = 0;
  const entries = [];
  for (const { job: j, evaluation, flags } of kept) {
    const known = j._known;
    if (!known && newCount >= brief.rules.maxNewPerRun) { counts.overCap++; exclude(j, 'Daily cap reached — reconsidered next run', 'cap'); continue; }
    const record = {
      ...(known || {}),
      id: known?.id || j.id,
      fingerprint: j.fingerprint,
      hash: j.hash,
      source: j.source,
      sourceKind: j.sourceKind,
      company: j.company,
      title: j.title,
      location: j.location,
      remote: j.remote,
      url: j.url,
      postedAt: j.postedAt,
      description: j.description.slice(0, 4000),
      verification: j.verification,
      evaluation,
      flags,
      status: known?.status && known.status !== 'Expired' ? known.status : 'New',
      firstSeen: known?.firstSeen || now,
      lastSeen: now,
      lastEvaluated: now,
      notes: known?.notes || '',
      history: known?.history || [{ at: now, status: 'New' }],
    };
    if (known && known.id !== record.id) delete jobs[known.id];
    jobs[record.id] = record;
    if (known) counts.updated++; else { counts.new++; newCount++; }
    entries.push({ company: j.company, role: j.title, location: j.location, fit: evaluation.fit, score: evaluation.total, flag: flags[0]?.reason || (j.verification.confirmed ? 'Employer-confirmed' : null), change: known ? 'updated' : 'new' });
  }

  // 7. Expire roles that have gone quiet — but never anything Applied / Interviewing / Offer.
  for (const r of Object.values(jobs)) {
    if (PROTECTED_STATUSES.includes(r.status) || ['Expired', 'Dismissed'].includes(r.status)) continue;
    if (daysBetween(r.lastSeen) >= brief.rules.expireDays) {
      r.status = 'Expired';
      r.history = [...(r.history || []), { at: now, status: 'Expired', note: `Not seen for ${brief.rules.expireDays}+ days` }];
      counts.expired++;
    }
  }

  // 8. Run health: so a thin day reads as "tool broke", not "no jobs".
  const warnings = [];
  const failed = health.filter((h) => !h.ok);
  if (!health.length) warnings.push('No sources are enabled — add employer boards or turn on a source in your Brief.');
  if (failed.length) warnings.push(`${failed.length} of ${health.length} source(s) failed: ${failed.map((h) => h.source).join(', ')}. Results may be thin.`);
  if (counts.verifyFailed) warnings.push(`${counts.verifyFailed} posting(s) could not be verified and are marked Unconfirmed.`);
  if (health.length && !failed.length && counts.fetched === 0) warnings.push('Sources returned zero listings — check board names in your Brief.');

  const run = {
    id: uid(),
    trigger,
    startedAt: now,
    finishedAt: new Date().toISOString(),
    counts,
    health,
    warnings,
    status: failed.length === health.length && health.length ? 'failed' : warnings.length ? 'degraded' : 'ok',
    entries,
    excluded,
  };
  runLog.runs.unshift(run);
  condense(runLog);
  for (const [k, v] of Object.entries(runLog.excludedSeen)) if (daysBetween(v.at) >= brief.rules.dedupeDays) delete runLog.excludedSeen[k];

  await store.save('jobs', jobs);
  await store.save('runs', runLog);
  log(`run ${run.id}: ${counts.new} new, ${counts.excluded} excluded, status ${run.status}`);
  return run;
}

const FIT_ORDER = { Strong: 3, Realistic: 2, Stretch: 1 };
const fitRank = (e) => FIT_ORDER[e.fit] || 0;

/** "Logs grow fast": keep recent runs in detail, condense older ones into short summaries. */
export function condense(runLog, now = new Date()) {
  const keep = [];
  for (const r of runLog.runs) {
    if (daysBetween(r.startedAt, now) < DETAILED_RUN_DAYS) { keep.push(r); continue; }
    const reasons = {};
    for (const e of r.excluded || []) reasons[e.reason.replace(/\(.*\)/, '').trim()] = (reasons[e.reason.replace(/\(.*\)/, '').trim()] || 0) + 1;
    runLog.summaries.unshift({
      date: r.startedAt.slice(0, 10),
      status: r.status,
      new: r.counts.new,
      excluded: r.counts.excluded,
      topReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ×${v}`),
      highlights: (r.entries || []).filter((e) => e.change === 'new').slice(0, 3).map((e) => `${e.company} — ${e.role}`),
    });
  }
  runLog.runs = keep;
  runLog.summaries = runLog.summaries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 365);
  return runLog;
}
