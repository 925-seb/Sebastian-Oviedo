import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractText, detectType } from '../src/extract.js';
import { parseResume, experienceMonths } from '../src/resume.js';

// Fixtures: a fictional resume, printed to PDF by Chromium (per-glyph, Identity-H fonts) and saved as DOCX.
const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url));
const NOW = new Date('2026-11-05T12:00:00Z');

test('extracts readable text from a Chromium PDF and a DOCX', () => {
  for (const f of ['sample-resume.pdf', 'sample-resume.docx']) {
    const { text, type } = extractText(fx(f), f);
    assert.equal(type, f.endsWith('pdf') ? 'pdf' : 'docx');
    assert.match(text, /Jordan Rivera/);
    assert.match(text, /California State University, Stanislaus/);
    assert.match(text, /SQL, Excel, Power BI/);
  }
});

test('rejects unsupported and unreadable files', () => {
  assert.equal(detectType(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]), 'photo.jpg'), 'unknown');
  assert.throws(() => extractText(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]), 'photo.jpg'), /Unsupported/);
  assert.throws(() => extractText(Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF'), 'scan.pdf'), /scanned/);
});

test('parses a resume into brief suggestions', () => {
  const r = parseResume(extractText(fx('sample-resume.pdf'), 'r.pdf').text, NOW);
  assert.equal(r.name, 'Jordan Rivera');
  assert.equal(r.school, 'California State University, Stanislaus');
  assert.equal(r.degree, 'B.S.');
  assert.equal(r.gradDate, '2027-05');
  assert.equal(r.location, 'Stockton, CA');
  assert.equal(r.yearsExperience, 3.5);
  assert.match(r.experienceSummary, /Operations Intern, Harbor Freightways/);
  for (const s of ['SQL', 'Excel', 'Power BI', 'Salesforce', 'SAP']) assert.ok(r.skills.includes(s), s);
  assert.equal(r.suggestedTracks[0].id, 'ops-supply');
  assert.equal(r.hasMasters, false);
});

test('parses a LinkedIn "Save to PDF" layout', () => {
  const text = [
    'Contact', 'www.linkedin.com/in/alexkim (LinkedIn)', 'Top Skills', 'HubSpot', 'Salesforce', 'Cold Calling', 'Languages', 'Korean (Native or Bilingual)',
    'Alex Kim', 'Sales Development Representative at Northwind', 'San José, California, United States',
    'Summary', 'Business student focused on SaaS sales.',
    'Experience', 'Northwind Cloud', 'Sales Development Representative', 'January 2025 - Present (1 year 11 months)',
    'Education', 'San José State University', 'Bachelor of Science - BS, Business Administration · (2022 - 2026)',
  ].join('\n');
  const r = parseResume(text, NOW);
  assert.equal(r.name, 'Alex Kim');
  assert.equal(r.school, 'San José State University');
  assert.equal(r.degree, 'Bachelor of Science');
  assert.equal(r.major, 'Business Administration');
  assert.equal(r.gradDate, '2026-05');
  assert.equal(r.location, 'San José');
  assert.equal(r.experienceSummary, 'Sales Development Representative, Northwind Cloud');
  assert.equal(r.suggestedTracks[0].id, 'tech-sales');
});

test('experience months merge overlapping ranges', () => {
  const { months } = experienceMonths(['Jan 2024 – Dec 2024', 'Jun 2024 - Mar 2025', '2019 - 2020'], NOW);
  assert.equal(months, 15 + 24);
});

test('skills from the resume boost matching postings', async () => {
  const { scoreJob } = await import('../src/score.js');
  const { defaultBrief, normalizeBrief } = await import('../src/brief.js');
  const job = { company: 'Acme', title: 'Business Analyst', location: 'San Jose, CA', description: 'Build dashboards with SQL and Tableau.' };
  const without = scoreJob(job, normalizeBrief(defaultBrief()));
  const b = defaultBrief();
  b.profile.skills = ['SQL', 'Tableau', 'Python'];
  const withSkills = scoreJob(job, normalizeBrief(b));
  assert.deepEqual(withSkills.skillsMatched, ['SQL', 'Tableau']);
  assert.ok(withSkills.parts.track.score > without.parts.track.score);
});
