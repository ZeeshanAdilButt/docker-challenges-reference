// daftar-api: the API of the Daftar platform. Node 22 or newer, one dependency (pg).
//
//   GET  /health            200 always: the process is alive
//   GET  /ready             200 when the database answers, 503 when it does not
//   GET  /                  { app, version, hostname }
//   GET  /jobs              the last 20 jobs
//   POST /jobs              body {"text": "..."}: queue a job
//   GET  /stats             how many jobs are queued, working and done
//   GET  /alloc?mb=N        hold N MB of memory (for the starve experiment)
//   GET  /crash             answer, then exit with code 137 like a killed process (for the kill experiment)
//   POST /internal/claim    for the worker: take the next queued job (204 when there is none)
//   POST /internal/jobs/:id/done   for the worker: body {"result": "..."}
//
// A job that was claimed and not finished within STALE_CLAIM_S seconds is put back in the queue,
// so a worker that dies does not lose the job.
// SIGTERM or SIGINT: stop taking connections, finish the requests in flight, close the pool, exit 0 within DRAIN_MS.

import http from 'node:http';
import os from 'node:os';
import pg from 'pg';

const PORT = Number(process.env.PORT ?? 8080);
const VERSION = process.env.APP_VERSION ?? '1.0.0';
const DRAIN_MS = Number(process.env.DRAIN_MS ?? 500);
const STALE_CLAIM_S = Number(process.env.STALE_CLAIM_S ?? 8);
const MAX_ALLOC_MB = Number(process.env.MAX_ALLOC_MB ?? 1024);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 2000 });
pool.on('error', () => {}); // an idle connection that dies must not crash the process

let schemaReady = false;
let draining = false;
const held = [];

const log = (obj) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...obj })}\n`);

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
    id serial PRIMARY KEY,
    text text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    result text,
    claimed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  schemaReady = true;
}

function send(res, status, body) {
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...(draining ? { connection: 'close' } : {}) });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 4096) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('body is not JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /health') return send(res, 200, { status: 'ok' });
  if (route === 'GET /ready') {
    if (draining) return send(res, 503, { ready: false, reason: 'draining' });
    try {
      await pool.query('SELECT 1');
      await ensureSchema();
      return send(res, 200, { ready: true, version: VERSION });
    } catch {
      return send(res, 503, { ready: false, reason: 'database unreachable' });
    }
  }
  if (route === 'GET /') return send(res, 200, { app: 'daftar-api', version: VERSION, hostname: os.hostname() });

  if (route === 'GET /alloc') {
    const raw = url.searchParams.get('mb');
    const mb = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    if (mb === null || mb > MAX_ALLOC_MB) return send(res, 400, { error: `mb must be a whole number from 0 to ${MAX_ALLOC_MB}` });
    held.push(Buffer.alloc(mb * 1024 * 1024, 1)); // fill() touches every page, so the memory is really used
    return send(res, 200, { held_mb: held.reduce((s, b) => s + b.length, 0) / (1024 * 1024) });
  }

  if (route === 'GET /crash') {
    send(res, 200, { crashing: true });
    return void setTimeout(() => process.exit(137), 50);
  }

  if (route === 'POST /jobs') {
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 200) return send(res, 400, { error: 'text must be 1 to 200 characters' });
    await ensureSchema();
    const r = await pool.query('INSERT INTO jobs (text) VALUES ($1) RETURNING id', [text]);
    return send(res, 201, { id: r.rows[0].id });
  }

  if (route === 'GET /jobs') {
    await ensureSchema();
    const r = await pool.query('SELECT id, text, status, result FROM jobs ORDER BY id DESC LIMIT 20');
    return send(res, 200, { jobs: r.rows });
  }

  if (route === 'GET /stats') {
    await ensureSchema();
    const r = await pool.query('SELECT status, count(*)::int AS n FROM jobs GROUP BY status');
    const stats = { queued: 0, working: 0, done: 0 };
    for (const row of r.rows) stats[row.status] = row.n;
    return send(res, 200, stats);
  }

  if (route === 'POST /internal/claim') {
    await ensureSchema();
    await pool.query("UPDATE jobs SET status = 'queued' WHERE status = 'working' AND claimed_at < now() - make_interval(secs => $1)", [STALE_CLAIM_S]);
    const r = await pool.query(`UPDATE jobs SET status = 'working', claimed_at = now()
      WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, text`);
    return r.rows.length ? send(res, 200, { job: r.rows[0] }) : send(res, 204);
  }

  const done = /^\/internal\/jobs\/(\d+)\/done$/.exec(url.pathname);
  if (req.method === 'POST' && done) {
    const body = await readJson(req);
    const r = await pool.query("UPDATE jobs SET status = 'done', result = $2 WHERE id = $1 AND status = 'working' RETURNING id", [Number(done[1]), String(body.result ?? '')]);
    return r.rows.length ? send(res, 200, { id: r.rows[0].id }) : send(res, 404, { error: 'no such job in progress' });
  }

  return send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    log({ method: req.method, path: new URL(req.url, 'http://x').pathname, status: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10 });
    if (draining) setImmediate(() => server.closeIdleConnections());
  });
  handle(req, res).catch((e) => {
    const status = e.status ?? 500;
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'internal error' : e.message });
    if (status === 500) log({ event: 'error', message: e.message });
  });
});

function shutdown(signal) {
  if (draining) return;
  draining = true;
  log({ event: 'shutdown', signal, drain_ms: DRAIN_MS });
  server.close(() => pool.end().finally(() => process.exit(0)));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), DRAIN_MS).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, '0.0.0.0', () => log({ event: 'listening', port: server.address().port, version: VERSION }));
