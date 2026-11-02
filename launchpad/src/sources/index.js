import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';
import * as ashby from './ashby.js';
import * as muse from './muse.js';
import * as adzuna from './adzuna.js';
import * as demo from './demo.js';

/** Every search source. Add a new one by exporting { meta, search(brief) → { jobs, errors?, skipped? } }. */
export const SOURCES = [demo, greenhouse, lever, ashby, muse, adzuna];
