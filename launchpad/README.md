# Launchpad

**Your job search runs every morning, even when you don't.**

Launchpad helps students and early-career professionals find their next opportunity. You write one brief. A daily run then searches, verifies, scores, and remembers roles for you. Everything lands on one living dashboard that doubles as your application tracker.

It's built on the same five-step structure as the "Automated Early Career Job Dashboard" deck:

```
1 Brief  →  2 Daily run  →  3 Search  →  4 Verify + score  →  5 Log + publish
   ↑                                                              │
   └──────────── every run reads yesterday's log first ───────────┘
```

| Step | Where it lives | What it does |
|---|---|---|
| **1. Brief** | `src/brief.js`, Brief tab | Who you are (degree, grad date, real experience, skills), up to 4 ranked tracks, location tiers, pay floors (base and OTE), and the rules. Start by **dragging and dropping your resume or LinkedIn profile** (see below). |
| **2. Automated refresh** | `src/scheduler.js`, `src/cli.js` | Runs on the schedule you picked in the questionnaire: daily, every weekday, twice a week (Mon & Thu), weekly on a chosen day, or manual only. If a scheduled run was missed, it catches up on start. |
| **3. Search** | `src/sources/*` | Employer boards (Greenhouse, Lever, Ashby) come straight from the company's own careers page. Aggregators: The Muse (no key needed) and Adzuna (optional key). Demo listings work offline. |
| **4. Verify + score** | `src/verify.js`, `src/score.js`, `src/rules.js` | Checks that a posting is still live. Scores every role the same way: experience fit 40%, track 30%, pay 20%, employment type 10% (you set the weights). Applies the exclusion rules. |
| **5. Log + publish** | `src/pipeline.js`, `src/store.js`, Dashboard and Memory tabs | Keeps a run log, skips roles seen in the last 14 days unless they changed, logs run health, and condenses old runs into summaries. |

### Rule #1: surface only strong or realistic fits, and don't pad the list
- Roles below your minimum fit score are excluded, and each run adds at most N new roles. Overflow is held for the next run.
- **Stretch** roles (for example, "asks for 2+ years, you have 1") are flagged with the reason instead of being hidden silently.
- Built-in exclusions: Master's required, citizenship or clearance, CS degree only, stale or evergreen postings, commission-only or 1099 jobs, senior titles, too many years required, outside your locations, unpaid. On the Memory tab, set each one to **Exclude**, **Flag**, or **Off**.
- **The app learns.** When you dismiss a role, you give a reason. Use the same reason 3 times and it becomes a standing rule. Dismiss the same company twice and it gets blocked.
- Roles marked **Applied**, **Interviewing**, or **Offer** never expire.

### The onboarding questionnaire (required)
Every new user answers a short, fixed questionnaire before reaching the dashboard. It's defined once in `src/questionnaire.js` (versioned) and validated on the server, and the UI is generated from that same definition.

| Step | Asks | Becomes |
|---|---|---|
| About you | Name, degree level, field of study, school | Profile; Master's/MBA and CS-degree screening |
| Graduation timeline | Still in school or graduated, graduation month, when you can start | Grad date; roles wanting an immediate start get flagged |
| Field interest | Up to 4 fields in priority order, role types (full-time, internship…), locations, remote | Ranked tracks, employment types, location tier 1 |
| Experience | Years of relevant experience, kinds of experience, short summary, top skills | What counts as realistic vs. stretch; skills matching |
| Refresh rate | Daily / every weekday / twice a week / weekly (+ day) / manual, and the time | The automated schedule |

Then you review your answers and press **Finish & start searching**. Your first search runs right away. To change your answers later, use **Retake it** on the Brief tab; everything stays fine-tunable there too.

### Start from your resume or LinkedIn profile
At the top of the Brief tab, drag and drop a resume or a LinkedIn profile PDF. On LinkedIn, open your profile, then **More → Save to PDF**. You can also click to choose a file, or paste the text.

