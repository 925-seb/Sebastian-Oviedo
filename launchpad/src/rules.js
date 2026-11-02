// Exclusions: "every rejected role gets a reason, and repeat reasons become standing rules."
//
// Each rule returns a reason string (it matched) or null. A rule's mode decides what a match does:
//   exclude → the role goes to "Excluded today" with the reason
//   flag    → the role is shown, with the reason as a warning badge
//   off     → ignored
import { daysBetween, normalizeKey } from './util.js';
import { locationTier, parseMinYears, SENIOR_SIGNALS } from './parse.js';

const txt = (job) => `${job.title}\n${job.description || ''}`;

export const RULES = [
  {
    id: 'closed', label: 'Posting closed', defaultMode: 'exclude', locked: true,
    test: (job) => (job.verification?.live === false ? job.verification.note || 'Posting is no longer live' : null),
  },
  {
    id: 'stale', label: 'Stale or evergreen posting', defaultMode: 'exclude',
    test: (job, brief) => {
      if (/\b(evergreen|talent (pool|community|network)|future opportunit|general (application|interest)|always (hiring|accepting)|pipeline requisition)\b/i.test(txt(job))) return 'Evergreen / talent-pool posting';
      const age = job.postedAt ? daysBetween(job.postedAt) : null;
      return age != null && age > brief.rules.staleDays ? `Posted ${age} days ago` : null;
    },
  },
  {
    id: 'senior', label: 'Senior title', defaultMode: 'exclude',
    test: (job) => (SENIOR_SIGNALS.test(job.title) ? `Senior title (“${job.title.match(SENIOR_SIGNALS)[0]}”)` : null),
  },
  {
    id: 'years', label: 'Too many years required', defaultMode: 'exclude',
    test: (job, brief) => {
      const yrs = parseMinYears(job.description);
      return yrs != null && yrs > brief.profile.yearsExperience + 2 ? `Requires ${yrs}+ years` : null;
    },
  },
  {
    id: 'masters', label: "Master's required", defaultMode: 'exclude',
    test: (job, brief) => {
      if (brief.profile.hasMasters) return null;
      const t = txt(job);
      if (/(bachelor'?s|bs|ba|undergraduate)[^.\n]{0,25}\bor\b[^.\n]{0,15}(master|mba|graduate)/i.test(t)) return null;
      return /(master'?s|mba|graduate degree|advanced degree)[^.\n]{0,40}\b(required|is required|must|necessary)|(requires?|must have) (a |an )?(master'?s|mba|advanced degree)/i.test(t) ? "Master's / MBA required" : null;
    },
  },
  {
    id: 'clearance', label: 'Citizenship or clearance', defaultMode: 'exclude',
    test: (job, brief) => {
      const t = txt(job);
      if (!brief.profile.hasClearance && /(active|current|existing|ts\/sci|top secret|secret)[^.\n]{0,20}clearance|clearance (is )?required|must (be able to )?(obtain|hold|maintain) (a |an )?(security )?clearance/i.test(t)) return 'Security clearance required';
      if (!brief.profile.usCitizen && /(u\.?s\.?|united states) citizen(ship)? (is )?(required|only)|must be a u\.?s\.? citizen/i.test(t)) return 'U.S. citizenship required';
      if (brief.profile.needsSponsorship && /(not|unable to|cannot|will not)[^.\n]{0,20}sponsor|without (the need for )?(visa )?sponsorship/i.test(t)) return 'No visa sponsorship';
      return null;
    },
  },
  {
    id: 'csOnly', label: 'CS degree only', defaultMode: 'exclude',
    test: (job, brief) => {
      if (brief.profile.hasCSDegree) return null;
      const t = txt(job);
      const m = /(degree|bs|b\.s\.|bachelor'?s)( degree)? in computer science([^.\n]{0,60})/i.exec(t);
      if (!m) return null;
      return /\bor\b|related|equivalent|similar|stem|technical field|engineering/i.test(m[3]) ? null : 'Computer Science degree required';
    },
  },
  {
    id: 'commissionOnly', label: 'Commission-only funnel', defaultMode: 'exclude',
    test: (job) => (/commission[- ]only|100% commission|straight commission|no base (salary|pay)|1099 (independent )?contractor|unlimited earning potential/i.test(txt(job)) ? 'Commission-only / 1099 sales' : null),
  },
  {
    id: 'location', label: 'Outside target locations', defaultMode: 'exclude',
    test: (job, brief) => {
      const anyPlaces = brief.locations.tiers.some((t) => t.places.length);
      if (!anyPlaces || !brief.locations.excludeOthers || !job.location) return null;
      const tier = locationTier(job, brief);
      if (tier === 'remote') return brief.locations.remote ? null : 'Remote (not wanted)';
      return tier == null ? `Outside target locations (${job.location})` : null;
    },
  },
  {
    id: 'startsEarly', label: 'Starts before graduation', defaultMode: 'flag',
    test: (job, brief) => {
      if (!brief.employment.earliestStart) return null;
      return /\b(immediate(ly)? start|start (immediately|asap)|available immediately)\b/i.test(txt(job)) ? 'Wants an immediate start' : null;
    },
  },
  {
    id: 'unpaid', label: 'Unpaid', defaultMode: 'exclude',
    test: (job) => (/\bunpaid\b|volunteer position|for (college )?credit only/i.test(txt(job)) ? 'Unpaid role' : null),
  },
  {
    id: 'blocked', label: 'Blocked company or keyword', defaultMode: 'exclude', locked: true,
    test: (job, brief) => {
      const co = normalizeKey(job.company);
      if (brief.blocked.companies.some((c) => normalizeKey(c) === co)) return `Blocked company (${job.company})`;
      const t = txt(job).toLowerCase();
      const kw = brief.blocked.keywords.find((k) => t.includes(k.toLowerCase()));
      return kw ? `Blocked keyword (“${kw}”)` : null;
    },
  },
];

export function modeFor(rule, brief) {
  if (rule.locked) return rule.defaultMode;
  return brief.exclusionModes?.[rule.id] || rule.defaultMode;
}

/** Apply every rule. Returns { excludeReason, excludeRule, flags: [{ rule, reason }] }. */
export function applyRules(job, brief) {
  const flags = [];
  for (const rule of RULES) {
    const mode = modeFor(rule, brief);
    if (mode === 'off') continue;
    const reason = rule.test(job, brief);
    if (!reason) continue;
    if (mode === 'exclude') return { excludeReason: reason, excludeRule: rule.id, flags };
    flags.push({ rule: rule.id, reason });
  }
  return { excludeReason: null, excludeRule: null, flags };
}

/** Rules that only need the listing (no network); run before verification to save requests. */
export const CHEAP_RULES = new Set(['stale', 'senior', 'years', 'masters', 'clearance', 'csOnly', 'commissionOnly', 'location', 'unpaid', 'blocked']);

export function applyCheapRules(job, brief) {
  for (const rule of RULES) {
    if (!CHEAP_RULES.has(rule.id) || modeFor(rule, brief) !== 'exclude') continue;
    const reason = rule.test(job, brief);
    if (reason) return { excludeReason: reason, excludeRule: rule.id };
  }
  return null;
}

/** Dismissal reasons a user can pick in the dashboard → the rule (or blocklist) they feed. */
export const DISMISS_REASONS = [
  { id: 'masters', label: "Master's required" },
  { id: 'clearance', label: 'Citizenship / clearance' },
  { id: 'csOnly', label: 'CS degree only' },
  { id: 'stale', label: 'Stale / ghost posting' },
  { id: 'commissionOnly', label: 'Commission-only' },
  { id: 'senior', label: 'Too senior' },
  { id: 'years', label: 'Too many years' },
  { id: 'location', label: 'Wrong location' },
  { id: 'startsEarly', label: 'Starts too early' },
  { id: 'company', label: 'Not this company' },
  { id: 'other', label: 'Just not interested' },
];
