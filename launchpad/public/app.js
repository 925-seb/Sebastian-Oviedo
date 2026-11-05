// Launchpad dashboard — vanilla JS, no build step.
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const view = $('#view');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const fmtDate = (iso, opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) => (iso ? new Date(iso).toLocaleString([], opts) : '—');
const list = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { errors: data.errors });
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

// ——— state ———
const state = {
  data: null, // /api/dashboard
  filters: loadFilters(),
  openDetails: new Set(),
};
function loadFilters() {
  try { return { q: '', track: '', fit: '', pay: '', loc: '', status: 'active', sort: 'new', ...JSON.parse(localStorage.getItem('lp.filters') || '{}') }; } catch { return { q: '', track: '', fit: '', pay: '', loc: '', status: 'active', sort: 'new' }; }
}
function saveFilters() { try { localStorage.setItem('lp.filters', JSON.stringify({ ...state.filters, q: '' })); } catch { /* private mode */ } }

async function refresh() {
  state.data = await api('/dashboard');
  renderRunBox();
  return state.data;
}

// ——— header run box ———
function renderRunBox() {
  const d = state.data;
  const last = d?.lastRun ? `Last run ${fmtDate(d.lastRun.finishedAt)}` : 'No runs yet';
  const next = d?.nextRunAt ? `Next ${fmtDate(d.nextRunAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Schedule off';
  $('#run-meta').innerHTML = `${esc(last)}<br>${esc(next)}`;
  // During the required questionnaire there is nowhere else to go yet, so hide the tabs and run box.
  document.body.classList.toggle('onboarding', !!d && !d.questionnaire?.done);
  $('#run-now').disabled = !!d?.running || !d?.questionnaire?.done;
  $('#run-now').title = d?.questionnaire?.done ? '' : 'Answer the questionnaire first';
}

$('#run-now').addEventListener('click', async () => {
  const btn = $('#run-now');
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    const r = await api('/run', { method: 'POST', body: {} });
    toast(`Run finished: ${r.counts.new} new, ${r.counts.updated} updated, ${r.counts.excluded} excluded${r.warnings.length ? ' — check run health' : ''}.`);
    await refresh();
    route();
  } catch (e) {
    toast(`Run failed: ${e.message}`);
  } finally {
    btn.textContent = 'Run now';
    btn.disabled = false;
  }
});

// ——— router ———
const views = { dashboard: renderDashboard, brief: renderBrief, memory: renderMemory, welcome: renderWelcome };
async function route() {
  const tab = (location.hash.slice(1) || 'dashboard').split('?')[0];
  const name = views[tab] ? tab : 'dashboard';
  $$('.tabs a').forEach((a) => (a.dataset.tab === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  try {
    if (!state.data || name === 'dashboard') await refresh();
    // The questionnaire is required: nothing else opens until it's answered.
    if (name !== 'welcome' && !state.data.questionnaire.done) { location.hash = 'welcome'; return; }
    await views[name]();
  } catch (e) {
    view.innerHTML = `<div class="empty"><h3>Couldn’t load Launchpad</h3><p>${esc(e.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', () => { route(); view.focus({ preventScroll: true }); });

// ═════════════ DASHBOARD ═════════════
const ACTIVE = (s) => !['Dismissed', 'Expired'].includes(s);

function filteredJobs() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let jobs = state.data.jobs.filter((j) => {
    const e = j.evaluation || {};
    if (f.status === 'active' ? !ACTIVE(j.status) : f.status && j.status !== f.status) return false;
    if (f.track && e.track !== f.track) return false;
    if (f.fit && e.fit !== f.fit) return false;
    if (f.pay === 'meets' && e.pay?.meets !== true) return false;
    if (f.pay === 'listed' && e.pay?.meets == null) return false;
    if (f.loc && String(e.locationTier) !== f.loc) return false;
    if (q && !`${j.company} ${j.title} ${j.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (f.sort === 'score') jobs = [...jobs].sort((a, b) => (b.evaluation?.total || 0) - (a.evaluation?.total || 0));
  if (f.sort === 'posted') jobs = [...jobs].sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || ''));
  return jobs;
}

function renderDashboard() {
  const d = state.data;
  const tracks = d.brief.tracks.map((t) => t.label);
  const tiers = [...d.brief.locations.tiers.map((t) => t.label).filter(Boolean), 'Remote'];
  const f = state.filters;
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  const sel = (key, label, options) => `<label class="field"><span>${label}</span><select data-filter="${key}">${options}</select></label>`;
  const run = d.lastRun;

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${d.brief.profile.name ? `${esc(d.brief.profile.name.split(' ')[0])}’s opportunities` : 'Your opportunities'}</h1>
        <p>One living dashboard, updated every run. Roles you’ve applied to never expire.</p>
      </div>
      <a class="btn" href="/api/export.csv">Export tracker (CSV)</a>
    </div>

    <section class="stats" aria-label="Summary">
      <div class="stat accent"><b>${d.stats.newToday}</b><span>New today</span></div>
      <div class="stat"><b>${d.stats.active}</b><span>Active</span></div>
      <div class="stat"><b>${d.stats.applied}</b><span>Applied</span></div>
      <div class="stat"><b>${d.stats.interviewing}</b><span>Interviewing</span></div>
    </section>

    ${run ? healthBanner(run) : ''}

    <section class="filters" aria-label="Filters">
      <label class="field search"><span>Search</span><input type="search" data-filter="q" value="${esc(f.q)}" placeholder="Company, role, or city"></label>
      <button type="button" class="btn filter-toggle" aria-expanded="false" aria-controls="filter-more">Filters</button>
      <div id="filter-more" class="filter-more">
      ${sel('track', 'Track', opt('', 'All tracks', f.track) + tracks.map((t) => opt(t, t, f.track)).join(''))}
      ${sel('fit', 'Fit', opt('', 'Any fit', f.fit) + ['Strong', 'Realistic', 'Stretch'].map((t) => opt(t, t, f.fit)).join(''))}
      ${sel('pay', 'Pay', opt('', 'Any pay', f.pay) + opt('meets', 'Meets my floor', f.pay) + opt('listed', 'Pay listed', f.pay))}
      ${sel('loc', 'Location', opt('', 'Anywhere', f.loc) + tiers.map((t) => opt(t, t, f.loc)).join(''))}
      ${sel('status', 'Status', opt('active', 'Active', f.status) + opt('', 'All', f.status) + d.meta.statuses.map((s) => opt(s, s, f.status)).join(''))}
      </div>
    </section>

    <div class="page-head" style="margin-bottom:12px">
      <p id="result-count" class="hint"></p>
      <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>Sort</span>
        <select data-filter="sort" style="width:auto">${opt('new', 'Newest first', f.sort)}${opt('score', 'Best fit', f.sort)}${opt('posted', 'Recently posted', f.sort)}</select>
      </label>
    </div>
    <section id="cards" class="grid" aria-label="Roles"></section>

    ${run ? excludedPanel(run) : ''}
  `;

  $$('[data-filter]', view).forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
    state.filters[el.dataset.filter] = el.value;
    saveFilters();
    renderCards();
    updateFilterToggle();
  }));
  $('.filter-toggle', view).addEventListener('click', (e) => {
    const open = $('.filters', view).classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  updateFilterToggle();
  bindCards($('#cards'));
  renderCards();
}

// Phone layout folds the filter dropdowns behind one button; its label counts the ones in use.
function updateFilterToggle() {
  const btn = $('.filter-toggle', view);
  if (!btn) return;
  const f = state.filters;
  const n = ['track', 'fit', 'pay', 'loc'].filter((k) => f[k]).length + (f.status !== 'active' ? 1 : 0);
  btn.textContent = n ? `Filters (${n})` : 'Filters';
}

function healthBanner(run) {
  const failed = run.health.filter((h) => !h.ok);
  const title = run.status === 'ok' ? 'Run health: all good' : run.status === 'failed' ? 'Run health: this morning’s run failed' : 'Run health: something broke this morning';
  const sources = run.health.map((h) => `${h.source} ${h.ok ? `✓ ${h.count}` : '✕'}`).join(' · ');
  return `<section class="health ${esc(run.status)}" aria-label="Run health">
    <div>
      <h3>${esc(title)}</h3>
      <p class="hint">${esc(fmtDate(run.finishedAt))} · ${run.counts.new} new · ${run.counts.updated} updated · ${run.counts.alreadySeen} already seen · ${run.counts.excluded} excluded${run.counts.overCap ? ` · ${run.counts.overCap} held for tomorrow` : ''}</p>
      ${run.warnings.length ? `<ul>${run.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${failed.length ? `<ul>${failed.flatMap((h) => h.errors.slice(0, 3).map((e) => `<li><b>${esc(h.source)}:</b> ${esc(e)}</li>`)).join('')}</ul>` : ''}
      <p class="hint" style="margin-top:4px">Sources: ${esc(sources || 'none enabled')}</p>
    </div>
  </section>`;
}

function excludedPanel(run) {
  const groups = {};
  for (const e of run.excluded || []) (groups[e.reason.replace(/\s*\(.*\)$/, '')] ||= []).push(e);
  const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  return `<details class="excluded">
    <summary>Excluded today <span class="badge">${(run.excluded || []).length}</span><span class="hint" style="font:400 13px var(--text)">Double-check what the run threw out — each with its reason.</span></summary>
    <div class="body">
      ${entries.length ? entries.map(([reason, items]) => `<div class="reason-group"><h4>${esc(reason)} · ${items.length}</h4><ul>${items.slice(0, 25).map((e) => `<li><a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.company)} — ${esc(e.title)}</a>${e.location ? ` <span class="hint">${esc(e.location)}</span>` : ''}${(() => { const d = e.reason.match(/\((.*)\)$/)?.[1]; return d && d !== e.location ? ` <span class="hint">(${esc(d)})</span>` : ''; })()}</li>`).join('')}${items.length > 25 ? `<li class="hint">…and ${items.length - 25} more</li>` : ''}</ul></div>`).join('') : '<p class="hint">Nothing excluded on the last run.</p>'}
    </div>
  </details>`;
}

function renderCards() {
  const jobs = filteredJobs();
  const box = $('#cards');
  closeMenus();
  $('#result-count').textContent = `${jobs.length} role${jobs.length === 1 ? '' : 's'}`;
  if (!state.data.jobs.length) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>No roles yet</h3><p>${state.data.lastRun ? 'The last run didn’t surface anything that met your brief. Check “Excluded today” and run health below.' : 'Run your first search — it takes a minute.'}</p><button class="btn btn-accent" type="button" onclick="document.getElementById('run-now').click()">Run now</button></div>`;
    return;
  }
  if (!jobs.length) {
    box.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Nothing matches these filters</h3><p>Try widening fit, pay, or status.</p></div>';
    return;
  }
  box.innerHTML = jobs.map(card).join('');
}

function card(j) {
  const e = j.evaluation || {};
  const st = state.data.meta.statuses;
  const badges = [
    e.fit && `<span class="badge fit-${esc(e.fit)}">${esc(e.fit)}</span>`,
    e.track && `<span class="badge trk">${esc(e.track)}</span>`,
    e.pay?.label && `<span class="badge ${e.pay.meets === true ? 'pay-ok' : e.pay.meets === false ? 'pay-low' : ''}">${esc(e.pay.label)}</span>`,
    e.employmentType && `<span class="badge">${esc(e.employmentType.replace(/^./, (c) => c.toUpperCase()))}</span>`,
    e.locationTier && `<span class="badge">${esc(e.locationTier)}</span>`,
    j.ageDays != null && `<span class="badge ${e.fresh ? 'fresh' : ''}">${j.ageDays === 0 ? 'Posted today' : `${j.ageDays}d old`}</span>`,
    j.verification?.confirmed ? '<span class="badge confirmed" title="Confirmed on the employer’s own site">✓ Employer site</span>' : j.verification?.live == null ? `<span class="badge unconfirmed" title="${esc(j.verification?.note || '')}">Unconfirmed</span>` : '',
  ].filter(Boolean).join('');
  const open = state.openDetails.has(j.id);
  const parts = e.parts || {};
  const partLabel = { experience: 'Experience fit', track: 'Track', comp: 'Compensation', employment: 'Employment type' };
  return `<article class="card fit-${esc(e.fit)} st-${esc(j.status)}" data-id="${esc(j.id)}">
    <div class="card-head">
      <div>
        <h3>${esc(j.company)}</h3>
        <p class="role">${esc(j.title)}${j.location ? ` · ${esc(j.location)}` : ''}</p>
      </div>
      <div class="score" title="Weighted fit score"><b>${e.total ?? '–'}</b><span>fit</span></div>
    </div>
    <div class="badges">${badges}</div>
    ${e.skillsMatched?.length ? `<p class="skills-hit">Matches your skills: ${e.skillsMatched.slice(0, 5).map(esc).join(', ')}</p>` : ''}
    ${(j.flags || []).length ? `<ul class="flags">${j.flags.map((f) => `<li>${esc(f.reason)}</li>`).join('')}</ul>` : ''}
    ${j.status === 'Dismissed' && j.dismissReason ? `<p class="hint">Dismissed: ${esc(j.dismissReason)}</p>` : ''}
    ${open ? `<div class="details">
      <div class="bars">${Object.entries(parts).map(([k, p]) => `<span>${partLabel[k]} <span class="hint">${p.weight}%</span></span><span class="bar"><i style="width:${Math.round(p.score * 100)}%"></i></span><span>${Math.round(p.score * 100)}</span>`).join('')}</div>
      ${j.snippet ? `<p class="snippet">${esc(j.snippet)}${j.snippet.length >= 320 ? '…' : ''}</p>` : ''}
      <p class="hint">${esc(j.verification?.note || '')} · First seen ${esc(fmtDate(j.firstSeen, { month: 'short', day: 'numeric' }))}</p>
      <label class="field"><span>Notes</span><textarea data-notes rows="2" placeholder="Referral, recruiter name, next step…">${esc(j.notes)}</textarea></label>
    </div>` : ''}
    <div class="card-foot">
      <label class="sr-only" for="st-${esc(j.id)}">Status</label>
      <select id="st-${esc(j.id)}" data-status class="status-${esc(j.status)}">${st.filter((s) => s !== 'Dismissed' || j.status === 'Dismissed').map((s) => `<option ${s === j.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" type="button" data-toggle aria-expanded="${open}" title="Why this score">${open ? 'Less' : 'Details'}</button>
      <span class="spacer"></span>
      ${ACTIVE(j.status) ? `<div class="menu"><button class="btn btn-ghost btn-sm" type="button" data-dismiss aria-haspopup="true">Dismiss</button></div>` : ''}
      <a class="btn btn-sm" href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">View posting ↗</a>
    </div>
  </article>`;
}

function bindCards(box) {
  box.onchange = async (ev) => {
    const cardEl = ev.target.closest('.card');
    if (!cardEl || !ev.target.matches('[data-status]')) return;
    const id = cardEl.dataset.id;
    try {
      const job = await api(`/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: ev.target.value } });
      patchLocal(job);
      toast(`${job.company}: ${job.status}`);
    } catch (e) { toast(e.message); }
  };
  box.onclick = async (ev) => {
    const cardEl = ev.target.closest('.card');
    if (!cardEl) return;
    const id = cardEl.dataset.id;
    if (ev.target.closest('[data-toggle]')) {
      state.openDetails.has(id) ? state.openDetails.delete(id) : state.openDetails.add(id);
      renderCards();
    } else if (ev.target.closest('[data-dismiss]')) {
      openDismissMenu(ev.target.closest('.menu'));
    } else if (ev.target.closest('[data-reason]')) {
      const reason = ev.target.closest('[data-reason]').dataset.reason;
      try {
        const { job, promoted } = await api(`/jobs/${encodeURIComponent(id)}/dismiss`, { method: 'POST', body: { reason } });
        patchLocal(job);
        toast(promoted ? `${promoted.label} — the next run will exclude these automatically.` : `Dismissed ${job.company}. Reason logged.`);
        if (promoted) await refresh();
      } catch (e) { toast(e.message); }
    }
  };
  box.addEventListener('focusout', async (ev) => {
    if (!ev.target.matches('[data-notes]')) return;
    const id = ev.target.closest('.card').dataset.id;
    const job = state.data.jobs.find((j) => j.id === id);
    if (!job || job.notes === ev.target.value) return;
    try { patchLocal(await api(`/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', body: { notes: ev.target.value } }), false); toast('Notes saved'); } catch (e) { toast(e.message); }
  });
}

let menuCleanup = null;
function closeMenus() {
  $$('.menu-list').forEach((m) => m.remove());
  menuCleanup?.();
  menuCleanup = null;
}

function openDismissMenu(menu) {
  closeMenus();
  const el = document.createElement('div');
  el.className = 'menu-list';
  el.setAttribute('role', 'menu');
  el.innerHTML = `<p>Why? Repeat reasons become standing rules.</p>${state.data.meta.dismissReasons.map((r) => `<button type="button" role="menuitem" data-reason="${esc(r.id)}">${esc(r.label)}</button>`).join('')}`;
  menu.append(el);
  el.querySelector('button').focus();
  const onDoc = (ev) => { if (ev.type === 'keydown' ? ev.key === 'Escape' : !el.contains(ev.target)) closeMenus(); };
  setTimeout(() => {
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onDoc, true);
  });
  menuCleanup = () => {
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onDoc, true);
  };
}

function patchLocal(job, rerender = true) {
  const i = state.data.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) state.data.jobs[i] = { ...state.data.jobs[i], ...job, description: undefined };
  const all = state.data.jobs;
  state.data.stats.active = all.filter((j) => ACTIVE(j.status)).length;
  state.data.stats.applied = all.filter((j) => ['Applied', 'Interviewing', 'Offer'].includes(j.status)).length;
  state.data.stats.interviewing = all.filter((j) => ['Interviewing', 'Offer'].includes(j.status)).length;
  if (!rerender) return;
  const strip = $$('.stat b');
  if (strip.length === 4) { strip[1].textContent = state.data.stats.active; strip[2].textContent = state.data.stats.applied; strip[3].textContent = state.data.stats.interviewing; }
  renderCards();
}

// ═════════════ BRIEF ═════════════
let draft = null;

async function renderBrief(override = null) {
  if (state.resume === undefined) state.resume = await api('/resume').catch(() => null);
  draft = structuredClone(override || state.data.brief);
  const b = draft;
  const p = b.profile;
  const presets = state.data.meta.trackPresets;
  const boards = (k) => b.sources[k].boards.map((x) => (x.name ? `${x.token} | ${x.name}` : x.token)).join('\n');
  view.innerHTML = `
    ${b.completed ? '' : `<section class="intro"><h2>Step 1: write your brief like a job description</h2><p>Except you’re the candidate. Be honest about your experience and specific about what you want. Every daily run reads this before it searches, and every role gets scored against it.</p></section>`}
    <div class="page-head"><div><h1>Your brief</h1><p>Who you are, what you want, where, and the rules.</p></div></div>
    ${b.questionnaire ? `<p class="hint q-done">Questionnaire answered ${esc(fmtDate(b.questionnaire.completedAt, { month: 'short', day: 'numeric', year: 'numeric' }))} · <a href="#welcome">Retake it</a></p>` : ''}
    ${resumeSection()}
    ${override ? '<p class="unsaved" role="status">Resume details applied below — review them, then <b>Save brief</b>.</p>' : ''}
    <form id="brief-form" class="brief-layout" novalidate>
      <div>
        <section class="panel">
          <h2>Who I am</h2>
          <div class="row">
            <label class="field"><span>Name</span><input type="text" name="profile.name" value="${esc(p.name)}" autocomplete="name"></label>
            <label class="field"><span>School</span><input type="text" name="profile.school" value="${esc(p.school)}"></label>
          </div>
          <div class="row">
            <label class="field"><span>Degree</span><input type="text" name="profile.degree" value="${esc(p.degree)}" placeholder="B.S."></label>
            <label class="field"><span>Major / concentration</span><input type="text" name="profile.major" value="${esc(p.major)}" placeholder="Business Administration, MIS"></label>
            <label class="field"><span>Graduation</span><input type="month" name="profile.gradDate" value="${esc(p.gradDate)}"></label>
            <label class="field"><span>Years of relevant experience</span><input type="number" min="0" max="50" step="0.5" name="profile.yearsExperience" value="${esc(p.yearsExperience)}"></label>
          </div>
          <label class="field"><span>Real experience to match against</span><textarea name="profile.experienceSummary" rows="3" placeholder="Jobs, internships, leadership — what you actually did.">${esc(p.experienceSummary)}</textarea></label>
          <label class="field"><span>Skills</span><input type="text" name="profile.skills" value="${esc((p.skills || []).join(', '))}" placeholder="SQL, Excel, Salesforce, Spanish"><small>Postings that ask for two or more of these get a boost on track alignment.</small></label>
          <div class="row">
            ${check('profile.hasMasters', p.hasMasters, 'I have a Master’s / MBA')}
            ${check('profile.hasCSDegree', p.hasCSDegree, 'My degree is in Computer Science')}
            ${check('profile.usCitizen', p.usCitizen, 'I’m a U.S. citizen')}
            ${check('profile.hasClearance', p.hasClearance, 'I hold a security clearance')}
            ${check('profile.needsSponsorship', p.needsSponsorship, 'I’ll need visa sponsorship')}
          </div>
        </section>

        <section class="panel">
          <h2>What I want <small>Up to four tracks, in priority order</small></h2>
          <div id="tracks" style="display:flex;flex-direction:column;gap:10px"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <select id="add-track" style="width:auto"><option value="">+ Add a track…</option>${presets.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}<option value="__custom">Custom track</option></select>
          </div>
          <label class="field"><span>Core industries (bonus points)</span><input type="text" name="coreIndustries" value="${esc(b.coreIndustries.join(', '))}" placeholder="SaaS, logistics, healthcare"></label>
          <div class="row">
            <fieldset class="field" style="border:0;padding:0;margin:0"><span>Employment types I want</span>
              ${['full-time', 'intern', 'part-time', 'contract'].map((t) => `<label class="check"><input type="checkbox" data-emp value="${t}" ${b.employment.types.includes(t) ? 'checked' : ''}> ${t[0].toUpperCase() + t.slice(1)}</label>`).join('')}
            </fieldset>
            <label class="field"><span>Earliest start</span><input type="month" name="employment.earliestStart" value="${esc(b.employment.earliestStart)}"><small>Roles wanting an immediate start get flagged.</small></label>
          </div>
        </section>

        <section class="panel">
          <h2>Where <small>Comma-separated cities or regions</small></h2>
          ${b.locations.tiers.map((t, i) => `<div class="row" style="grid-template-columns:180px 1fr">
            <label class="field"><span>Tier ${i + 1} name</span><input type="text" data-tier-label="${i}" value="${esc(t.label)}"></label>
            <label class="field"><span>Places</span><input type="text" data-tier-places="${i}" value="${esc(t.places.join(', '))}" placeholder="${i === 0 ? 'Tracy, Manteca, Stockton' : i === 1 ? 'Sacramento, San Jose, CA' : 'San Francisco, Seattle, WA'}"></label>
          </div>`).join('')}
          <div class="row">
            ${check('locations.remote', b.locations.remote, 'Open to remote')}
            ${check('locations.excludeOthers', b.locations.excludeOthers, 'Exclude roles outside these places')}
          </div>
        </section>

        <section class="panel">
          <h2>Pay</h2>
          <div class="row">
            <label class="field"><span>Minimum base salary</span><input type="number" min="0" step="1000" name="compensation.minBase" value="${esc(b.compensation.minBase)}"></label>
            <label class="field"><span>Minimum OTE (sales roles)</span><input type="number" min="0" step="1000" name="compensation.minOTE" value="${esc(b.compensation.minOTE)}"><small>On-target earnings: base + expected commission.</small></label>
          </div>
        </section>

        <section class="panel">
          <h2>The rules</h2>
          <div class="row">
            ${check('rules.verifyLive', b.rules.verifyLive, 'Verify every posting is live before it counts')}
            ${check('rules.flagStretch', b.rules.flagStretch, 'Flag stretch roles with the reason instead of hiding them')}
          </div>
          <div class="row">
            <label class="field"><span>Minimum fit score to show</span><input type="number" min="0" max="100" name="rules.minScore" value="${esc(b.rules.minScore)}"></label>
            <label class="field"><span>Max new roles per run</span><input type="number" min="1" max="200" name="rules.maxNewPerRun" value="${esc(b.rules.maxNewPerRun)}"></label>
            <label class="field"><span>“Fresh” means posted within (days)</span><input type="number" min="1" name="rules.freshnessDays" value="${esc(b.rules.freshnessDays)}"></label>
            <label class="field"><span>Stale after (days)</span><input type="number" min="1" name="rules.staleDays" value="${esc(b.rules.staleDays)}"></label>
            <label class="field"><span>Don’t repeat roles seen within (days)</span><input type="number" min="1" name="rules.dedupeDays" value="${esc(b.rules.dedupeDays)}"></label>
            <label class="field"><span>Expire untouched roles after (days)</span><input type="number" min="1" name="rules.expireDays" value="${esc(b.rules.expireDays)}"></label>
          </div>
          <label class="field"><span>Never show these companies</span><input type="text" name="blocked.companies" value="${esc(b.blocked.companies.join(', '))}"></label>
          <label class="field"><span>Never show roles mentioning</span><input type="text" name="blocked.keywords" value="${esc(b.blocked.keywords.join(', '))}" placeholder="door-to-door, relocation required"></label>
          <p class="hint">Exclusion rules (Master’s required, clearance, CS-only, commission-only…) are on the <a href="#memory">Memory</a> tab.</p>
        </section>

        <section class="panel">
          <h2>Where to search</h2>
          <p class="hint">Employer boards are the most reliable: they come straight from the company’s own careers page. Find the board name in the URL — e.g. <code>boards.greenhouse.io/<b>acme</b></code>, <code>jobs.lever.co/<b>acme</b></code>, <code>jobs.ashbyhq.com/<b>acme</b></code>. One per line, optionally <code>token | Company name</code>.</p>
          <div class="row">
            <label class="field"><span>Greenhouse boards</span><textarea data-boards="greenhouse" rows="4" placeholder="acme | Acme Corp">${esc(boards('greenhouse'))}</textarea></label>
            <label class="field"><span>Lever boards</span><textarea data-boards="lever" rows="4">${esc(boards('lever'))}</textarea></label>
            <label class="field"><span>Ashby boards</span><textarea data-boards="ashby" rows="4">${esc(boards('ashby'))}</textarea></label>
          </div>
          <div class="row">
            ${check('sources.muse.enabled', b.sources.muse.enabled, 'The Muse — entry-level listings (no key needed)')}
            ${check('sources.adzuna.enabled', b.sources.adzuna.enabled, 'Adzuna search (needs ADZUNA_APP_ID / ADZUNA_APP_KEY)')}
            ${check('sources.demo.enabled', b.sources.demo.enabled, 'Demo listings (offline sample data)')}
          </div>
        </section>

        <section class="panel">
          <h2>Refresh rate</h2>
          <div class="row">
            <label class="field"><span>Automated refresh</span><select name="schedule.frequency">${FREQ.map(([v, l]) => `<option value="${v}" ${b.schedule.frequency === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Day (weekly)</span><select name="schedule.day">${DAY_NAMES.map((d, i) => `<option value="${i}" ${Number(b.schedule.day) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
            <label class="field"><span>Time (server’s local time)</span><input type="time" name="schedule.time" value="${esc(b.schedule.time)}"></label>
          </div>
        </section>
      </div>

      <aside class="rule1" aria-label="Rule number one and score weights">
        <span class="eyebrow">RULE #1</span>
        <p class="big">Surface only strong or realistic fits. Do not pad the list.</p>
        <p style="color:var(--on-dark-2)">Score every role the same way. Your weights should be yours — if pay matters most, put it first.</p>
        ${weight('experience', 'Experience fit', b.weights.experience)}
        ${weight('track', 'Track alignment', b.weights.track)}
        ${weight('comp', 'Compensation', b.weights.comp)}
        ${weight('employment', 'Employment type', b.weights.employment)}
        <p class="weights-sum" id="weights-sum"></p>
      </aside>

      <div class="savebar" style="grid-column:1/-1">
        <button class="btn" type="button" id="brief-reset">Discard changes</button>
        <button class="btn btn-dark" type="submit">${b.completed ? 'Save brief' : 'Save brief & run first search'}</button>
      </div>
    </form>`;

  renderTracks();
  updateWeightSum();
  const form = $('#brief-form');
  $$('input[type=range]', form).forEach((r) => r.addEventListener('input', () => { r.nextElementSibling.value = `${r.value}%`; updateWeightSum(); }));
  $('#add-track').addEventListener('change', (ev) => {
    const id = ev.target.value;
    ev.target.value = '';
    if (!id) return;
    collectTracks();
    if (draft.tracks.length >= 4) { toast('Four tracks max — remove one first.'); return; }
    const p = presets.find((t) => t.id === id);
    draft.tracks.push(p ? { id: p.id, label: p.label, titleKeywords: [...p.title], descKeywords: [...p.desc], museCategories: [...p.muse], salesComp: !!p.salesComp } : { id: `custom-${Date.now().toString(36)}`, label: 'Custom track', titleKeywords: [], descKeywords: [], museCategories: [], salesComp: false });
    renderTracks();
  });
  $('#brief-reset').addEventListener('click', () => renderBrief());
  bindResume();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const firstTime = !state.data.brief.completed;
    const brief = collectBrief(form);
    if (!brief.tracks.length) { toast('Add at least one track.'); return; }
    brief.completed = true;
    try {
      state.data.brief = await api('/brief', { method: 'PUT', body: brief });
      toast('Brief saved. The next run will use it.');
      await refresh();
      if (firstTime) { location.hash = 'dashboard'; $('#run-now').click(); } else renderBrief();
    } catch (e) { toast(e.message); }
  });
}

const FREQ = [['daily', 'Daily'], ['weekdays', 'Every weekday'], ['twice-weekly', 'Twice a week (Mon & Thu)'], ['weekly', 'Weekly'], ['manual', 'Manual only']];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ═════════════ QUESTIONNAIRE ═════════════
// Rendered from the server's fixed definition (src/questionnaire.js). Required before anything else.
const q = { step: 0, answers: null, errors: {} };

const shown = (question, answers) => !question.showIf || Object.entries(question.showIf).every(([k, vals]) => vals.includes(answers[k]));

function stepErrors(step, answers) {
  const errors = {};
  for (const question of step.questions) {
    if (!shown(question, answers)) continue;
    const v = answers[question.id];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (question.required && empty) errors[question.id] = 'Please answer this one.';
    else if (Array.isArray(v) && question.min && v.length < question.min) errors[question.id] = `Pick at least ${question.min}.`;
  }
  if (step.id === 'timeline' && answers.status === 'graduated' && answers.gradDate > new Date().toISOString().slice(0, 7)) errors.gradDate = 'You said you’ve graduated — pick a past month.';
  return errors;
}

function renderWelcome() {
  const Q = state.data.questionnaire;
  if (!q.answers) q.answers = structuredClone(Q.answers);
  const steps = Q.steps;
  const review = q.step >= steps.length;
  const firstTime = !Q.done;
  view.innerHTML = `
    <div class="wizard">
      <aside class="wizard-steps" aria-label="Questionnaire progress">
        <p class="eyebrow">${firstTime ? 'Welcome to Launchpad' : 'Retake the questionnaire'}</p>
        <ol>${[...steps, { id: 'review', title: 'Review & start' }].map((s, i) => `<li class="${i === q.step ? 'current' : i < q.step ? 'done' : ''}" ${i === q.step ? 'aria-current="step"' : ''}><span>${i < q.step ? '✓' : i + 1}</span>${esc(s.title)}</li>`).join('')}</ol>
        <p class="hint">Takes about two minutes. Your answers become your Brief, and you can fine-tune it any time.</p>
      </aside>
      <section class="wizard-card" aria-labelledby="q-title">
        ${review ? reviewStep(steps) : questionStep(steps[q.step])}
      </section>
    </div>`;
  bindWelcome(steps);
  $('#q-title')?.focus();
}

function questionStep(step) {
  const a = q.answers;
  const err = (id) => (q.errors[id] ? `<p class="q-error" id="err-${id}">${esc(q.errors[id])}</p>` : '');
  const desc = (id) => (q.errors[id] ? `aria-describedby="err-${id}" aria-invalid="true"` : '');
  const body = step.questions.filter((x) => shown(x, a)).map((x) => {
    const v = a[x.id];
    const lbl = `${esc(x.label)}${x.required ? '' : ''}`;
    if (x.type === 'radio') {
      return `<fieldset class="q" ${desc(x.id)}><legend>${lbl}</legend><div class="opts ${x.options.length > 4 ? 'opts-grid' : ''}">${x.options.map((o) => `<label class="opt"><input type="radio" name="${x.id}" value="${esc(o.value)}" ${String(v) === o.value ? 'checked' : ''}><span><b>${esc(o.label)}</b>${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span></label>`).join('')}</div>${err(x.id)}</fieldset>`;
    }
    if (x.type === 'checks' || x.type === 'rank') {
      const sel = Array.isArray(v) ? v : [];
      return `<fieldset class="q" ${desc(x.id)}><legend>${lbl}${x.type === 'rank' ? ` <small class="hint">${sel.length}/${x.max} picked, in the order you click</small>` : ''}</legend><div class="chips-pick">${x.options.map((o) => {
        const i = sel.indexOf(o.value);
        return `<button type="button" class="pick ${i >= 0 ? 'on' : ''}" data-pick="${x.id}" data-value="${esc(o.value)}" aria-pressed="${i >= 0}">${x.type === 'rank' && i >= 0 ? `<span class="rank-n">${i + 1}</span>` : ''}${esc(o.label)}</button>`;
      }).join('')}</div>${err(x.id)}</fieldset>`;
    }
    if (x.type === 'select') {
      return `<label class="field q"><span>${lbl}</span><select data-q="${x.id}" ${desc(x.id)}><option value="">Choose…</option>${x.options.map((o) => `<option value="${esc(o.value)}" ${String(v) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${err(x.id)}</label>`;
    }
    const input = x.type === 'textarea'
      ? `<textarea data-q="${x.id}" rows="3" placeholder="${esc(x.placeholder || '')}" ${desc(x.id)}>${esc(v || '')}</textarea>`
      : `<input type="${x.type}" data-q="${x.id}" value="${esc(v || '')}" placeholder="${esc(x.placeholder || '')}" ${desc(x.id)}>`;
    return `<label class="field q"><span>${lbl}</span>${input}${err(x.id)}</label>`;
  }).join('');
  return `<h1 id="q-title" tabindex="-1">${esc(step.title)}</h1><p class="q-intro">${esc(step.intro)}</p>
    <form id="q-form" novalidate>${body}
      <div class="q-nav">
        ${q.step > 0 ? '<button class="btn" type="button" id="q-back">Back</button>' : '<span></span>'}
        <button class="btn btn-dark" type="submit">Next</button>
      </div>
    </form>`;
}

function reviewStep(steps) {
  const a = q.answers;
  const show = (x) => {
    const v = a[x.id];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '<span class="hint">—</span>';
    const label = (val) => x.options?.find((o) => o.value === String(val))?.label || val;
    if (Array.isArray(v)) return esc(v.map(label).join(x.type === 'rank' ? ' → ' : ', '));
    if (x.type === 'month') return esc(new Date(`${v}-15`).toLocaleDateString([], { month: 'long', year: 'numeric' }));
    return esc(label(v));
  };
  return `<h1 id="q-title" tabindex="-1">Review & start</h1><p class="q-intro">This becomes your Brief. Every refresh scores roles against it.</p>
    ${steps.map((s, i) => `<div class="q-review"><div class="q-review-head"><h2>${esc(s.title)}</h2><button class="btn btn-ghost btn-sm" type="button" data-goto="${i}">Edit</button></div>
      <dl>${s.questions.filter((x) => shown(x, a)).map((x) => `<dt>${esc(x.label)}</dt><dd>${show(x)}</dd>`).join('')}</dl></div>`).join('')}
    ${q.serverError ? `<p class="q-error">${esc(q.serverError)}</p>` : ''}
    <div class="q-nav"><button class="btn" type="button" id="q-back">Back</button><button class="btn btn-accent" type="button" id="q-finish">${state.data.questionnaire.done ? 'Save answers' : 'Finish & start searching'}</button></div>`;
}

function bindWelcome(steps) {
  const form = $('#q-form');
  const step = steps[q.step];
  const refreshStep = () => { renderWelcome(); };
  if (form) {
    form.addEventListener('input', (ev) => {
      const el = ev.target;
      if (el.dataset.q) q.answers[el.dataset.q] = el.value;
      if (el.type === 'radio') { q.answers[el.name] = el.value; delete q.errors[el.name]; if (step.questions.some((x) => x.showIf && el.name in x.showIf)) { refreshStep(); $(`input[name="${el.name}"]:checked`)?.focus(); } }
    });
    form.addEventListener('change', (ev) => { if (ev.target.tagName === 'SELECT') q.answers[ev.target.dataset.q] = ev.target.value; });
    form.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pick]');
      if (!b) return;
      const x = step.questions.find((y) => y.id === b.dataset.pick);
      const cur = Array.isArray(q.answers[x.id]) ? [...q.answers[x.id]] : [];
      const i = cur.indexOf(b.dataset.value);
      if (i >= 0) cur.splice(i, 1);
      else if (x.max && cur.length >= x.max) { toast(`Up to ${x.max} — unpick one first.`); return; }
      else cur.push(b.dataset.value);
      q.answers[x.id] = cur;
      delete q.errors[x.id];
      refreshStep();
      $(`[data-pick="${x.id}"][data-value="${CSS.escape(b.dataset.value)}"]`)?.focus();
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      q.errors = stepErrors(step, q.answers);
      if (Object.keys(q.errors).length) { renderWelcome(); $('.q-error')?.closest('.q')?.querySelector('input,select,textarea,button')?.focus(); return; }
      q.step++;
      renderWelcome();
    });
  }
  $('#q-back')?.addEventListener('click', () => { q.errors = {}; q.serverError = null; q.step = Math.max(0, q.step - 1); renderWelcome(); });
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => { q.step = Number(b.dataset.goto); renderWelcome(); }));
  $('#q-finish')?.addEventListener('click', async (ev) => {
    const firstTime = !state.data.questionnaire.done;
    ev.target.disabled = true;
    try {
      await api('/questionnaire', { method: 'POST', body: q.answers });
      q.answers = null; q.step = 0; q.errors = {}; q.serverError = null;
      await refresh();
      if (firstTime) { location.hash = 'dashboard'; $('#run-now').click(); toast('You’re set. Running your first search…'); }
      else { location.hash = 'brief'; toast('Answers saved to your Brief.'); }
    } catch (e) {
      q.serverError = e.message;
      if (e.errors) {
        const idx = state.data.questionnaire.steps.findIndex((s) => s.questions.some((x) => e.errors[x.id]));
        if (idx >= 0) { q.step = idx; q.errors = e.errors; q.serverError = null; }
      }
      ev.target.disabled = false;
      renderWelcome();
    }
  });
}

// ——— Resume / profile drag & drop ———
const RESUME_TYPES = /\.(pdf|docx|txt|md)$/i;
const MAX_RESUME = 5 * 1024 * 1024;

function resumeSection() {
  const r = state.resume;
  return `<section class="drop ${r ? 'compact' : ''}" id="drop" tabindex="0" role="button" aria-describedby="drop-hint" aria-label="Upload your resume or LinkedIn profile: drop a file here or press Enter to choose one">
      <input type="file" id="resume-file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden>
      <svg class="drop-icon" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="9" y="4" width="30" height="40" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M16 15h16M16 21h16M16 27h9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="35" cy="36" r="9" fill="var(--orange)"/><path d="M35 41v-9m-4 4 4-4 4 4" stroke="var(--navy)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="drop-text">
        ${r ? `<h2>${esc(r.fileName)} <span class="hint">· read ${esc(fmtDate(r.uploadedAt, { month: 'short', day: 'numeric' }))}</span></h2>
          <p id="drop-hint">Drop a newer resume or LinkedIn profile here to update your brief.</p>`
        : `<h2>Start from your resume or LinkedIn profile</h2>
          <p id="drop-hint">Drag and drop a PDF, DOCX or TXT (up to 5 MB). It’s read on your own Launchpad server and never sent anywhere else. On LinkedIn: your profile → <b>More</b> → <b>Save to PDF</b>.</p>`}
      </div>
      <div class="drop-actions">
        <button class="btn btn-dark btn-sm" type="button" id="pick-file">${r ? 'Replace' : 'Choose file'}</button>
        ${r ? '<button class="btn btn-sm" type="button" id="review-resume">Review suggestions</button><button class="btn btn-ghost btn-sm" type="button" id="remove-resume">Remove</button>' : '<button class="btn btn-ghost btn-sm" type="button" id="paste-toggle">Paste text instead</button>'}
      </div>
      <div class="drop-overlay" aria-hidden="true">Drop to read it</div>
    </section>
    <div id="paste-box" class="panel" hidden>
      <label class="field"><span>Paste your resume or profile text</span><textarea id="paste-text" rows="8"></textarea></label>
      <div><button class="btn btn-dark btn-sm" type="button" id="paste-read">Read it</button></div>
    </div>
    <div id="resume-review"></div>`;
}

function bindResume() {
  const drop = $('#drop');
  const input = $('#resume-file');
  const pick = () => input.click();
  $('#pick-file').addEventListener('click', (ev) => { ev.stopPropagation(); pick(); });
  drop.addEventListener('click', (ev) => { if (!ev.target.closest('button')) pick(); });
  drop.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === drop) { ev.preventDefault(); pick(); } });
  input.addEventListener('change', () => { if (input.files[0]) uploadResumeFile(input.files[0]); input.value = ''; });
  $('#paste-toggle')?.addEventListener('click', (ev) => { ev.stopPropagation(); const box = $('#paste-box'); box.hidden = !box.hidden; if (!box.hidden) $('#paste-text').focus(); });
  $('#paste-read')?.addEventListener('click', () => sendResume({ text: $('#paste-text').value, fileName: 'Pasted text' }));
  $('#review-resume')?.addEventListener('click', (ev) => { ev.stopPropagation(); showReview(); });
  $('#remove-resume')?.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try { await api('/resume', { method: 'DELETE', body: {} }); state.resume = null; toast('Resume removed from Launchpad.'); renderBrief(collectBrief($('#brief-form'))); } catch (e) { toast(e.message); }
  });
  if (state.showReview) { state.showReview = false; showReview(); }
}

