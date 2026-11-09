// Adzuna search API — optional aggregator; needs a free key (https://developer.adzuna.com).
// Set ADZUNA_APP_ID and ADZUNA_APP_KEY in the environment.
import { fetchJson } from '../util.js';

export const meta = { id: 'adzuna', label: 'Adzuna search', kind: 'aggregator' };

export async function search(brief) {
  const cfg = brief.sources.adzuna;
  if (!cfg?.enabled) return { skipped: true, jobs: [] };
  const { ADZUNA_APP_ID: id, ADZUNA_APP_KEY: key } = process.env;
  if (!id || !key) return { jobs: [], errors: ['ADZUNA_APP_ID / ADZUNA_APP_KEY not set'] };
  const jobs = [];
  const errors = [];
  for (const track of brief.tracks) {
    const params = new URLSearchParams({
      app_id: id, app_key: key, results_per_page: '50', max_days_old: String(brief.rules.staleDays),
      what_or: track.titleKeywords.slice(0, 6).join(' '), what_exclude: 'senior director principal staff', 'content-type': 'application/json',
    });
    if (cfg.where) params.set('where', cfg.where);
    try {
      const data = await fetchJson(`https://api.adzuna.com/v1/api/jobs/${cfg.country || 'us'}/search/1?${params}`);
      for (const j of data.results || []) jobs.push(normalize(j));
    } catch (e) {
      errors.push(`${track.label}: ${e.message}`);
    }
  }
  return { jobs, errors };
}

export function normalize(j) {
  return {
    source: 'adzuna',
    sourceKind: 'aggregator',
    externalId: String(j.id),
    company: j.company?.display_name || 'Unknown company',
    title: (j.title || '').replace(/<[^>]+>/g, ''),
    location: j.location?.display_name || '',
    remote: /remote/i.test(`${j.title} ${j.location?.display_name}`),
    url: j.redirect_url,
    postedAt: j.created || null,
    employmentType: j.contract_time === 'full_time' ? 'full-time' : j.contract_time === 'part_time' ? 'part-time' : j.contract_type === 'contract' ? 'contract' : null,
    description: (j.description || '').replace(/<[^>]+>/g, ''),
    compensation: j.salary_min && j.salary_is_predicted !== '1' ? { min: j.salary_min, max: j.salary_max || j.salary_min, type: 'base' } : null,
  };
}
