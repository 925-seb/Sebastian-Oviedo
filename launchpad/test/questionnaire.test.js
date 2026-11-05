import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, validateAnswers, applyAnswers, answersFromBrief, QUESTIONNAIRE_VERSION } from '../src/questionnaire.js';
import { defaultBrief, normalizeBrief } from '../src/brief.js';
import { nextRunAt, lastSlotAt } from '../src/scheduler.js';

const answers = {
  name: 'Jordan Rivera', degreeLevel: 'bachelor', fieldOfStudy: 'Business Administration, MIS', school: 'San José State University',
  status: 'student', gradDate: '2027-05', startWhen: 'after-grad',
  tracks: ['mis-analyst', 'tech-sales'], lookingFor: ['full-time'], location: 'Sacramento, San Jose', remote: 'yes',
  years: '1', kinds: ['internship', 'part-time'], summary: '', skills: 'SQL, Excel',
  frequency: 'weekly', day: '1', time: '08:30',
};

test('the questionnaire asks the five required topics, in order', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['about', 'timeline', 'interests', 'experience', 'refresh']);
  const ids = STEPS.flatMap((s) => s.questions.map((q) => q.id));
  for (const id of ['degreeLevel', 'gradDate', 'tracks', 'years', 'frequency']) assert.ok(ids.includes(id), id);
});

test('every required answer is enforced', () => {
  const errors = validateAnswers({});
  for (const id of ['degreeLevel', 'fieldOfStudy', 'status', 'gradDate', 'startWhen', 'tracks', 'lookingFor', 'remote', 'years', 'frequency']) assert.ok(errors[id], id);
  assert.deepEqual(validateAnswers(answers), {});
  assert.ok(validateAnswers({ ...answers, tracks: ['a', 'b'] }).tracks);
  assert.ok(validateAnswers({ ...answers, tracks: ['swe', 'finance', 'marketing', 'design', 'people'] }).tracks);
  assert.ok(validateAnswers({ ...answers, frequency: 'hourly' }).frequency);
  assert.ok(validateAnswers({ ...answers, status: 'graduated', gradDate: '2099-05' }).gradDate);
  // time/day only required when the frequency uses them
  assert.deepEqual(validateAnswers({ ...answers, frequency: 'manual', time: '', day: '' }), {});
  assert.ok(validateAnswers({ ...answers, day: '' }).day);
});

test('answers become the brief', () => {
  const b = applyAnswers(normalizeBrief(defaultBrief()), answers);
  assert.equal(b.completed, true);
  assert.equal(b.questionnaire.version, QUESTIONNAIRE_VERSION);
  assert.equal(b.profile.degree, 'B.S./B.A.');
  assert.equal(b.profile.gradDate, '2027-05');
  assert.equal(b.profile.yearsExperience, 1);
  assert.equal(b.profile.hasMasters, false);
  assert.deepEqual(b.tracks.map((t) => t.id), ['mis-analyst', 'tech-sales']);
  assert.deepEqual(b.employment.types, ['full-time']);
  assert.equal(b.employment.earliestStart, '2027-05');
  assert.deepEqual(b.locations.tiers[0].places, ['Sacramento', 'San Jose']);
  assert.deepEqual(b.profile.skills, ['SQL', 'Excel']);
  assert.deepEqual(b.schedule, { enabled: true, frequency: 'weekly', time: '08:30', day: 1 });
  const mba = applyAnswers(b, { ...answers, degreeLevel: 'mba', frequency: 'manual' });
  assert.equal(mba.profile.hasMasters, true);
  assert.equal(mba.schedule.enabled, false);
  assert.throws(() => applyAnswers(b, { ...answers, years: '' }), /still need an answer/);
});

test('retaking pre-fills from the saved answers', () => {
  const b = applyAnswers(normalizeBrief(defaultBrief()), answers);
  assert.deepEqual(answersFromBrief(b), answers);
  assert.equal(answersFromBrief(normalizeBrief(defaultBrief())).degreeLevel, ''); // new users start blank
  const legacy = answersFromBrief(normalizeBrief({ completed: true, profile: { degree: 'MBA', gradDate: '2024-05', yearsExperience: 2.2 } }));
  assert.equal(legacy.degreeLevel, 'mba');
  assert.equal(legacy.status, 'graduated');
  assert.equal(legacy.years, '2');
});

test('refresh rates schedule the right days', () => {
  const thu = new Date(2026, 10, 5, 8, 0); // Thursday 08:00
  const at = (frequency, extra = {}) => nextRunAt({ frequency, time: '07:00', day: 1, ...extra }, thu);
  assert.equal(at('daily').getDate(), 6);
  assert.equal(at('weekdays').getDate(), 6);
  assert.equal(at('weekdays', { time: '09:00' }).getDate(), 5); // later today
  assert.equal(at('twice-weekly').getDay(), 1); // next Monday
  assert.equal(at('weekly', { day: 6 }).getDay(), 6);
  assert.equal(at('manual'), null);
  const fri = new Date(2026, 10, 6, 18, 0);
  assert.equal(nextRunAt({ frequency: 'weekdays', time: '07:00' }, fri).getDay(), 1); // skips the weekend
  assert.equal(lastSlotAt({ frequency: 'weekly', time: '07:00', day: 1 }, thu).getDate(), 2);
});
