// Resume / LinkedIn profile text → suggested Brief fields.
// Everything here is a *suggestion*: the Brief tab shows what was found and you choose what to apply.
import { TRACK_PRESETS } from './brief.js';

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DATE_RE = `(?:${MONTH_RE}\\s+(\\d{4})|(\\d{1,2})\\/(\\d{4})|(\\d{4}))`;
const RANGE_RE = new RegExp(`${DATE_RE}\\s*(?:-|–|—|to)\\s*(?:${DATE_RE}|(present|current|now))`, 'gi');

/** Tools and skills worth recognising (in addition to every track keyword). */
export const SKILL_VOCAB = [
  'SQL', 'Excel', 'Tableau', 'Power BI', 'Looker', 'Python', 'R', 'Java', 'JavaScript', 'TypeScript', 'React', 'Node.js', 'HTML', 'CSS', 'Git',
  'Salesforce', 'HubSpot', 'Outreach', 'Gong', 'ZoomInfo', 'LinkedIn Sales Navigator', 'CRM', 'ERP', 'SAP', 'Oracle', 'NetSuite', 'Workday', 'Jira', 'Confluence', 'Asana', 'Smartsheet',
  'Agile', 'Scrum', 'Kanban', 'Lean', 'Six Sigma', 'Project management', 'Process improvement', 'Forecasting', 'Inventory management', 'Logistics', 'Procurement',
  'Figma', 'Adobe Creative Suite', 'Canva', 'Google Analytics', 'SEO', 'Social media', 'Content marketing',
  'Financial modeling', 'Accounting', 'QuickBooks', 'GAAP', 'Data analysis', 'Data visualization', 'Dashboards', 'Requirements gathering', 'Stakeholder management',
  'Customer success', 'Cold calling', 'Prospecting', 'Negotiation', 'Public speaking', 'Training', 'Onboarding', 'Leadership', 'Bilingual', 'Spanish',
];

const SECTION_HEADS = {
  education: /^(education|academic background|education & certifications)\b/i,
  experience: /^(experience|work experience|professional experience|employment|work history|relevant experience|leadership experience|leadership & involvement)\b/i,
  skills: /^(skills|technical skills|top skills|core competencies|skills & interests|tools)\b/i,
  summary: /^(summary|about|profile|objective|professional summary)\b/i,
  contact: /^(contact|contact information)\b/i,
  other: /^(projects|certifications|licenses|honors|awards|activities|volunteer|languages|interests|publications|references)\b/i,
};

export const isHeading = (line) => line.length < 48 && Object.entries(SECTION_HEADS).find(([, re]) => re.test(line.replace(/[:|]+$/, '')))?.[0];

function sections(lines, linkedin) {
  const out = { header: [], contact: [], education: [], experience: [], skills: [], summary: [], other: [] };
  let cur = 'header';
  for (const line of lines) {
    const head = isHeading(line);
    if (head) { cur = head; continue; }
    // LinkedIn's sidebar lists exactly three "Top Skills", then the name/headline block follows unlabeled
    if (linkedin && cur === 'skills' && out.skills.length >= 3) cur = 'header';
    if (linkedin && cur === 'contact' && !/@|linkedin\.com|www\.|http|\(\w+\)|^\+?[\d ()-]{7,}$/i.test(line)) cur = 'header';
    out[cur].push(line);
  }
  return out;
}

function side(month, num, year, isEnd) {
  const y = Number(year);
  if (month) return y * 12 + MONTHS[month.toLowerCase().slice(0, 3)];
  if (num) return y * 12 + Number(num) - 1;
  return y * 12 + (isEnd ? 11 : 0); // year only: Jan … Dec
}

