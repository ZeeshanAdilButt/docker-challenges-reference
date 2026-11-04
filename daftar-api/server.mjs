// daftar-api: a tiny HTTP service used by many challenges.
// Node 24, no dependencies. Listens on PORT (default 8080).
//
// Routes
//   GET  /health           200 always (unless /break was used)
//   GET  /ready            200, or 503 while draining or before warm-up
//   GET  /                 JSON: app, version, hostname, requests served
//   POST /drain            start draining: /ready now answers 503
//   GET  /alloc?mb=N       hold N MB of memory
//   GET  /burn?ms=N        spin the CPU for N ms
//   GET  /slow?ms=N        answer after N ms
//   GET  /break[?n=N]      the next N requests (default: all) return 500
//   GET  /pid              process.pid and process.ppid
//
// Every request writes one JSON line to stdout.
// SIGTERM or SIGINT: stop taking new connections, finish the requests in flight,
// exit 0 within DRAIN_MS (default 500).

import http from 'node:http';
import os from 'node:os';

const PORT = Number(process.env.PORT ?? 8080);
const DRAIN_MS = Number(process.env.DRAIN_MS ?? 500);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 0);
const VERSION = process.env.APP_VERSION ?? '1.0.0';
const MAX_ALLOC_MB = Number(process.env.MAX_ALLOC_MB ?? 1024);
const MAX_MS = 60_000;

const startedAt = Date.now();
let requests = 0;
let draining = false;
let shuttingDown = false;
let brokenLeft = 0; // number of requests still failing; Infinity means all
const held = []; // memory kept by /alloc so it is not freed

const log = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

function send(res, status, body) {
  const text = JSON.stringify(body);
  const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) };
  if (shuttingDown) headers.connection = 'close'; // tell clients not to reuse this connection
  res.writeHead(status, headers);
  res.end(text);
}

// Read ?name=N as a whole number between 0 and max. Returns null if it is missing or bad.
function numberParam(url, key, max) {
  const raw = url.searchParams.get(key);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n <= max ? n : null;
}

function burn(ms) {
  const end = Date.now() + ms;
  let x = 0;
  while (Date.now() < end) x += Math.sqrt(Math.random());
  return x;
}

const isReady = () => !draining && Date.now() - startedAt >= WARMUP_MS;

const server = http.createServer((req, res) => {
  const t0 = process.hrtime.bigint();
  requests += 1;
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;

  res.on('finish', () => {
    log({
      ts: new Date().toISOString(),
      method: req.method,
      path: url.pathname,
      status: res.statusCode,
      ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10,
    });
    // a kept-alive connection that just went idle would hold the server open
    if (shuttingDown) setImmediate(() => server.closeIdleConnections());
  });

  // /break itself and /drain always work, so you can still steer a broken service.
  if (brokenLeft > 0 && route !== 'GET /break' && route !== 'POST /drain') {
    if (brokenLeft !== Infinity) brokenLeft -= 1;
    return send(res, 500, { error: 'broken on purpose' });
  }

  switch (route) {
    case 'GET /health':
      return send(res, 200, { status: 'ok' });

    case 'GET /ready':
      return isReady() ? send(res, 200, { ready: true }) : send(res, 503, { ready: false, draining });

    case 'GET /':
      return send(res, 200, { app: 'daftar-api', version: VERSION, hostname: os.hostname(), requests });

    case 'POST /drain':
      draining = true;
      return send(res, 200, { draining: true });

    case 'GET /alloc': {
      const mb = numberParam(url, 'mb', MAX_ALLOC_MB);
      if (mb === null) return send(res, 400, { error: `mb must be a whole number from 0 to ${MAX_ALLOC_MB}` });
      // fill() touches every page, so the memory is really used
      held.push(Buffer.alloc(mb * 1024 * 1024, 1));
      const heldMb = held.reduce((sum, b) => sum + b.length, 0) / (1024 * 1024);
      return send(res, 200, { allocated_mb: mb, held_mb: heldMb });
    }

    case 'GET /burn': {
      const ms = numberParam(url, 'ms', MAX_MS);
      if (ms === null) return send(res, 400, { error: `ms must be a whole number from 0 to ${MAX_MS}` });
      burn(ms);
      return send(res, 200, { burned_ms: ms });
    }

    case 'GET /slow': {
      const ms = numberParam(url, 'ms', MAX_MS);
      if (ms === null) return send(res, 400, { error: `ms must be a whole number from 0 to ${MAX_MS}` });
      return void setTimeout(() => send(res, 200, { slept_ms: ms }), ms);
    }

    case 'GET /break': {
      const n = url.searchParams.has('n') ? numberParam(url, 'n', 1_000_000) : Infinity;
      if (n === null) return send(res, 400, { error: 'n must be a whole number' });
      brokenLeft = n;
      return send(res, 200, { broken_requests: n === Infinity ? 'all' : n });
    }

    case 'GET /pid':
      return send(res, 200, { pid: process.pid, ppid: process.ppid });

    default:
      return send(res, 404, { error: 'not found' });
  }
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  draining = true;
  log({ ts: new Date().toISOString(), event: 'shutdown', signal, drain_ms: DRAIN_MS });
  server.close(() => process.exit(0)); // all requests finished
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), DRAIN_MS); // give up waiting after DRAIN_MS
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, '0.0.0.0', () => {
  log({ ts: new Date().toISOString(), event: 'listening', port: server.address().port, version: VERSION, pid: process.pid });
});
