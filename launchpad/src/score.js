// Step 2 — score every role the same way.
// Signal weights come from the brief (default: experience 40, track 30, comp 20, employment 10).
import { daysBetween } from './util.js';
import { parseCompensation, parseEmploymentType, parseMinYears, locationTier, ENTRY_SIGNALS, SENIOR_SIGNALS } from './parse.js';

const has = (hay, needle) => {
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  // word-boundary match so "sdr" doesn't match inside other words
  return new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(hay);
};

/** Experience fit: is this realistic for someone with my background? */
export function experienceFit(job, brief) {
  const yoe = brief.profile.yearsExperience;
  const minYears = parseMinYears(job.description);
  const entry = ENTRY_SIGNALS.test(job.title);
  const senior = SENIOR_SIGNALS.test(job.title);
  let score;
  let label;
  let reason = null;
  if (senior) { score = 0.1; label = 'Reach'; reason = 'Senior title'; }
  else if (minYears == null) { score = entry ? 1 : 0.8; label = 'Realistic'; }
  else if (minYears <= yoe) { score = 1; label = 'Realistic'; }
  else if (minYears <= yoe + 1) { score = 0.7; label = 'Stretch'; reason = `Asks for ${minYears}+ years (you have ${yoe})`; }
  else if (minYears <= yoe + 2) { score = 0.45; label = 'Stretch'; reason = `Asks for ${minYears}+ years (you have ${yoe})`; }
  else { score = 0.1; label = 'Reach'; reason = `Asks for ${minYears}+ years`; }
  if (entry && score < 1 && !senior) score = Math.min(1, score + 0.15);
  return { score, label, reason, minYears };
}

/** Track alignment: which of my ranked tracks does this belong to? Bonus for core industries. */
export function trackAlignment(job, brief) {
  const title = job.title || '';
  const desc = job.description || '';
  let best = { score: 0, track: null };
  brief.tracks.forEach((t, rank) => {
    const titleHit = t.titleKeywords.some((k) => has(title, k));
    const descHits = t.descKeywords.filter((k) => has(desc, k)).length + t.titleKeywords.filter((k) => has(desc, k)).length;
    let s = titleHit ? 1 : descHits >= 3 ? 0.55 : descHits === 2 ? 0.4 : descHits === 1 ? 0.2 : 0;
    s *= 1 - rank * 0.05; // rank 1 = full credit, rank 4 = 85%
    if (s > best.score) best = { score: s, track: t };
  });
  const industry = brief.coreIndustries.find((i) => has(`${job.company} ${desc}`, i));
  if (industry && best.score > 0) best.score = Math.min(1, best.score + 0.1);
  // Skills from your resume that the posting asks for: two or more = a small bonus.
  const skillsMatched = (brief.profile.skills || []).filter((k) => k.length > 1 && has(`${title}\n${desc}`, k)).slice(0, 8);
  if (skillsMatched.length >= 2 && best.score > 0) best.score = Math.min(1, best.score + (skillsMatched.length >= 4 ? 0.15 : 0.1));
  return { score: best.score, trackId: best.track?.id || null, trackLabel: best.track?.label || null, industry: industry || null, salesComp: !!best.track?.salesComp, skillsMatched };
}

/** Compensation vs. the brief's floors: base salary, or OTE for sales-comp tracks. */
export function compensationFit(job, brief, track) {
  const comp = parseCompensation(job);
  const { minBase, minOTE } = brief.compensation;
  if (!comp) return { score: 0.5, comp: null, meets: null, label: 'Pay not listed' };
  const floor = comp.type === 'ote' || (track.salesComp && comp.type !== 'base') ? minOTE : minBase;
  const top = comp.max || comp.min;
  const fmt = (n) => `$${Math.round(n / 1000)}k`;
  const label = `${fmt(comp.min)}${comp.max && comp.max !== comp.min ? `–${fmt(comp.max)}` : ''}${comp.type === 'ote' ? ' OTE' : ''}`;
  if (comp.min >= floor) return { score: 1, comp, meets: true, label };
  if (top >= floor) return { score: 0.8, comp, meets: true, label };
  if (top >= floor * 0.9) return { score: 0.5, comp, meets: false, label };
  return { score: 0.15, comp, meets: false, label };
}

export function employmentFit(job, brief) {
  const type = parseEmploymentType(job);
  if (!type) return { score: 0.7, type: null };
  if (brief.employment.types.includes(type)) return { score: 1, type };
  if (type === 'intern') return { score: 0.25, type };
  if (type === 'contract') return { score: 0.4, type };
  return { score: 0.3, type };
}

/** Full evaluation: weighted 0–100 score, fit label, and the badges shown on the card. */
export function scoreJob(job, brief) {
  const w = brief.weights;
  const exp = experienceFit(job, brief);
  const track = trackAlignment(job, brief);
  const comp = compensationFit(job, brief, track);
  const emp = employmentFit(job, brief);
  const totalW = w.experience + w.track + w.comp + w.employment || 1;
  const parts = {
    experience: { score: exp.score, weight: w.experience },
    track: { score: track.score, weight: w.track },
    comp: { score: comp.score, weight: w.comp },
    employment: { score: emp.score, weight: w.employment },
  };
  const total = Math.round(Object.values(parts).reduce((s, p) => s + p.score * p.weight, 0) / totalW * 100);

  let fit;
  if (track.score === 0) fit = 'Off-track';
  else if (exp.label === 'Reach') fit = 'Reach';
  else if (exp.label === 'Stretch') fit = 'Stretch';
  else if (total >= 75) fit = 'Strong';
  else fit = 'Realistic';

  const age = job.postedAt ? daysBetween(job.postedAt) : null;
  const tier = locationTier(job, brief);
  return {
    total,
    fit,
    parts,
    stretchReason: exp.reason,
    track: track.trackLabel,
    trackId: track.trackId,
    industry: track.industry,
    skillsMatched: track.skillsMatched,
    pay: { label: comp.label, meets: comp.meets, ...(comp.comp || {}) },
    employmentType: emp.type,
    ageDays: age,
    fresh: age != null && age <= brief.rules.freshnessDays,
    locationTier: tier === 'remote' ? 'Remote' : tier == null ? null : brief.locations.tiers[tier]?.label || `Tier ${tier + 1}`,
    locationTierIndex: tier === 'remote' ? 'remote' : tier,
  };
}

/** Should this scored role be shown? Returns null (show) or an exclusion reason. */
export function fitGate(evaluation, brief) {
  if (evaluation.fit === 'Off-track') return 'Not in any of your tracks';
  if (evaluation.fit === 'Reach') return evaluation.stretchReason || 'Not realistic for your experience';
  if (evaluation.fit === 'Stretch' && !brief.rules.flagStretch) return evaluation.stretchReason;
  if (evaluation.fit !== 'Stretch' && evaluation.total < brief.rules.minScore) return `Below your fit threshold (${evaluation.total} < ${brief.rules.minScore})`;
  return null;
}
