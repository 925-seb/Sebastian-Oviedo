// Ashby public job board API — the employer's own board, with listed compensation.
// Docs: https://developers.ashbyhq.com/docs/public-job-posting-api
import { fetchJson } from '../util.js';

export const meta = { id: 'ashby', label: 'Ashby boards', kind: 'ats' };

export async function search(brief) {
  const cfg = brief.sources.ashby;
  if (!cfg?.enabled || !cfg.boards.length) return { skipped: true, jobs: [] };
  const jobs = [];
  const errors = [];
  for (const board of cfg.boards) {
    try {
      const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`);
      for (const j of data.jobs || []) if (j.isListed !== false) jobs.push(normalize(j, board));
    } catch (e) {
      errors.push(`${board.token}: ${e.message}`);
    }
  }
  return { jobs, errors };
}

const TYPES = { FullTime: 'full-time', PartTime: 'part-time', Intern: 'intern', Contract: 'contract', Temporary: 'contract' };

export function normalize(j, board) {
  const salary = (j.compensation?.summaryComponents || []).find((c) => c.compensationType === 'Salary' && /YEAR/i.test(c.interval || 'YEAR'));
  const ote = /\bOTE\b/i.test(j.compensation?.compensationTierSummary || '');
  return {
    source: 'ashby',
    sourceKind: 'ats',
    externalId: j.id,
    company: board.name || board.token,
    title: j.title || '',
    location: j.location || '',
    remote: !!j.isRemote,
    url: j.jobUrl || j.applyUrl,
    postedAt: j.publishedAt || null,
    employmentType: TYPES[j.employmentType] || j.employmentType || null,
    description: j.descriptionPlain || '',
    compensation: salary ? { min: salary.minValue, max: salary.maxValue || salary.minValue, type: ote ? 'ote' : 'base' } : null,
  };
}