- **Formats:** PDF, DOCX, and TXT, up to 5 MB. The text is extracted on your own Launchpad server with no third-party service or dependency (`src/extract.js`).
- **What it suggests:** name, school, degree, major, graduation date, years of experience (computed from your date ranges), an experience summary, skills, your city, and your best-matching tracks, ranked with the evidence for each (`src/resume.js`).
- **You choose what to apply.** A review table shows each field's current value next to the suggestion. Only empty fields are ticked by default. Nothing changes until you apply your choices and then save the brief.
- **Skills count in scoring.** A posting that mentions two or more of your skills gets a boost on track alignment, and its card shows "Matches your skills: …".
- Scanned, image-only PDFs have no text to read. Use the DOCX or paste the text instead.

## Run it

Requires Node 18 or newer. There are no dependencies to install.

Try it with offline sample data. The sample includes every trap the rules are meant to catch:

```bash
npm run demo
```

Then open http://127.0.0.1:3000.

For real searches:

```bash
npm start
```

Open the **Brief** tab, fill it in, and add employer boards. The board name is in the careers URL: `boards.greenhouse.io/<board>`, `jobs.lever.co/<board>`, or `jobs.ashbyhq.com/<board>`. Then save. Your first run starts immediately.

### Run it in Figma
`.figma/make/` holds the lifecycle scripts Figma uses to run Launchpad as a code layer. The in-Figma preview starts `node server.js` in demo mode (offline sample data) on Figma's port. Figma's **Publish** is not supported, because Figma only publishes static or Next.js builds and Launchpad needs its Node server; the `deploy` scripts exit with a message saying so.

Other commands:

```bash
npm test
```

```bash
npm run run-once
```

`run-once` runs the pipeline once and exits. You can use it from an OS cron job or a GitHub Action instead of keeping the server running.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Where the dashboard listens |
| `LAUNCHPAD_DATA_DIR` | `./data` | Where the JSON memory files live (`brief.json`, `jobs.json`, `runs.json`, `learned.json`, `resume.json`) |
| `LAUNCHPAD_DEMO` | unset | `1` = start with a filled-in example brief and the offline demo source |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | unset | Turns on the Adzuna source (free key at developer.adzuna.com) |

## API

| Method | Path | |
|---|---|---|
| GET | `/api/dashboard` | Top-strip stats, all roles, last run (health and excluded today), next run, and the questionnaire (steps, saved answers, done) |
| GET / PUT | `/api/brief` | Read or save the brief |
| POST | `/api/questionnaire` | Submit questionnaire answers. Returns the updated brief, or `400` with `errors` per question |
| POST | `/api/run` | Run the pipeline now |
| PATCH | `/api/jobs/:id` | `{ status, notes }` |
| POST | `/api/jobs/:id/dismiss` | `{ reason }`. Feeds the standing-rule learner |
| GET | `/api/memory` | Run log, condensed summaries, rules with hit counts |
| PATCH | `/api/rules/:id` | `{ mode: "exclude" \| "flag" \| "off" }` |
| GET | `/api/export.csv` | Tracker export for spreadsheets |
| GET / DELETE | `/api/resume` | The stored resume (file name, text preview, suggestions), or remove it |
| POST | `/api/resume` | `{ fileName, data }` (base64 file) or `{ text }`. Returns suggested Brief fields |

## Adding a source

Create `src/sources/<name>.js`. It must export `meta = { id, label, kind: 'ats' | 'aggregator' }` and `async search(brief)`, which returns `{ jobs, errors }` with normalized jobs. Then register the file in `src/sources/index.js`. If a source fails, the failure is recorded in run health and never stops the run.

## Notes

- Your resume text is stored in `data/resume.json`, which is git-ignored. **Remove** on the Brief tab deletes it.
- This is a single-user app that stores everything in local JSON files. It listens on localhost by default and has no login, so put authentication in front of it before you expose it to the internet.
- Verification fetches each aggregator posting's page. Some sites block automated requests. Those roles show as **Unconfirmed** instead of being dropped.
- Automation finds the roles. People still get you the interview.
