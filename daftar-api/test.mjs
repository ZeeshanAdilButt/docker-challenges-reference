// Tests for daftar-api. Starts the server on a free port and calls every route with fetch.
// Run: node --test daftar-api/test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');

// Start the service with PORT=0 so the system picks a free port. Read the port from the first log line.
async function start(env = {}) {
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });
  const lines = [];
  let buffer = '';
  let onLine = () => {};
  child.stdout.setEncoding('utf8').on('data', (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line) {
        lines.push(JSON.parse(line));
        onLine();
      }
    }
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const listening = await new Promise((resolve, reject) => {
    const check = () => {
      const l = lines.find((x) => x.event === 'listening');
      if (l) resolve(l);
    };
    onLine = check;
    check();
    child.on('exit', () => reject(new Error('server exited before it was listening')));
    setTimeout(() => reject(new Error('server did not start in 5 s')), 5000).unref();
  });
  const base = `http://127.0.0.1:${listening.port}`;
  const get = (path) => fetch(base + path);
  const json = async (path, init) => {
    const r = await fetch(base + path, init);
    return { status: r.status, body: await r.json() };
  };
  const stop = async () => {
    child.kill('SIGTERM');
    return exited;
  };
  return { child, lines, base, get, json, stop, exited };
}

test('GET /health is 200', async () => {
  const s = await start();
  try {
    assert.deepEqual(await s.json('/health'), { status: 200, body: { status: 'ok' } });
  } finally {
    await s.stop();
  }
});

test('GET / returns app, version, hostname and a request counter', async () => {
  const s = await start({ APP_VERSION: '2.3.4' });
  try {
    const a = await s.json('/');
    const b = await s.json('/');
    assert.equal(a.status, 200);
    assert.equal(a.body.app, 'daftar-api');
    assert.equal(a.body.version, '2.3.4');
    assert.equal(typeof a.body.hostname, 'string');
    assert.equal(a.body.requests, 1);
    assert.equal(b.body.requests, 2);
  } finally {
    await s.stop();
  }
});

test('GET /ready is 503 during warm-up and 200 after', async () => {
  const s = await start({ WARMUP_MS: '400' });
  try {
    assert.equal((await s.json('/ready')).status, 503);
    assert.equal((await s.json('/health')).status, 200);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await s.json('/ready')).status, 200);
  } finally {
    await s.stop();
  }
});

test('POST /drain makes /ready answer 503, /health stays 200', async () => {
  const s = await start();
  try {
    assert.equal((await s.json('/ready')).status, 200);
    assert.deepEqual(await s.json('/drain', { method: 'POST' }), { status: 200, body: { draining: true } });
    assert.equal((await s.json('/ready')).status, 503);
    assert.equal((await s.json('/health')).status, 200);
  } finally {
    await s.stop();
  }
});

test('GET /alloc holds memory and rejects bad input', async () => {
  const s = await start();
  try {
    const before = (await s.json('/pid')).body.pid;
    assert.ok(before > 0);
    const a = await s.json('/alloc?mb=8');
    assert.deepEqual(a, { status: 200, body: { allocated_mb: 8, held_mb: 8 } });
    const b = await s.json('/alloc?mb=4');
    assert.equal(b.body.held_mb, 12);
    assert.equal((await s.json('/alloc?mb=abc')).status, 400);
    assert.equal((await s.json('/alloc')).status, 400);
    assert.equal((await s.json('/alloc?mb=99999')).status, 400);
  } finally {
    await s.stop();
  }
});

test('GET /burn spins about as long as asked', async () => {
  const s = await start();
  try {
    const t0 = Date.now();
    const r = await s.json('/burn?ms=250');
    const took = Date.now() - t0;
    assert.deepEqual(r, { status: 200, body: { burned_ms: 250 } });
    assert.ok(took >= 240, `took ${took} ms`);
    assert.equal((await s.json('/burn?ms=-5')).status, 400);
  } finally {
    await s.stop();
  }
});

test('GET /slow answers after the delay', async () => {
  const s = await start();
  try {
    const t0 = Date.now();
    const r = await s.json('/slow?ms=200');
    assert.deepEqual(r, { status: 200, body: { slept_ms: 200 } });
    assert.ok(Date.now() - t0 >= 190);
    assert.equal((await s.json('/slow?ms=x')).status, 400);
  } finally {
    await s.stop();
  }
});

test('GET /break makes the next requests return 500', async () => {
  const s = await start();
  try {
    assert.deepEqual(await s.json('/break?n=2'), { status: 200, body: { broken_requests: 2 } });
    assert.equal((await s.json('/health')).status, 500);
    assert.equal((await s.json('/')).status, 500);
    assert.equal((await s.json('/health')).status, 200, 'the third request works again');

    await s.json('/break');
    assert.equal((await s.json('/health')).status, 500);
    assert.equal((await s.json('/ready')).status, 500);
    assert.equal((await s.json('/health')).status, 500, 'without n it stays broken');
  } finally {
    await s.stop();
  }
});

test('GET /pid returns pid and ppid', async () => {
  const s = await start();
  try {
    const r = await s.json('/pid');
    assert.equal(r.status, 200);
    assert.equal(r.body.pid, s.child.pid);
    assert.equal(r.body.ppid, process.pid);
  } finally {
    await s.stop();
  }
});

test('unknown route is 404', async () => {
  const s = await start();
  try {
    assert.equal((await s.json('/nope')).status, 404);
    assert.equal((await s.json('/health', { method: 'POST' })).status, 404);
  } finally {
    await s.stop();
  }
});

test('every request writes one JSON log line', async () => {
  const s = await start();
  try {
    await s.get('/health');
    await s.get('/nope');
    await new Promise((r) => setTimeout(r, 100));
    const reqs = s.lines.filter((l) => l.path);
    assert.deepEqual(reqs.map((l) => [l.method, l.path, l.status]), [['GET', '/health', 200], ['GET', '/nope', 404]]);
    assert.equal(typeof reqs[0].ms, 'number');
    assert.match(reqs[0].ts, /^\d{4}-\d\d-\d\dT/);
  } finally {
    await s.stop();
  }
});

// SIGTERM cannot be sent to a Node child on Windows (kill() ends it at once), so the signal tests need Linux or macOS.
const signals = process.platform === 'win32' && 'SIGTERM is not delivered to child processes on Windows. Run these in Docker or WSL2.';

test('SIGTERM finishes the request in flight, then exits 0', { skip: signals }, async () => {
  const s = await start({ DRAIN_MS: '2000' });
  const slow = s.json('/slow?ms=600');
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  s.child.kill('SIGTERM');
  const reply = await slow;
  const { code } = await s.exited;
  assert.equal(reply.status, 200, 'the slow request was finished');
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 1500);
  assert.ok(s.lines.some((l) => l.event === 'shutdown' && l.signal === 'SIGTERM'));
});

test('SIGTERM does not wait longer than DRAIN_MS', { skip: signals }, async () => {
  const s = await start({ DRAIN_MS: '300' });
  s.json('/slow?ms=5000').catch(() => {});
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  s.child.kill('SIGTERM');
  const { code } = await s.exited;
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 1200, `took ${Date.now() - t0} ms`);
});
