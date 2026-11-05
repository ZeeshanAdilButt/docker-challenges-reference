// Unit tests for the service, run inside the image build (target "test").
// They start the server on a free port and call three routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');

async function start(env = {}) {
  const child = spawn(process.execPath, [server], { env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
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
  const get = async (path) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: r.status, body: await r.json() };
  };
  return { get, stop: () => child.kill('SIGTERM') };
}

test('/health answers 200', async () => {
  const s = await start();
  try {
    assert.deepEqual(await s.get('/health'), { status: 200, body: { status: 'ok' } });
  } finally {
    s.stop();
  }
});

test('/ shows the version it was built with', async () => {
  const s = await start({ APP_VERSION: '9.9.9' });
  try {
    const r = await s.get('/');
    assert.equal(r.status, 200);
    assert.equal(r.body.version, '9.9.9');
  } finally {
    s.stop();
  }
});

test('/ready is 200 once the warm-up is over', async () => {
  const s = await start({ WARMUP_MS: '0' });
  try {
    assert.equal((await s.get('/ready')).status, 200);
  } finally {
    s.stop();
  }
});