// Page-wide drag & drop: dropping anywhere on the Brief tab reads the file (and never navigates away).
let dragDepth = 0;
const onBrief = () => (location.hash || '').startsWith('#brief') && $('#drop');
window.addEventListener('dragenter', (ev) => {
  if (![...(ev.dataTransfer?.types || [])].includes('Files')) return;
  ev.preventDefault();
  if (onBrief() && ++dragDepth === 1) $('#drop').classList.add('dragging');
});
window.addEventListener('dragover', (ev) => { if ([...(ev.dataTransfer?.types || [])].includes('Files')) { ev.preventDefault(); ev.dataTransfer.dropEffect = onBrief() ? 'copy' : 'none'; } });
window.addEventListener('dragleave', () => { if (onBrief() && --dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('dragging'); } });
window.addEventListener('drop', (ev) => {
  if (![...(ev.dataTransfer?.types || [])].includes('Files')) return;
  ev.preventDefault();
  dragDepth = 0;
  $('#drop')?.classList.remove('dragging');
  if (!onBrief()) { toast('Open the Brief tab to drop your resume.'); return; }
  const file = ev.dataTransfer.files[0];
  if (file) uploadResumeFile(file);
});

function uploadResumeFile(file) {
  if (!RESUME_TYPES.test(file.name)) { toast('Use a PDF, DOCX or TXT file.'); return; }
  if (file.size > MAX_RESUME) { toast('That file is over 5 MB.'); return; }
  const reader = new FileReader();
  reader.onload = () => sendResume({ fileName: file.name, data: String(reader.result).split(',')[1] || '' });
  reader.onerror = () => toast('Couldn’t read that file.');
  reader.readAsDataURL(file);
}

