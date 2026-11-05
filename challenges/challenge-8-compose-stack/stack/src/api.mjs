// The api of the stack. Node 24, no dependencies.
//   GET  /health        200 as long as the process is alive
//   GET  /ready         200 when Postgres and Valkey both answer, 503 otherwise
//   GET  /stats         { notes, jobs_done, queue }
//   POST /notes?body=x  insert a note
//   POST /jobs?n=5      put n jobs on the Valkey list "jobs" (the worker takes them)
// Each request opens its own short connection, so a database that comes back is found again at once.

import http from 'node:http';
import os from 'node:os';
import { env, log, openCache, openDb, withRetry } from './common.mjs';
import { quote } from './pg.mjs';

const PORT = Number(process.env.PORT ?? 8080);

async function withDb(fn) {
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

// A dependency check must never wait longer than a health check can. A stopped container's name can take
// seconds to fail to resolve, so every check has its own time limit.
const within = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
const check = async (fn) => {
  try { await within(fn(), 1500); return true; } catch { return false; }
};

async function ready() {
  const [db, cache] = await Promise.all([
    check(() => withDb((d) => d.query('SELECT 1'))),
    check(async () => { const c = await openCache(); try { await c.cmd('PING'); } finally { c.close(); } }),
  ]);
  return { db, cache };
}

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /health') return send(res, 200, { status: 'ok', version: env.version, hostname: os.hostname() });
    if (route === 'GET /ready') {
      const r = await ready();
      return send(res, r.db && r.cache ? 200 : 503, r);
    }
    if (route === 'GET /stats') {
      const [notes, done] = await withDb(async (db) => [(await db.query('SELECT count(*) FROM notes'))[0][0], (await db.query('SELECT count(*) FROM jobs_done'))[0][0]]);
      const c = await openCache();
      const queue = await c.cmd('LLEN', 'jobs');
      c.close();
      return send(res, 200, { notes: Number(notes), jobs_done: Number(done), queue, version: env.version });
    }
    if (route === 'POST /notes') {
      await withDb((db) => db.query(`INSERT INTO notes (body) VALUES (${quote(url.searchParams.get('body') ?? 'note')})`));
      return send(res, 201, { ok: true });
    }
    if (route === 'POST /jobs') {
      const n = Math.min(Number(url.searchParams.get('n') ?? 1), 1000);
      const c = await openCache();
      for (let i = 0; i < n; i++) await c.cmd('LPUSH', 'jobs', `job-${Date.now()}-${i}`);
      c.close();
      return send(res, 202, { pushed: n });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    log({ event: 'request-failed', route, error: e.code ?? e.message });
    return send(res, 500, { error: e.code ?? e.message });
  }
});

// At start-up the api needs the database once. With STARTUP_RETRIES=0 (the default) a database that is not ready
// yet makes the api exit. Retrying is the app's half of "wait for the database".
try {
  await withRetry('database at start-up', () => withDb((db) => db.query('SELECT 1')));
} catch (e) {
  log({ event: 'fatal', message: 'database not reachable at start-up', error: e.code ?? e.message });
  process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => log({ event: 'listening', port: PORT, version: env.version }));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
