// Step 4a — verify. "Aggregators lie about dates: confirm on the employer's own career page."
import { fetchWithTimeout } from './util.js';

const CLOSED_PHRASES = /no longer (accepting applications|available|open)|position (has been|is) (filled|closed)|job (has )?(expired|closed)|this (job|posting|position) (is )?(no longer|closed)|page (you are looking for )?(could not be|can't be|cannot be) found|job not found/i;
const ATS_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|jobvite\.com|workable\.com|bamboohr\.com|recruitee\.com|taleo\.net|successfactors\.com|oraclecloud\.com)$/i;

/**
 * Returns { live: true|false|null, confirmed: bool, note }.
 * live=null means "couldn't tell" (network error, bot wall) — shown as Unconfirmed, not excluded.
 */
export async function verifyJob(job) {
  if (job.sourceKind === 'demo') {
    return job._demoLive ? { live: true, confirmed: true, note: 'Demo listing' } : { live: false, confirmed: false, note: 'Employer page says the role was filled' };
  }
  // ATS feeds are the employer's own live board: if it's in the feed, it's open.
  if (job.sourceKind === 'ats') return { live: true, confirmed: true, note: 'Listed on the employer’s own board' };
  if (!job.url) return { live: null, confirmed: false, note: 'No link to check' };
  try {
    const res = await fetchWithTimeout(job.url, { timeoutMs: 9000, redirect: 'follow', headers: { accept: 'text/html' } });
    const finalHost = safeHost(res.url);
    const confirmed = ATS_HOSTS.test(finalHost);
    if (res.status === 404 || res.status === 410) return { live: false, confirmed, note: `Link returns ${res.status}` };
    if (!res.ok) return { live: null, confirmed, note: `Link returned ${res.status}` };
    const body = (await res.text()).slice(0, 200_000);
    if (CLOSED_PHRASES.test(body)) return { live: false, confirmed, note: 'Page says the posting is closed' };
    return { live: true, confirmed, note: confirmed ? `Confirmed on ${finalHost}` : `Live on ${finalHost}` };
  } catch (e) {
    return { live: null, confirmed: false, note: `Could not load posting (${e.name === 'AbortError' ? 'timeout' : e.message})` };
  }
}

function safeHost(u) {
  try { return new URL(u).host; } catch { return ''; }
}
