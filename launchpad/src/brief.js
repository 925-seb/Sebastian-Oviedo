// Step 1 — the Brief. "Write it like a job description, except you are the candidate."
// Everything downstream (search, verify, score, exclusions) reads from this object.

/** Track presets a student can pick from (up to 4, ranked). Keywords are editable in the Brief. */
export const TRACK_PRESETS = [
  { id: 'tech-sales', label: 'Tech sales', title: ['sales development', 'business development rep', 'sdr', 'bdr', 'account executive', 'inside sales', 'sales associate', 'account development', 'customer success'], desc: ['quota', 'pipeline', 'prospecting', 'crm', 'salesforce', 'hubspot', 'cold call', 'outbound'], muse: ['Sales', 'Customer Service'], salesComp: true },
  { id: 'pm-program', label: 'PM / program', title: ['product manager', 'associate product', 'apm', 'program manager', 'project manager', 'program coordinator', 'project coordinator', 'product analyst', 'rotational'], desc: ['roadmap', 'stakeholder', 'cross-functional', 'agile', 'scrum', 'requirements', 'launch'], muse: ['Product Management', 'Project Management'] },
  { id: 'ops-supply', label: 'Ops / supply chain', title: ['operations', 'supply chain', 'logistics', 'procurement', 'planner', 'buyer', 'fulfillment', 'inventory', 'area manager', 'process improvement'], desc: ['lean', 'six sigma', 'warehouse', 'vendor', 'forecast', 'erp', 'sap', 'kpi'], muse: ['Business Operations', 'Logistics'] },
  { id: 'mis-analyst', label: 'MIS / business analyst', title: ['business analyst', 'systems analyst', 'data analyst', 'business systems', 'bi analyst', 'reporting analyst', 'it analyst', 'operations analyst', 'analyst i'], desc: ['sql', 'tableau', 'power bi', 'excel', 'requirements', 'dashboards', 'netsuite', 'erp'], muse: ['Data and Analytics', 'Data Science', 'IT'] },
  { id: 'swe', label: 'Software engineering', title: ['software engineer', 'software developer', 'frontend', 'backend', 'full stack', 'new grad engineer', 'swe'], desc: ['javascript', 'python', 'java', 'react', 'api', 'git'], muse: ['Software Engineering'] },
  { id: 'marketing', label: 'Marketing', title: ['marketing coordinator', 'marketing associate', 'growth', 'content', 'social media', 'brand', 'communications'], desc: ['campaign', 'seo', 'content', 'analytics', 'social'], muse: ['Marketing', 'Advertising and Marketing'] },
  { id: 'finance', label: 'Finance / accounting', title: ['financial analyst', 'accountant', 'fp&a', 'staff accountant', 'investment analyst', 'audit associate'], desc: ['excel', 'modeling', 'gaap', 'reconciliation', 'forecast'], muse: ['Accounting', 'Finance'] },
  { id: 'consulting', label: 'Consulting', title: ['consultant', 'consulting analyst', 'advisory associate', 'strategy analyst'], desc: ['client', 'engagement', 'strategy', 'recommendations'], muse: ['Consulting'] },
  { id: 'people', label: 'HR / people', title: ['recruiter', 'recruiting coordinator', 'hr coordinator', 'people operations', 'talent acquisition', 'learning and development', 'trainer'], desc: ['onboarding', 'hris', 'workday', 'training'], muse: ['HR and Recruitment'] },
  { id: 'design', label: 'UX / design', title: ['ux designer', 'product designer', 'ui designer', 'ux researcher', 'visual designer'], desc: ['figma', 'prototype', 'user research', 'usability'], muse: ['Design and UX'] },
];

const preset = (id) => {
  const p = TRACK_PRESETS.find((t) => t.id === id);
  return { id: p.id, label: p.label, titleKeywords: [...p.title], descKeywords: [...p.desc], museCategories: [...p.muse], salesComp: !!p.salesComp };
};

export const STATUSES = ['New', 'Interested', 'Applied', 'Interviewing', 'Offer', 'Dismissed', 'Expired'];
/** Roles in these statuses never expire, even if the posting disappears. */
export const PROTECTED_STATUSES = ['Applied', 'Interviewing', 'Offer'];

