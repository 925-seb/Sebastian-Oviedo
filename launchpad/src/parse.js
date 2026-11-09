// Extract structured signals from free-text postings.

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s?[kK]?)`;
const RANGE_RE = new RegExp(`${MONEY}\\s*(?:-|–|—|to)\\s*${MONEY}(?:\\s*(?:usd|USD))?(\\s*(?:\\/|per|an|a)\\s*(?:hr|hour|yr|year|annum|annually))?`, 'g');
const SINGLE_RE = new RegExp(`${MONEY}(\\s*(?:\\/|per|an|a)\\s*(?:hr|hour|yr|year|annum))?`, 'g');

function toNumber(raw) {
  let s = String(raw).replace(/[\s,]/g, '');
  const k = /k$/i.test(s);
  s = s.replace(/k$/i, '');
  const n = Number(s);
  return Number.isFinite(n) ? (k ? n * 1000 : n) : null;
}

function annualize(n, suffix) {
  if (n == null) return null;
  if (/hr|hour/i.test(suffix || '') || n < 200) return Math.round(n * 2080); // hourly → yearly
  return n;
}

/**
 * Returns { min, max, type: 'base'|'ote', source: 'listed'|'parsed' } or null.
 * `type` is 'ote' when the text near the number mentions OTE / on-target earnings.
 */
export function parseCompensation(job) {
  if (job.compensation && (job.compensation.min || job.compensation.max)) {
    return { ...job.compensation, source: 'listed' };
  }
  const text = job.description || '';
  // An explicit "OTE $90,000" / "on-target earnings of $85k–$95k" wins: that's what sales roles are judged on.
  const ote = new RegExp(`(?:\\bOTE\\b|on[- ]target earnings)[^$\\d\\n]{0,25}${MONEY}(?:\\s*(?:-|–|—|to)\\s*${MONEY})?`, 'i').exec(text);
  if (ote) {
    const min = toNumber(ote[1]);
    const max = toNumber(ote[2] || ote[1]);
    if (min >= 15000 && max >= min) return { min, max, type: 'ote', source: 'parsed' };
  }
  const near = (idx) => text.slice(Math.max(0, idx - 80), idx + 120);
  RANGE_RE.lastIndex = 0;
  let best = null;
  for (const m of text.matchAll(RANGE_RE)) {
    const min = annualize(toNumber(m[1]), m[3]);
    const max = annualize(toNumber(m[2]), m[3]);
    if (!min || !max || min < 15000 || max > 1_000_000 || max < min) continue;
    const type = /\bOTE\b|on[- ]target|total (target )?compensation/i.test(near(m.index)) ? 'ote' : 'base';
    if (!best || (best.type === 'ote' && type === 'base')) best = { min, max, type, source: 'parsed' };
  }
  if (best) return best;
  for (const m of text.matchAll(SINGLE_RE)) {
    const ctx = near(m.index);
    if (!/salary|base|pay|compensation|OTE|wage|hourly/i.test(ctx)) continue;
    const n = annualize(toNumber(m[1]), m[2]);
    if (!n || n < 15000 || n > 1_000_000) continue;
    return { min: n, max: n, type: /\bOTE\b|on[- ]target/i.test(ctx) ? 'ote' : 'base', source: 'parsed' };
  }
  return null;
}

/** Smallest "N+ years" requirement mentioned in the posting, or null. */
export function parseMinYears(text = '') {
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b(?:[^.\n]{0,40})?/gi;
  const found = [];
  for (const m of text.matchAll(re)) {
    const ctx = m[0];
    // must be about experience, not "2 years of college" or "a 2-year program"
    if (!/experience|exp\b|work|professional|industry|in (a|an)|selling|sales|role|related/i.test(ctx)) continue;
    if (/program|rotation|degree|college|contract|commitment|old/i.test(ctx)) continue;
    const n = Number(m[1]);
    if (n >= 0 && n <= 20) found.push(n);
  }
  return found.length ? Math.min(...found) : null;
}

export function parseEmploymentType(job) {
  const raw = `${job.employmentType || ''} ${job.title || ''}`.toLowerCase();
  if (/intern(ship)?\b|co-?op\b/.test(raw)) return 'intern';
  if (/part[- ]?time|parttime/.test(raw)) return 'part-time';
  if (/contract|temporary|temp\b|freelance|1099/.test(raw)) return 'contract';
  if (/full[- ]?time|fulltime|permanent|regular/.test(raw)) return 'full-time';
  const d = (job.description || '').toLowerCase();
  if (/this is a (paid )?internship|summer intern/.test(d)) return 'intern';
  if (/full[- ]time/.test(d)) return 'full-time';
  return null;
}

export function isRemote(job) {
  return !!job.remote || /\bremote\b|anywhere|work from home|distributed/i.test(job.location || '');
}

/** Which location tier (0-based) this job falls into, 'remote', or null. */
export function locationTier(job, brief) {
  const loc = (job.location || '').toLowerCase();
  const tiers = brief.locations.tiers || [];
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i].places.some((p) => p && loc.includes(p.toLowerCase()))) return i;
  }
  if (isRemote(job)) return 'remote';
  return null;
}

export const ENTRY_SIGNALS = /\b(new grad|new graduate|entry[- ]level|early career|junior|jr\.?|associate|graduate|university|campus|intern|apprentice|trainee|rotational|i\b|level 1|sdr|bdr|coordinator|representative)\b/i;
export const SENIOR_SIGNALS = /\b(senior|sr\.?|staff|principal|director|head of|vice president|vp|chief|lead(?! gen| generation| development)|manager,? (ii|iii)|iii|iv)\b/i;
