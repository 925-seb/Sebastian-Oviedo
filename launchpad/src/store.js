// Step 5 storage — the memory log lives in plain JSON files under DATA_DIR, so it's easy to inspect,
// back up, or hand to another tool. Writes are atomic (temp file + rename).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function dataDir() {
  return path.resolve(process.env.LAUNCHPAD_DATA_DIR || path.join(ROOT, 'data'));
}

const FILES = {
  brief: 'brief.json', // the brief
  jobs: 'jobs.json', // every role ever surfaced: id → record (status, score, firstSeen, lastSeen…)
  runs: 'runs.json', // run log, newest first; old runs condensed into summaries
  learned: 'learned.json', // dismissal reason counts → standing rules
};

export async function load(name, fallback) {
  const file = path.join(dataDir(), FILES[name]);
  if (!existsSync(file)) return structuredClone(fallback);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${file}: ${e.message}`);
  }
}

const queues = new Map();
export async function save(name, value) {
  const dir = dataDir();
  const file = path.join(dir, FILES[name]);
  // serialize writes per file so concurrent saves can't interleave
  const prev = queues.get(file) || Promise.resolve();
  const next = prev.then(async () => {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2));
    await rename(tmp, file);
  });
  queues.set(file, next.catch(() => {}));
  return next;
}

export const EMPTY = {
  jobs: {},
  runs: { runs: [], summaries: [] },
  learned: { reasonCounts: {}, companyCounts: {}, promoted: [] },
};