export function defaultBrief() {
  return {
    version: 1,
    completed: false,
    profile: {
      name: '',
      school: '',
      degree: 'B.S.',
      major: '',
      gradDate: '', // YYYY-MM
      yearsExperience: 1,
      experienceSummary: '',
      skills: [], // from your resume / profile, or typed in; postings that mention them get a small boost
      hasMasters: false,
      hasCSDegree: false,
      usCitizen: true,
      hasClearance: false,
      needsSponsorship: false,
    },
    tracks: ['tech-sales', 'pm-program', 'ops-supply', 'mis-analyst'].map(preset), // ranked: first = top priority
    coreIndustries: ['SaaS', 'software', 'cloud', 'supply chain', 'logistics'],
    locations: {
      tiers: [
        { label: 'Local', places: [] },
        { label: 'Commutable', places: [] },
        { label: 'Would relocate', places: [] },
      ],
      remote: true,
      excludeOthers: true, // roles outside every tier (and not remote) are excluded
    },
    compensation: { minBase: 65000, minOTE: 80000 },
    employment: { types: ['full-time'], earliestStart: '' },
    weights: { experience: 40, track: 30, comp: 20, employment: 10 },
    rules: {
      verifyLive: true,
      flagStretch: true, // show stretch roles with a reason instead of silently dropping them
      minScore: 55, // "Surface only strong or realistic fits. Do not pad the list."
      maxNewPerRun: 15,
      freshnessDays: 7,
      staleDays: 30,
      dedupeDays: 14,
      expireDays: 21,
      promoteAfter: 3, // a dismissal reason seen this many times becomes a standing rule
    },
    exclusionModes: {}, // ruleId → 'exclude' | 'flag' | 'off'  (defaults live in rules.js)
    blocked: { companies: [], keywords: [] },
    sources: {
      demo: { enabled: false },
      greenhouse: { enabled: true, boards: [] }, // [{ token, name }]
      lever: { enabled: true, boards: [] },
      ashby: { enabled: true, boards: [] },
      muse: { enabled: true, pages: 3 },
      adzuna: { enabled: false, country: 'us', where: '' }, // keys via ADZUNA_APP_ID / ADZUNA_APP_KEY
    },
    schedule: { enabled: true, time: '07:00' },
  };
}

/** Merge a (possibly partial / older) brief onto the defaults so new fields always exist. */
export function normalizeBrief(input = {}) {
  const base = defaultBrief();
  const deep = (a, b) => {
    if (Array.isArray(a) || Array.isArray(b)) return b ?? a;
    if (a && typeof a === 'object') {
      const out = { ...a };
      for (const k of Object.keys(b || {})) out[k] = deep(a[k], b[k]);
      return out;
    }
    return b === undefined ? a : b;
  };
  const brief = deep(base, input);
  brief.tracks = (brief.tracks || []).slice(0, 4).map((t) => ({
    id: String(t.id || t.label || 'custom').slice(0, 40),
    label: String(t.label || 'Custom track').slice(0, 60),
    titleKeywords: cleanList(t.titleKeywords),
    descKeywords: cleanList(t.descKeywords),
    museCategories: cleanList(t.museCategories),
    salesComp: !!t.salesComp,
  }));
  const w = brief.weights;
  for (const k of ['experience', 'track', 'comp', 'employment']) w[k] = clampNum(w[k], 0, 100, base.weights[k]);
  const r = brief.rules;
  r.minScore = clampNum(r.minScore, 0, 100, 55);
  r.maxNewPerRun = clampNum(r.maxNewPerRun, 1, 200, 15);
  for (const k of ['freshnessDays', 'staleDays', 'dedupeDays', 'expireDays', 'promoteAfter']) r[k] = clampNum(r[k], 1, 365, base.rules[k]);
  brief.profile.skills = cleanList(brief.profile.skills);
  brief.profile.yearsExperience = clampNum(brief.profile.yearsExperience, 0, 50, 0);
  brief.locations.tiers = (brief.locations.tiers || []).slice(0, 5).map((t) => ({ label: String(t.label || ''), places: cleanList(t.places) }));
  brief.coreIndustries = cleanList(brief.coreIndustries);
  brief.blocked.companies = cleanList(brief.blocked.companies);
  brief.blocked.keywords = cleanList(brief.blocked.keywords);
  for (const ats of ['greenhouse', 'lever', 'ashby']) {
    brief.sources[ats].boards = (brief.sources[ats].boards || [])
      .map((b) => (typeof b === 'string' ? { token: b, name: '' } : b))
      .filter((b) => b && /^[A-Za-z0-9._-]{1,80}$/.test(b.token || ''))
      .map((b) => ({ token: b.token, name: String(b.name || '').slice(0, 80) }));
  }
  if (!/^\d{2}:\d{2}$/.test(brief.schedule.time)) brief.schedule.time = '07:00';
  return brief;
}

function cleanList(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,\n]/);
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))].slice(0, 60);
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Months between today and graduation (negative = already graduated). */
export function monthsToGrad(brief, now = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(brief.profile.gradDate || '');
  if (!m) return null;
  return (Number(m[1]) - now.getFullYear()) * 12 + (Number(m[2]) - 1 - now.getMonth());
}
