// Lever public postings API — the employer's own board.
// Docs: https://github.com/lever/postings-api
import { fetchJson } from '../util.js';

export const meta = { id: 'lever', label: 'Lever boards', kind: 'ats' };

export async function search(brief) {
  const cfg = brief.sources.lever;
  if (!cfg?.enabled || !cfg.boards.length) return { skipped: true, jobs: [] };
  const jobs = [];
  const errors = [];
  for (const board of cfg.boards) {
    try {
      const data = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`);
      for (const j of Array.isArray(data) ? data : []) jobs.push(normalize(j, board));
    } catch (e) {
      errors.push(`${board.token}: ${e.message}`);
    }
  }
  return { jobs, errors };
}

export function normalize(j, board) {
  const lists = (j.lists || []).map((l) => `${l.text}\n${(l.content || '').replace(/<[^>]+>/g, ' ')}`).join('\n');
  const sr = j.salaryRange;
  const yearly = (n) => (sr?.interval && /hour/i.test(sr.interval) ? n * 2080 : n);
  return {
    source: 'lever',
    sourceKind: 'ats',
    externalId: j.id,
    company: board.name || board.token,
    title: j.text || '',
    location: j.categories?.location || (j.categories?.allLocations || []).join(' / ') || '',
    remote: j.workplaceType === 'remote' || /remote/i.test(j.categories?.location || ''),
    url: j.hostedUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    employmentType: j.categories?.commitment || null,
    description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n'),
    compensation: sr && (sr.min || sr.max) ? { min: yearly(sr.min || sr.max), max: yearly(sr.max || sr.min), type: 'base' } : null,
  };
}
