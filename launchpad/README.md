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
| **1. Brief** | `src/brief.js`, Brief tab | Who you are (degree, grad date, real experience), up to 4 ranked tracks, location tiers, pay floors (base and OTE), and the rules. |
| **2. Daily run** | `src/scheduler.js`, `src/cli.js` | Runs once a day at your chosen time. If today's run was missed, it catches up on start. |
| **3. Search** | `src/sources/*` | Employer boards (Greenhouse, Lever, Ashby) come straight from the company's own careers page. Aggregators: The Muse (no key needed) and Adzuna (optional key). Demo listings work offline. |
| **4. Verify + score** | `src/verify.js`, `src/score.js`, `src/rules.js` | Checks that a posting is still live. Scores every role the same way: experience fit 40%, track 30%, pay 20%, employment type 10% (you set the weights). Applies the exclusion rules. |
| **5. Log + publish** | `src/pipeline.js`, `src/store.js`, Dashboard and Memory tabs | Keeps a run log, skips roles seen in the last 14 days unless they changed, logs run health, and condenses old runs into summaries. |

### Rule #1: surface only strong or realistic fits, and don't pad the list
- Roles below your minimum fit score are excluded, and each run adds at most N new roles. Overflow is held for the next run.
- **Stretch** roles (for example, "asks for 2+ years, you have 1") are flagged with the reason instead of being hidden silently.
- Built-in exclusions: Master's required, citizenship or clearance, CS degree only, stale or evergreen postings, commission-only or 1099 jobs, senior titles, too many years required, outside your locations, unpaid. On the Memory tab, set each one to **Exclude**, **Flag**, or **Off**.
- **The app learns.** When you dismiss a role, you give a reason. Use the same reason 3 times and it becomes a standing rule. Dismiss the same company twice and it gets blocked.
- Roles marked **Applied**, **Interviewing**, or **Offer** never expire.

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
| `LAUNCHPAD_DATA_DIR` | `./data` | Where the JSON memory files live (`brief.json`, `jobs.json`, `runs.json`, `learned.json`) |
| `LAUNCHPAD_DEMO` | unset | `1` = start with a filled-in example brief and the offline demo source |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | unset | Turns on the Adzuna source (free key at developer.adzuna.com) |

## API

| Method | Path | |
|---|---|---|
| GET | `/api/dashboard` | Top-strip stats, all roles, last run (health and excluded today), next run |
| GET / PUT | `/api/brief` | Read or save the brief |
| POST | `/api/run` | Run the pipeline now |
| PATCH | `/api/jobs/:id` | `{ status, notes }` |
| POST | `/api/jobs/:id/dismiss` | `{ reason }`. Feeds the standing-rule learner |
| GET | `/api/memory` | Run log, condensed summaries, rules with hit counts |
| PATCH | `/api/rules/:id` | `{ mode: "exclude" \| "flag" \| "off" }` |
| GET | `/api/export.csv` | Tracker export for spreadsheets |

## Adding a source

Create `src/sources/<name>.js`. It must export `meta = { id, label, kind: 'ats' | 'aggregator' }` and `async search(brief)`, which returns `{ jobs, errors }` with normalized jobs. Then register the file in `src/sources/index.js`. If a source fails, the failure is recorded in run health and never stops the run.

## Notes

- This is a single-user app that stores everything in local JSON files. It listens on localhost by default and has no login, so put authentication in front of it before you expose it to the internet.
- Verification fetches each aggregator posting's page. Some sites block automated requests. Those roles show as **Unconfirmed** instead of being dropped.
- Automation finds the roles. People still get you the interview.
