// Unit tests for daftar-api. They need no database: they start the server on a free port with a database address
// that nobody listens on, and check what must hold even then. Run: node --test test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');

async function start(env = {}) {
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, PORT: '0', DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.setEncoding('utf8').on('data', (d) => {
      buf += d;
      const line = buf.split('\n').find((l) => l.includes('"listening"'));
      if (line) resolve(JSON.parse(line).port);
    });
    child.on('exit', () => reject(new Error('server exited before it was listening')));
    setTimeout(() => reject(new Error('server did not start in 5 s')), 5000).unref();
  });
  const call = async (path, init) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, init);
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  return { call, child, exited };
}

async function stopped(s) {
  s.child.kill('SIGTERM');
  await s.exited;
}

test('/health answers 200 even without a database', async () => {
  const s = await start();
  try {
    assert.deepEqual(await s.call('/health'), { status: 200, body: { status: 'ok' } });
  } finally {
    await stopped(s);
  }
});

test('/ready answers 503 while the database is unreachable', async () => {
  const s = await start();
  try {
    const r = await s.call('/ready');
    assert.equal(r.status, 503);
    assert.equal(r.body.ready, false);
  } finally {
    await stopped(s);
  }
});

test('/ shows the version it was started with', async () => {
  const s = await start({ APP_VERSION: '7.7.7' });
  try {
    const r = await s.call('/');
    assert.equal(r.body.version, '7.7.7');
    assert.equal(r.body.app, 'daftar-api');
  } finally {
    await stopped(s);
  }
});

test('POST /jobs refuses an empty text before it touches the database', async () => {
  const s = await start();
  try {
    const r = await s.call('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '   ' }) });
    assert.equal(r.status, 400);
  } finally {
    await stopped(s);
  }
});

test('SIGTERM stops the server with exit code 0 within a second', { skip: process.platform === 'win32' && 'Windows cannot send SIGTERM; this test runs inside the image build' }, async () => {
  const s = await start();
  const t0 = Date.now();
  s.child.kill('SIGTERM');
  const { code } = await s.exited;
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});
