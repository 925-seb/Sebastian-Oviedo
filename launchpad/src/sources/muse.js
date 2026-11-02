// The Muse public API — an aggregator filtered to Entry Level + Internship. No key needed.
// Aggregator postings are verified against the live landing page before they count.
// Docs: https://www.themuse.com/developers/api/v2
import { fetchJson, htmlToText } from '../util.js';

export const meta = { id: 'muse', label: 'The Muse (entry level)', kind: 'aggregator' };

export async function search(brief) {
  const cfg = brief.sources.muse;
  if (!cfg?.enabled) return { skipped: true, jobs: [] };
  const params = new URLSearchParams();
  params.append('level', 'Entry Level');
  if (!brief.employment.types.includes('full-time') || brief.employment.types.includes('intern')) params.append('level', 'Internship');
  const cats = [...new Set(brief.tracks.flatMap((t) => t.museCategories))];
  cats.forEach((c) => params.append('category', c));
  const places = brief.locations.tiers.flatMap((t) => t.places);
  // The Muse wants "City, ST"; only send entries that look like that.
  places.filter((p) => /,\s*[A-Z]{2}$/.test(p)).forEach((p) => params.append('location', p));
  if (brief.locations.remote) params.append('location', 'Flexible / Remote');
  const jobs = [];
  const errors = [];
  for (let page = 0; page < (cfg.pages || 3); page++) {
    params.set('page', String(page));
    try {
      const data = await fetchJson(`https://www.themuse.com/api/public/jobs?${params}`);
      for (const j of data.results || []) jobs.push(normalize(j));
      if (page + 1 >= (data.page_count || 0)) break;
    } catch (e) {
      errors.push(`page ${page}: ${e.message}`);
      break;
    }
  }
  return { jobs, errors };
}

export function normalize(j) {
  const loc = (j.locations || []).map((l) => l.name).join(' / ');
  return {
    source: 'muse',
    sourceKind: 'aggregator',
    externalId: String(j.id),
    company: j.company?.name || 'Unknown company',
    title: j.name || '',
    location: loc,
    remote: /remote|flexible/i.test(loc),
    url: j.refs?.landing_page,
    postedAt: j.publication_date || null,
    employmentType: (j.levels || []).some((l) => /intern/i.test(l.name)) ? 'intern' : null,
    description: htmlToText(j.contents || ''),
    compensation: null,
  };
}