/** Total months covered by date ranges (overlaps counted once). */
export function experienceMonths(lines, now = new Date()) {
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const ranges = [];
  for (const line of lines) {
    for (const r of line.matchAll(RANGE_RE)) {
      const start = side(r[1], r[3], r[2] || r[4] || r[5], false);
      const end = r[11] ? nowIdx : side(r[6], r[8], r[7] || r[9] || r[10], true);
      if (!(end >= start) || start < 1950 * 12 || start > nowIdx) continue;
      ranges.push([start, Math.min(end, nowIdx) + 1]);
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur = null;
  for (const [s, e] of ranges) {
    if (!cur || s > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [s, e]; } else cur[1] = Math.max(cur[1], e);
  }
  if (cur) total += cur[1] - cur[0];
  return { months: total, ranges: ranges.length };
}

const has = (hay, k) => new RegExp(`(^|[^a-z0-9])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(hay);

export function parseResume(text, now = new Date()) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+,/g, ',').replace(/ /g, ' ');
  const lines = clean.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const linkedin = /linkedin\.com\/in\//i.test(clean) && /^(top skills|summary)$/im.test(clean);
  const sec = sections(lines, linkedin);
  const lower = clean.toLowerCase();
  const found = {};

  // Name: first short line of capitalised words with no digits / @ / bullets.
  const NAME = /^\p{Lu}[\p{L}'’.-]+(\s+\p{Lu}[\p{L}'’.-]+){1,3}$/u;
  const nameLine = sec.header.slice(0, 8).find((l) => NAME.test(l) && !isHeading(l) && !/resume|curriculum|profile|linkedin|university|college/i.test(l));
  if (nameLine) found.name = nameLine;
  if (!found.name && linkedin) {
    // LinkedIn PDF: Name / Headline / "City, State, Country"
    const at = lines.findIndex((l) => /^\p{Lu}[\p{L}.' -]+, \p{Lu}[\p{L} ]+(, \p{Lu}[\p{L} ]+)?$/u.test(l) && !isHeading(l));
    const cand = [lines[at - 2], lines[at - 1]].find((l) => l && NAME.test(l));
    if (cand) found.name = cand;
  }

  // School, degree, major, graduation (education section first, then anywhere)
  const edu = sec.education.length ? sec.education : lines;
  const schoolLine = edu.find((l) => /\b(university|college|institute of technology|polytechnic|community college)\b/i.test(l));
  if (schoolLine) {
    const m = /(\p{Lu}[\p{L}\d.&'’ -]*?(?:University|College|Institute of Technology|Polytechnic)(?:,? (?:of|at) \p{Lu}[\p{L}.' -]+?)?(?:, \p{Lu}[\p{L} .'-]+)?)(?=\s*(?:—|–|-|\||·|,\s*(?:B\.|M\.|Bachelor|Master)|$))/u.exec(schoolLine)
      || /(\p{Lu}[\p{L}\d.&'’ ,-]*?(?:University|College)[\p{L} ,'.-]*)/u.exec(schoolLine);
    if (m) found.school = m[1].trim().replace(/[,—–-]\s*$/, '');
  }
  const degreeRe = /\b(Bachelor of [A-Z][A-Za-z ]+?|Master of [A-Z][A-Za-z ]+?|B\.?\s?S\.?|B\.?\s?A\.?|BBA|B\.?B\.?A\.?|M\.?\s?S\.?|M\.?\s?A\.?|MBA|Associate of [A-Za-z ]+?|A\.?A\.?)(?=[\s,]|$)(?:,?\s*(?:in\s+)?([A-Z][A-Za-z&/ ]+?))?(?=[,.;|·—–(]|\s+-\s|\s{2}|$)/;
  const degreeLine = edu.find((l) => degreeRe.test(l));
  if (degreeLine) {
    const m = degreeRe.exec(degreeLine);
    const deg = m[1].replace(/\s+/g, ' ').trim();
    found.degree = /^b\.?\s?s\.?$/i.test(deg) ? 'B.S.' : /^b\.?\s?a\.?$/i.test(deg) ? 'B.A.' : deg;
    const after = degreeLine.slice(m.index + m[1].length).replace(/^\s*-\s*[A-Z]{2,4}\b/, '');
    const major = /^[,\s]*(?:in\s+)?([A-Z][A-Za-z&/ ]+?)(?:,\s*(?:concentration|emphasis|option|minor)[^,;|·—–]*?\bin\s+([A-Z][A-Za-z&/ ]+))?(?=[,.;|·—–(]|\s+-\s|$)/i.exec(after)
      || /(?:major(?:ing)?|concentration)\s*(?:in|:)\s*([A-Z][A-Za-z&/ ]+)/i.exec(degreeLine);
    if (major) found.major = [major[1], major[2]].filter(Boolean).map((s) => s.trim()).join(', ');
  }
  found.hasMasters = /\b(master of|m\.s\.|mba|m\.a\.)\b/i.test(edu.join(' ')) && !/expected|candidate|pursuing/i.test(edu.find((l) => /master|mba/i.test(l)) || '');
  found.hasCSDegree = /(b\.?s\.?|bachelor[^,]*?)\s*(in\s+)?computer science/i.test(edu.join(' '));

  const gradRe = new RegExp(`(?:expected|anticipated|graduat\\w*|class of|grad\\.?)?[:\\s]*(?:${MONTH_RE})?\\s*(20\\d{2})`, 'gi');
  let grad = null;
  for (const l of edu) {
    for (const g of l.matchAll(gradRe)) {
      const y = Number(g[2]);
      if (y < now.getFullYear() - 15 || y > now.getFullYear() + 6) continue;
      const mo = g[1] ? MONTHS[g[1].toLowerCase().slice(0, 3)] + 1 : 5;
      const iso = `${y}-${String(mo).padStart(2, '0')}`;
      if (!grad || iso > grad) grad = iso;
    }
  }
  if (grad) found.gradDate = grad;

  // Experience: years from date ranges; a summary from the role lines.
  const expLines = sec.experience.length ? sec.experience : lines.filter((l) => RANGE_RE.test(l) && !/university|college/i.test(l));
  RANGE_RE.lastIndex = 0;
  const { months } = experienceMonths(expLines, now);
  if (months > 0) found.yearsExperience = Math.round((months / 12) * 2) / 2;
  const roles = expLines
    .map((l, i) => {
      RANGE_RE.lastIndex = 0;
      if (!RANGE_RE.test(l)) return null;
      const rest = l.replace(RANGE_RE, '').replace(/\(.*?\)/g, '').replace(/\s*[|·—–-]\s*$/, '').replace(/\s{2,}/g, ' ').replace(/\s+([,])/g, '$1').trim();
      if (rest.length > 3) return rest;
      // date on its own line: the role is the line(s) above it (LinkedIn: Company, then Title)
      const prev = expLines.slice(Math.max(0, i - 2), i).filter((x) => { RANGE_RE.lastIndex = 0; return !RANGE_RE.test(x) && x.length < 80 && !/^[•-]/.test(x); });
      return prev.length === 2 ? `${prev[1]}, ${prev[0]}` : prev[0] || null;
    })
    .filter(Boolean)
    .filter((l) => l.length > 3 && l.length < 140)
    .slice(0, 6);
  RANGE_RE.lastIndex = 0;
  if (roles.length) found.experienceSummary = roles.join('; ');

  // Skills: vocabulary + track keywords that appear, plus explicit "Skills" section items.
  const vocab = new Map(SKILL_VOCAB.map((s) => [s.toLowerCase(), s]));
  const skills = new Set();
  for (const [k, label] of vocab) if (k.length > 1 && has(lower, k)) skills.add(label);
  for (const l of sec.skills) {
    for (const item of l.split(/[,;|•·]/)) {
      const s = item.replace(/^[^:]{1,25}:\s*/, '').replace(/\(.*?\)/g, '').trim();
      if (s.length >= 2 && s.length <= 32 && !/\d{3,}/.test(s)) skills.add(s);
    }
  }
  found.skills = dedupeCase([...skills]).slice(0, 40);

  // Location: a "City, ST" in the header.
  const loc = [...sec.header, ...lines.slice(0, 5)].map((l) => /\b([A-Z][a-zA-Z.]+(?: [A-Z][a-zA-Z.]+){0,2}), ([A-Z]{2})\b(?!\w)/.exec(l)).find(Boolean);
  if (loc) found.location = `${loc[1]}, ${loc[2]}`;
  else {
    const li = [...sec.header, ...lines.slice(0, 12)].map((l) => /^(\p{Lu}[\p{L}.' -]+), (\p{Lu}[\p{L} ]+), United States$/u.exec(l)).find(Boolean);
    if (li) found.location = li[1];
  }

  // Tracks: rank presets by how much of the resume speaks their language.
  const scored = TRACK_PRESETS.map((t) => {
    const titleHits = t.title.filter((k) => has(lower, k));
    const descHits = t.desc.filter((k) => has(lower, k));
    return { id: t.id, label: t.label, score: titleHits.length * 3 + descHits.length, evidence: [...titleHits, ...descHits].slice(0, 4) };
  }).filter((t) => t.score >= 2).sort((a, b) => b.score - a.score).slice(0, 4);
  found.suggestedTracks = scored;

  found.stats = { characters: clean.length, lines: lines.length, sections: Object.entries(sec).filter(([k, v]) => k !== 'header' && v.length).map(([k]) => k) };
  return found;
}

function dedupeCase(list) {
  const seen = new Set();
  return list.filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