async function sendResume(payload) {
  const drop = $('#drop');
  drop?.classList.add('busy');
  drop?.setAttribute('aria-busy', 'true');
  try {
    state.resume = await api('/resume', { method: 'POST', body: payload });
    state.showReview = true;
    await renderBrief(collectBrief($('#brief-form'))); // keep any unsaved edits
    toast(`Read ${state.resume.fileName}. Pick what to apply.`);
  } catch (e) {
    toast(e.message);
  } finally {
    drop?.classList.remove('busy');
    drop?.removeAttribute('aria-busy');
  }
}

function showReview() {
  const r = state.resume;
  if (!r) return;
  const x = r.extracted || {};
  const cur = collectBrief($('#brief-form'));
  const p = cur.profile;
  const fmtGrad = (v) => (v ? new Date(`${v}-15`).toLocaleDateString([], { month: 'long', year: 'numeric' }) : '—');
  const rows = [];
  const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  const row = (key, label, now, next, preChecked) => { if (!same(now, next)) rows.push({ key, label, now, next, checked: preChecked }); };
  if (x.name) row('name', 'Name', p.name, x.name, !p.name);
  if (x.school) row('school', 'School', p.school, x.school, !p.school);
  if (x.degree) row('degree', 'Degree', p.degree, x.degree, !p.degree || p.degree === 'B.S.');
  if (x.major) row('major', 'Major', p.major, x.major, !p.major);
  if (x.gradDate) row('gradDate', 'Graduation', fmtGrad(p.gradDate), fmtGrad(x.gradDate), !p.gradDate);
  if (x.yearsExperience != null && x.yearsExperience !== Number(p.yearsExperience)) row('yearsExperience', 'Years of experience', p.yearsExperience, `${x.yearsExperience} (from your dates — count only relevant work)`, false);
  if (x.experienceSummary) row('experienceSummary', 'Experience', p.experienceSummary, x.experienceSummary, !p.experienceSummary);
  const newSkills = (x.skills || []).filter((k) => !(p.skills || []).some((s) => s.toLowerCase() === k.toLowerCase()));
  if (newSkills.length) row('skills', 'Skills (added)', (p.skills || []).join(', '), newSkills.join(', '), true);
  if (x.location && !cur.locations.tiers.some((t) => t.places.some((pl) => x.location.toLowerCase().includes(pl.toLowerCase())))) row('location', `Add to “${cur.locations.tiers[0]?.label || 'Tier 1'}” places`, cur.locations.tiers[0]?.places.join(', '), x.location, !cur.locations.tiers[0]?.places.length);
  if (x.hasMasters && !p.hasMasters) row('hasMasters', 'Has a Master’s / MBA', 'No', 'Yes', true);
  if (x.hasCSDegree && !p.hasCSDegree) row('hasCSDegree', 'Computer Science degree', 'No', 'Yes', true);
  if (x.suggestedTracks?.length) row('tracks', 'Tracks (ranked)', cur.tracks.map((t) => t.label).join(' → '), x.suggestedTracks.map((t) => `${t.label} (${t.evidence.slice(0, 3).join(', ')})`).join(' → '), !state.data.brief.completed);

  $('#resume-review').innerHTML = `<section class="panel review" aria-labelledby="review-title">
    <h2 id="review-title">What we found in ${esc(r.fileName)}</h2>
    ${rows.length ? `<p class="hint">Tick what to copy into your brief. Nothing changes until you apply and then save.</p>
    <table>
      <thead><tr><th scope="col"><span class="sr-only">Apply</span></th><th scope="col">Field</th><th scope="col">Now</th><th scope="col">From your file</th></tr></thead>
      <tbody>${rows.map((rw) => `<tr><td><input type="checkbox" data-apply="${rw.key}" ${rw.checked ? 'checked' : ''} aria-label="Apply ${esc(rw.label)}"></td><td><b>${esc(rw.label)}</b></td><td class="hint">${esc(rw.now ?? '') || '—'}</td><td>${esc(rw.next)}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="hint">We couldn’t pick out any details. Check the text below, or fill in the brief by hand.</p>'}
    <details><summary class="hint">Text we read (${r.characters.toLocaleString()} characters)</summary><pre class="snippet">${esc(r.preview)}${r.characters > r.preview.length ? '…' : ''}</pre></details>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${rows.length ? '<button class="btn btn-accent" type="button" id="apply-resume">Apply selected</button>' : ''}
      <button class="btn" type="button" id="close-review">Close</button>
    </div>
  </section>`;
  $('#resume-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#close-review').addEventListener('click', () => { $('#resume-review').innerHTML = ''; });
  $('#apply-resume')?.addEventListener('click', () => {
    const pickd = new Set($$('[data-apply]:checked').map((c) => c.dataset.apply));
    const b = collectBrief($('#brief-form'));
    for (const k of ['name', 'school', 'degree', 'major', 'gradDate', 'yearsExperience', 'experienceSummary']) if (pickd.has(k)) b.profile[k] = x[k];
    if (pickd.has('skills')) b.profile.skills = [...(b.profile.skills || []), ...newSkills];
    if (pickd.has('hasMasters')) b.profile.hasMasters = true;
    if (pickd.has('hasCSDegree')) b.profile.hasCSDegree = true;
    if (pickd.has('location') && b.locations.tiers[0]) b.locations.tiers[0].places.push(x.location);
    if (pickd.has('tracks')) {
      const presets = state.data.meta.trackPresets;
      b.tracks = x.suggestedTracks.map((t) => b.tracks.find((e) => e.id === t.id) || (() => { const pr = presets.find((q) => q.id === t.id); return { id: pr.id, label: pr.label, titleKeywords: [...pr.title], descKeywords: [...pr.desc], museCategories: [...pr.muse], salesComp: !!pr.salesComp }; })());
    }
    if (!pickd.size) { toast('Nothing selected.'); return; }
    renderBrief(b).then(() => $('#brief-form').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    toast(`Applied ${pickd.size} item${pickd.size === 1 ? '' : 's'} — review, then Save brief.`);
  });
}

function check(name, value, label) {
  return `<label class="check"><input type="checkbox" name="${esc(name)}" ${value ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}
function weight(key, label, v) {
  return `<label class="weight"><span>${esc(label)}</span><input type="range" min="0" max="100" step="5" name="weights.${key}" value="${esc(v)}"><output>${esc(v)}%</output></label>`;
}
function updateWeightSum() {
  const sum = $$('#brief-form input[type=range]').reduce((s, r) => s + Number(r.value), 0);
  $('#weights-sum').textContent = sum === 100 ? 'Weights add up to 100%.' : `Weights add up to ${sum}% — they’re normalized, so only the proportions matter.`;
}

function renderTracks() {
  const box = $('#tracks');
  box.innerHTML = draft.tracks.map((t, i) => `<div class="track" data-i="${i}">
    <div class="track-head">
      <span class="rank">${i + 1}</span>
      <input type="text" data-k="label" value="${esc(t.label)}" aria-label="Track name">
      <button class="btn btn-ghost btn-sm" type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button class="btn btn-ghost btn-sm" type="button" data-move="1" ${i === draft.tracks.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button class="btn btn-ghost btn-sm" type="button" data-remove aria-label="Remove track">✕</button>
    </div>
    <details>
      <summary>Keywords (${t.titleKeywords.length} title · ${t.descKeywords.length} description)</summary>
      <div class="row" style="margin-top:8px">
        <label class="field"><span>Title keywords</span><textarea data-k="titleKeywords" rows="3">${esc(t.titleKeywords.join(', '))}</textarea></label>
        <label class="field"><span>Description keywords</span><textarea data-k="descKeywords" rows="3">${esc(t.descKeywords.join(', '))}</textarea></label>
      </div>
      <label class="check" style="margin-top:8px"><input type="checkbox" data-k="salesComp" ${t.salesComp ? 'checked' : ''}><span>Judge pay by OTE (sales comp)</span></label>
    </details>
  </div>`).join('') || '<p class="hint">No tracks yet — add one below.</p>';
  box.onclick = (ev) => {
    const el = ev.target.closest('.track');
    if (!el) return;
    const i = Number(el.dataset.i);
    const mv = ev.target.closest('[data-move]');
    if (!mv && !ev.target.closest('[data-remove]')) return;
    collectTracks();
    if (mv) {
      const j = i + Number(mv.dataset.move);
      [draft.tracks[i], draft.tracks[j]] = [draft.tracks[j], draft.tracks[i]];
    } else draft.tracks.splice(i, 1);
    renderTracks();
  };
}

function collectTracks() {
  $$('#tracks .track').forEach((el) => {
    const t = draft.tracks[Number(el.dataset.i)];
    t.label = $('[data-k=label]', el).value.trim() || 'Track';
    t.titleKeywords = list($('[data-k=titleKeywords]', el).value);
    t.descKeywords = list($('[data-k=descKeywords]', el).value);
    t.salesComp = $('[data-k=salesComp]', el).checked;
  });
}

function collectBrief(form) {
  collectTracks();
  const b = structuredClone(draft);
  const setPath = (obj, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => (o[k] ||= {}), obj)[last] = v; };
  const LISTS = new Set(['coreIndustries', 'blocked.companies', 'blocked.keywords', 'profile.skills']);
  $$('[name]', form).forEach((el) => {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number' || el.type === 'range') v = Number(el.value);
    else v = LISTS.has(el.name) ? list(el.value) : el.value.trim();
    setPath(b, el.name, v);
  });
  b.employment.types = $$('[data-emp]', form).filter((c) => c.checked).map((c) => c.value);
  b.locations.tiers = b.locations.tiers.map((t, i) => ({ label: $(`[data-tier-label="${i}"]`, form).value.trim(), places: list($(`[data-tier-places="${i}"]`, form).value) }));
  $$('[data-boards]', form).forEach((ta) => {
    b.sources[ta.dataset.boards].boards = ta.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [token, name = ''] = line.split('|').map((s) => s.trim());
      return { token: token.replace(/^https?:\/\/[^/]+\//, '').split(/[/?#]/)[0], name };
    });
  });
  return b;
}

// ═════════════ MEMORY ═════════════
async function renderMemory() {
  const m = await api('/memory');
  const modeSel = (r) => (r.locked ? `<span class="badge">${esc(r.mode)}</span>` : `<select data-rule="${esc(r.id)}" aria-label="Mode for ${esc(r.label)}">${['exclude', 'flag', 'off'].map((x) => `<option value="${x}" ${x === r.mode ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select>`);
  view.innerHTML = `
    <div class="page-head"><div><h1>Memory</h1><p>Every run reads this log first, so it builds on yesterday instead of starting from zero.</p></div></div>
    <div class="mem-layout">
      <div>
        <section class="panel">
          <h2>Standing rules <small>Exclude hides a role · Flag shows it with a warning</small></h2>
          <table>
            <thead><tr><th>Rule</th><th>Mode</th><th title="Times this rule excluded a role in the last 7 days">Hits</th><th title="Times you dismissed a role for this reason">Your dismissals</th></tr></thead>
            <tbody>${m.rules.map((r) => `<tr><td>${esc(r.label)}</td><td>${modeSel(r)}</td><td>${r.hits}</td><td>${r.dismissals ? `${r.dismissals}${r.mode !== 'exclude' ? ` / ${m.promoteAfter}` : ''}` : '—'}</td></tr>`).join('')}
            <tr><td>Below fit threshold / off-track</td><td><span class="badge">exclude</span></td><td>${m.fitHits}</td><td>—</td></tr></tbody>
          </table>
          <p class="hint">Dismiss a role with the same reason ${m.promoteAfter} times and that reason becomes a standing rule automatically.</p>
        </section>
        <section class="panel">
          <h2>What it learned</h2>
          ${m.promoted.length ? `<ul>${m.promoted.map((p) => `<li>${esc(p.label)} <span class="hint">${esc(fmtDate(p.at, { month: 'short', day: 'numeric' }))}</span></li>`).join('')}</ul>` : '<p class="hint">Nothing promoted yet. Dismiss roles with a reason and patterns will show up here.</p>'}
          ${m.blocked.companies.length ? `<div><p class="hint" style="margin-bottom:6px">Blocked companies</p><div class="chips">${m.blocked.companies.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>` : ''}
        </section>
      </div>
      <div>
        <section class="panel">
          <h2>Run log <small>Newest first · last 7 days in detail</small></h2>
          ${m.runs.length ? m.runs.map(runItem).join('') : '<p class="hint">No runs yet.</p>'}
        </section>
        ${m.summaries.length ? `<section class="panel"><h2>Older runs <small>Condensed</small></h2><table><thead><tr><th>Date</th><th>New</th><th>Excluded</th><th>Top reasons</th></tr></thead><tbody>${m.summaries.slice(0, 60).map((s) => `<tr><td>${esc(s.date)} <span class="pill ${esc(s.status)}">${esc(s.status)}</span></td><td>${s.new}</td><td>${s.excluded}</td><td class="hint">${esc(s.topReasons.join(' · '))}</td></tr>`).join('')}</tbody></table></section>` : ''}
      </div>
    </div>`;
  $$('[data-rule]', view).forEach((s) => s.addEventListener('change', async () => {
    try { await api(`/rules/${s.dataset.rule}`, { method: 'PATCH', body: { mode: s.value } }); await refresh(); toast('Rule updated — applies from the next run.'); } catch (e) { toast(e.message); }
  }));
}

function runItem(r) {
  return `<details class="run">
    <summary><b>${esc(fmtDate(r.startedAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b>
      <span class="pill ${esc(r.status)}">${esc(r.status)}</span>
      <span class="hint">${r.counts.new} new · ${r.counts.updated} updated · ${r.counts.alreadySeen} seen · ${r.excludedCount} excluded · ${esc(r.trigger)}</span></summary>
    <div class="body">
      ${r.warnings.length ? `<ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="chips">${r.health.map((h) => `<span class="chip">${h.ok ? '✓' : '✕'} ${esc(h.source)} · ${h.count} · ${(h.ms / 1000).toFixed(1)}s</span>`).join('')}</div>
      ${r.entries.length ? `<table><thead><tr><th>Company</th><th>Role</th><th>Fit</th><th>Key flag</th></tr></thead><tbody>${r.entries.map((e) => `<tr><td>${esc(e.company)}</td><td>${esc(e.role)}<br><span class="hint">${esc(e.location)}</span></td><td>${esc(e.fit)} · ${e.score}</td><td class="hint">${esc(e.flag || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No new or changed roles this run.</p>'}
    </div>
  </details>`;
}

route();
// keep the header fresh if the scheduled run fires while the page is open
setInterval(async () => {
  if (document.hidden) return;
  const prev = state.data?.lastRun?.id;
  try { await refresh(); if (state.data.lastRun?.id !== prev && (location.hash || '#dashboard') === '#dashboard') renderDashboard(); } catch { /* offline */ }
}, 60_000);
