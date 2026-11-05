// The onboarding questionnaire, defined once and versioned here.
// Every new user answers it before reaching the dashboard. The answers become the Brief.
// The UI renders straight from STEPS, and the server validates against the same definition.
import { TRACK_PRESETS, normalizeBrief } from './brief.js';

export const QUESTIONNAIRE_VERSION = 1;

export const DEGREE_LEVELS = [
  { value: 'high-school', label: 'High school diploma / GED', degree: 'High school' },
  { value: 'certificate', label: 'Certificate or bootcamp', degree: 'Certificate' },
  { value: 'associate', label: 'Associate degree', degree: 'Associate' },
  { value: 'bachelor', label: 'Bachelor’s degree', degree: 'B.S./B.A.' },
  { value: 'master', label: 'Master’s degree', degree: 'Master’s' },
  { value: 'mba', label: 'MBA', degree: 'MBA' },
  { value: 'phd', label: 'PhD / doctorate', degree: 'PhD' },
];

export const FREQUENCIES = [
  { value: 'daily', label: 'Daily', hint: 'Every morning — best while you’re actively applying' },
  { value: 'weekdays', label: 'Every weekday', hint: 'Monday to Friday' },
  { value: 'twice-weekly', label: 'Twice a week', hint: 'Mondays and Thursdays' },
  { value: 'weekly', label: 'Weekly', hint: 'One digest a week, on the day you pick' },
  { value: 'manual', label: 'Only when I click “Run now”', hint: 'No automatic refresh' },
];

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const STEPS = [
  {
    id: 'about', title: 'About you', intro: 'Your degree sets which roles are realistic and which requirements to screen out.',
    questions: [
      { id: 'name', label: 'What should we call you?', type: 'text', placeholder: 'First and last name' },
      { id: 'degreeLevel', label: 'What degree are you earning, or have you earned?', type: 'radio', required: true, options: DEGREE_LEVELS.map(({ value, label }) => ({ value, label })) },
      { id: 'fieldOfStudy', label: 'Major or field of study', type: 'text', required: true, placeholder: 'Business Administration, MIS' },
      { id: 'school', label: 'School', type: 'text', placeholder: 'San José State University' },
    ],
  },
  {
    id: 'timeline', title: 'Graduation timeline', intro: 'Your timeline decides whether you see internships, new-grad roles, or both, and flags roles that start too early.',
    questions: [
      { id: 'status', label: 'Where are you right now?', type: 'radio', required: true, options: [{ value: 'student', label: 'Still in school' }, { value: 'graduated', label: 'Already graduated' }] },
      { id: 'gradDate', label: 'Graduation month (expected or actual)', type: 'month', required: true },
      { id: 'startWhen', label: 'When can you start a full-time role?', type: 'radio', required: true, options: [{ value: 'now', label: 'Right away' }, { value: 'after-grad', label: 'After I graduate' }] },
    ],
  },
  {
    id: 'interests', title: 'Field interest', intro: 'Pick up to four fields, in priority order. Your first pick gets the most weight.',
    questions: [
      { id: 'tracks', label: 'Which fields interest you?', type: 'rank', required: true, min: 1, max: 4, options: TRACK_PRESETS.map((t) => ({ value: t.id, label: t.label })) },
      { id: 'lookingFor', label: 'What kind of roles are you looking for?', type: 'checks', required: true, min: 1, options: [{ value: 'full-time', label: 'Full-time' }, { value: 'intern', label: 'Internships' }, { value: 'part-time', label: 'Part-time' }, { value: 'contract', label: 'Contract' }] },
      { id: 'location', label: 'Where do you want to work? (optional)', type: 'text', placeholder: 'Sacramento, San Jose, Bay Area' },
      { id: 'remote', label: 'Open to remote roles?', type: 'radio', required: true, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
    ],
  },
  {
    id: 'experience', title: 'Experience', intro: 'This sets what counts as a realistic match versus a stretch, so be honest. Internships, part-time jobs and leadership all count.',
    questions: [
      { id: 'years', label: 'How much relevant work experience do you have?', type: 'radio', required: true, options: [{ value: '0', label: 'None yet' }, { value: '0.5', label: 'Less than a year' }, { value: '1', label: 'About 1 year' }, { value: '2', label: 'About 2 years' }, { value: '3', label: '3–4 years' }, { value: '5', label: '5+ years' }] },
      { id: 'kinds', label: 'What kinds of experience? (optional)', type: 'checks', options: [{ value: 'internship', label: 'Internships' }, { value: 'part-time', label: 'Part-time jobs' }, { value: 'full-time', label: 'Full-time jobs' }, { value: 'leadership', label: 'Clubs / leadership' }, { value: 'projects', label: 'Class or personal projects' }, { value: 'volunteer', label: 'Volunteering' }] },
      { id: 'summary', label: 'In a sentence or two, what have you done? (optional)', type: 'textarea', placeholder: 'Learning trainer at Amazon; sales associate; marketing intern at HubSpot.' },
      { id: 'skills', label: 'Top skills, comma-separated (optional)', type: 'text', placeholder: 'SQL, Excel, Salesforce, Spanish' },
    ],
  },
  {
    id: 'refresh', title: 'Refresh rate', intro: 'How often should Launchpad search, verify and score new roles for you?',
    questions: [
      { id: 'frequency', label: 'Automated refresh', type: 'radio', required: true, options: FREQUENCIES.map(({ value, label, hint }) => ({ value, label, hint })) },
      { id: 'day', label: 'Which day?', type: 'select', required: true, showIf: { frequency: ['weekly'] }, options: DAYS.map((d, i) => ({ value: String(i), label: d })) },
      { id: 'time', label: 'At what time?', type: 'time', required: true, showIf: { frequency: ['daily', 'weekdays', 'twice-weekly', 'weekly'] } },
    ],
  },
];

const ALL = STEPS.flatMap((s) => s.questions);

export function isShown(q, answers) {
  if (!q.showIf) return true;
  return Object.entries(q.showIf).every(([k, vals]) => vals.includes(answers[k]));
}

/** Returns { questionId: message } for every unanswered or invalid required question. */
export function validateAnswers(answers = {}, stepId = null) {
  const errors = {};
  const qs = stepId ? STEPS.find((s) => s.id === stepId)?.questions || [] : ALL;
  for (const q of qs) {
    if (!isShown(q, answers)) continue;
    const v = answers[q.id];
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (q.required && empty) { errors[q.id] = 'Please answer this one.'; continue; }
    if (empty) continue;
    if (q.options && ['radio', 'select'].includes(q.type) && !q.options.some((o) => o.value === String(v))) errors[q.id] = 'Pick one of the options.';
    if (['checks', 'rank'].includes(q.type)) {
      if (!Array.isArray(v) || v.some((x) => !q.options.some((o) => o.value === x))) errors[q.id] = 'Pick from the list.';
      else if (q.min && v.length < q.min) errors[q.id] = `Pick at least ${q.min}.`;
      else if (q.max && v.length > q.max) errors[q.id] = `Pick at most ${q.max}.`;
    }
    if (q.type === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) errors[q.id] = 'Use a month and year.';
    if (q.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) errors[q.id] = 'Use a time like 07:00.';
    if (['text', 'textarea'].includes(q.type) && String(v).length > 1000) errors[q.id] = 'That’s too long.';
  }
  if (!stepId || stepId === 'timeline') {
    if (answers.status === 'graduated' && /^\d{4}-\d{2}$/.test(answers.gradDate || '') && answers.gradDate > new Date().toISOString().slice(0, 7)) errors.gradDate = 'You said you’ve graduated — pick a past month.';
  }
  return errors;
}

const list = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

/** Map validated answers onto the brief (keeps everything the questionnaire doesn't ask about). */
export function applyAnswers(brief, answers, now = new Date()) {
  const errors = validateAnswers(answers);
  if (Object.keys(errors).length) throw Object.assign(new Error('Some questions still need an answer'), { status: 400, errors });
  const b = structuredClone(brief);
  const level = DEGREE_LEVELS.find((d) => d.value === answers.degreeLevel);
  const field = String(answers.fieldOfStudy).trim();
  Object.assign(b.profile, {
    name: String(answers.name || b.profile.name || '').trim(),
    school: String(answers.school || b.profile.school || '').trim(),
    degree: level.degree,
    major: field,
    gradDate: answers.gradDate,
    yearsExperience: Number(answers.years),
    hasMasters: ['master', 'mba', 'phd'].includes(level.value),
    hasCSDegree: /computer science|\bcs\b/i.test(field),
  });
  if (answers.summary) b.profile.experienceSummary = String(answers.summary).trim();
  else if (answers.kinds?.length && !b.profile.experienceSummary) b.profile.experienceSummary = `Experience: ${answers.kinds.join(', ')}`;
  if (answers.skills) b.profile.skills = [...new Set([...(b.profile.skills || []), ...list(answers.skills)])];

  // Field interest → ranked tracks (keep any custom keywords already on a track you re-picked)
  b.tracks = answers.tracks.map((id) => {
    const existing = b.tracks.find((t) => t.id === id);
    if (existing) return existing;
    const p = TRACK_PRESETS.find((t) => t.id === id);
    return { id: p.id, label: p.label, titleKeywords: [...p.title], descKeywords: [...p.desc], museCategories: [...p.muse], salesComp: !!p.salesComp };
  });
  b.employment.types = [...answers.lookingFor];
  // Still in school and starting after graduation → flag roles that want an immediate start.
  b.employment.earliestStart = answers.status === 'student' && answers.startWhen === 'after-grad' ? answers.gradDate : '';
  if (answers.location) {
    b.locations.tiers[0] = { label: b.locations.tiers[0]?.label || 'Local', places: [...new Set([...(b.locations.tiers[0]?.places || []), ...list(answers.location)])] };
  }
  b.locations.remote = answers.remote === 'yes';

  b.schedule = {
    enabled: answers.frequency !== 'manual',
    frequency: answers.frequency,
    time: answers.time || b.schedule.time || '07:00',
    day: answers.frequency === 'weekly' ? Number(answers.day) : b.schedule.day ?? 1,
  };
  // A weekly digest should still look back over the whole week.
  if (answers.frequency === 'weekly' || answers.frequency === 'manual') b.rules.freshnessDays = Math.max(b.rules.freshnessDays, 10);

  b.questionnaire = { version: QUESTIONNAIRE_VERSION, completedAt: now.toISOString(), answers: structuredClone(answers) };
  b.completed = true;
  return normalizeBrief(b);
}

/** Pre-fill the questionnaire from an existing brief (retakes, or briefs made before it existed). */
export function answersFromBrief(brief) {
  if (brief.questionnaire?.answers) return structuredClone(brief.questionnaire.answers);
  // A brand-new user starts blank: the app's defaults are not their answers.
  if (!brief.completed) return { name: '', degreeLevel: '', fieldOfStudy: '', school: '', status: '', gradDate: '', startWhen: '', tracks: [], lookingFor: [], location: '', remote: '', years: '', kinds: [], summary: '', skills: '', frequency: '', time: '07:00', day: '1' };
  const p = brief.profile;
  const level = /mba/i.test(p.degree) ? 'mba' : /phd|doctor/i.test(p.degree) ? 'phd' : /master|m\.s|m\.a/i.test(p.degree) || p.hasMasters ? 'master' : /assoc/i.test(p.degree) ? 'associate' : p.degree ? 'bachelor' : '';
  const yearsOpts = ['0', '0.5', '1', '2', '3', '5'];
  const years = yearsOpts.reduce((best, o) => (Math.abs(Number(o) - p.yearsExperience) < Math.abs(Number(best) - p.yearsExperience) ? o : best), '0');
  return {
    name: p.name || '', degreeLevel: level, fieldOfStudy: p.major || '', school: p.school || '',
    status: p.gradDate && p.gradDate <= new Date().toISOString().slice(0, 7) ? 'graduated' : p.gradDate ? 'student' : '',
    gradDate: p.gradDate || '', startWhen: brief.employment.earliestStart ? 'after-grad' : p.gradDate ? 'now' : '',
    tracks: brief.tracks.map((t) => t.id).filter((id) => TRACK_PRESETS.some((t) => t.id === id)),
    lookingFor: [...brief.employment.types], location: (brief.locations.tiers[0]?.places || []).join(', '), remote: brief.locations.remote ? 'yes' : 'no',
    years, kinds: [], summary: p.experienceSummary || '', skills: (p.skills || []).join(', '),
    frequency: brief.schedule.enabled === false ? 'manual' : brief.schedule.frequency || 'daily', time: brief.schedule.time || '07:00', day: String(brief.schedule.day ?? 1),
  };
}
