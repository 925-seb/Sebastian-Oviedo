import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize as gh } from '../src/sources/greenhouse.js';
import { normalize as lever } from '../src/sources/lever.js';
import { normalize as ashby } from '../src/sources/ashby.js';
import { normalize as muse } from '../src/sources/muse.js';

// Payload shapes follow each provider's public API docs.
test('greenhouse: decodes entity-encoded HTML', () => {
  const j = gh({ id: 1, title: 'SDR', location: { name: 'Remote - US' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', first_published: '2026-10-30T00:00:00Z', content: '&lt;p&gt;Prospect &amp;amp; book meetings&lt;/p&gt;' }, { token: 'acme', name: 'Acme' });
  assert.equal(j.company, 'Acme');
  assert.equal(j.description, 'Prospect & book meetings');
  assert.equal(j.remote, true);
  assert.equal(j.sourceKind, 'ats');
});

test('lever: salary range and commitment', () => {
  const j = lever({ id: 'x', text: 'Business Analyst', categories: { location: 'San Jose, CA', commitment: 'Full-time' }, createdAt: 1761800000000, hostedUrl: 'https://jobs.lever.co/acme/x', descriptionPlain: 'SQL', salaryRange: { min: 70000, max: 85000, interval: 'per-year-salary' } }, { token: 'acme' });
  assert.deepEqual(j.compensation, { min: 70000, max: 85000, type: 'base' });
  assert.equal(j.employmentType, 'Full-time');
});

test('ashby: compensation components and employment type', () => {
  const j = ashby({ id: 'y', title: 'APM', location: 'Remote', isRemote: true, employmentType: 'FullTime', jobUrl: 'https://jobs.ashbyhq.com/acme/y', publishedAt: '2026-10-31T00:00:00Z', descriptionPlain: 'Roadmap', compensation: { compensationTierSummary: '$95K – $115K', summaryComponents: [{ compensationType: 'Salary', interval: '1 YEAR', minValue: 95000, maxValue: 115000 }] } }, { token: 'acme', name: 'Acme' });
  assert.equal(j.employmentType, 'full-time');
  assert.equal(j.compensation.min, 95000);
});

test('muse: aggregator record', () => {
  const j = muse({ id: 9, name: 'Operations Analyst', contents: '<p>Lean</p>', publication_date: '2026-10-31T00:00:00Z', locations: [{ name: 'Sacramento, CA' }], levels: [{ name: 'Entry Level' }], company: { name: 'Acme' }, refs: { landing_page: 'https://www.themuse.com/jobs/acme/ops' } });
  assert.equal(j.sourceKind, 'aggregator');
  assert.equal(j.description, 'Lean');
});
