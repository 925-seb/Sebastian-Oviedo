// Launchpad server: JSON API + static dashboard + daily scheduler. Zero dependencies (Node ≥ 18).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as svc from './src/service.js';
import { startScheduler, nextRunAt } from './src/scheduler.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const log = (m) => console.log(`[launchpad] ${m}`);

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

const routes = [
  ['GET', /^\/api\/dashboard$/, async () => {
    const d = await svc.getDashboard();
    d.nextRunAt = nextRunAt(d.brief.schedule)?.toISOString() || null;
    return d;
  }],
  ['GET', /^\/api\/brief$/, () => svc.getBrief()],
  ['PUT', /^\/api\/brief$/, async (req) => {
    const brief = await svc.saveBrief(await readBody(req));
    startScheduler(log); // re-arm with the (possibly new) time
    return brief;
  }],
  ['POST', /^\/api\/questionnaire$/, async (req) => {
    const brief = await svc.submitQuestionnaire(await readBody(req));
    startScheduler(log); // the refresh rate may have changed
    return brief;
  }],
  ['POST', /^\/api\/run$/, async () => {
    const run = await svc.runNow('manual', log);
    return { id: run.id, status: run.status, counts: run.counts, warnings: run.warnings };
  }],
  ['GET', /^\/api\/jobs\/([^/]+)$/, async (_req, [id]) => (await svc.getJob(decodeURIComponent(id))) || notFound()],
  ['PATCH', /^\/api\/jobs\/([^/]+)$/, async (req, [id]) => (await svc.updateJob(decodeURIComponent(id), await readBody(req))) || notFound()],
  ['POST', /^\/api\/jobs\/([^/]+)\/dismiss$/, async (req, [id]) => (await svc.dismissJob(decodeURIComponent(id), (await readBody(req)).reason)) || notFound()],
  ['GET', /^\/api\/memory$/, () => svc.getMemory()],
  ['GET', /^\/api\/resume$/, () => svc.getResume()],
  ['POST', /^\/api\/resume$/, async (req) => svc.uploadResume(await readBody(req, 7_500_000))], // base64 of a ≤5 MB file
  ['DELETE', /^\/api\/resume$/, () => svc.deleteResume()],
  ['PATCH', /^\/api\/rules\/([^/]+)$/, async (req, [id]) => svc.setRuleMode(id, (await readBody(req)).mode)],
];

function notFound() { throw Object.assign(new Error('Not found'), { status: 404 }); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/export.csv' && req.method === 'GET') {
      res.setHeader('content-disposition', 'attachment; filename="launchpad-tracker.csv"');
      return send(res, 200, await svc.exportCsv(), 'text/csv; charset=utf-8');
    }
    if (url.pathname.startsWith('/api/')) {
      // simple CSRF guard: state-changing calls must be same-origin JSON
      if (req.method !== 'GET' && !/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Use application/json' });
      for (const [method, re, handler] of routes) {
        const m = re.exec(url.pathname);
        if (m && method === req.method) return send(res, 200, await handler(req, m.slice(1)));
      }
      return send(res, 404, { error: 'Not found' });
    }
    // static files
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
    const body = await readFile(file).catch(() => null);
    if (!body) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: status === 500 ? 'Something went wrong' : e.message, ...(e.errors && { errors: e.errors }) });
  }
});

server.listen(PORT, HOST, () => {
  log(`dashboard on http://${HOST}:${PORT}${process.env.LAUNCHPAD_DEMO === '1' ? '  (demo mode)' : ''}`);
  startScheduler(log).catch((e) => log(`scheduler error: ${e.message}`));
});
