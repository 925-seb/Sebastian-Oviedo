// Small helpers shared by the pipeline. No dependencies.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•' };

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** HTML (possibly entity-encoded, as Greenhouse returns it) → plain text. */
export function htmlToText(html = '') {
  let s = String(html);
  if (/&lt;[a-z/]/i.test(s)) s = decodeEntities(s); // double-encoded HTML
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function daysBetween(a, b = new Date()) {
  const t = new Date(a).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((new Date(b).getTime() - t) / 86_400_000));
}

export function normalizeKey(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Stable identity for "the same role", across sources. */
export function fingerprint(job) {
  return [normalizeKey(job.company), normalizeKey(job.title), normalizeKey((job.location || '').split(/[,;|]/)[0])].join('|');
}

/** Hash of the fields that matter: if any of these change, the role is re-evaluated. */
export function contentHash(job) {
  const s = [job.title, job.location, job.compensation?.min, job.compensation?.max, job.employmentType, (job.description || '').length].join('§');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export async function fetchWithTimeout(url, { timeoutMs = 10_000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'user-agent': 'Launchpad/1.0 (personal job search assistant)', accept: 'application/json, text/html;q=0.9', ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts) {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** Run async fn over items with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
