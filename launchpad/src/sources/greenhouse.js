// Greenhouse public job board API — the employer's own board, so postings are employer-confirmed.
// Docs: https://developers.greenhouse.io/job-board.html
import { fetchJson, htmlToText } from '../util.js';

export const meta = { id: 'greenhouse', label: 'Greenhouse boards', kind: 'ats' };

export async function search(brief) {
  const cfg = brief.sources.greenhouse;
  if (!cfg?.enabled || !cfg.boards.length) return { skipped: true, jobs: [] };
  const jobs = [];
  const errors = [];
  for (const board of cfg.boards) {
    try {
      const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`);
      for (const j of data.jobs || []) jobs.push(normalize(j, board));
    } catch (e) {
      errors.push(`${board.token}: ${e.message}`);
    }
  }
  return { jobs, errors };
}

export function normalize(j, board) {
  return {
    source: 'greenhouse',
    sourceKind: 'ats',
    externalId: String(j.id),
    company: board.name || j.company_name || board.token,
    title: j.title || '',
    location: j.location?.name || '',
    remote: /remote/i.test(j.location?.name || ''),
    url: j.absolute_url,
    postedAt: j.first_published || j.updated_at || null,
    employmentType: (j.metadata || []).find((m) => /employment|job type/i.test(m.name || ''))?.value || null,
    description: htmlToText(j.content || ''),
    compensation: null,
  };
}
