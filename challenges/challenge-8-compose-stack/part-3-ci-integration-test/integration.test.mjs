// The integration test the pipeline runs against the live stack.
// It talks to the api at API_URL and expects the version EXPECT_VERSION (default 1).
import test from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.API_URL;
const expected = process.env.EXPECT_VERSION ?? '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (path, method = 'GET') => {
  const res = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(3000) });
  return { status: res.status, json: await res.json() };
};

test('the api is ready: database and cache both answer', async () => {
  const r = await call('/ready');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { db: true, cache: true });
});

test('the api reports the version this pipeline is meant to test', async () => {
  const r = await call('/stats');
  assert.equal(r.json.version, expected);
});

test('a note is written to the database', async () => {
  const before = (await call('/stats')).json.notes;
  assert.equal((await call('/notes?body=from-ci', 'POST')).status, 201);
  assert.equal((await call('/stats')).json.notes, before + 1);
});

test('jobs go through the cache and the worker into the database', async () => {
  const before = (await call('/stats')).json.jobs_done;
  assert.equal((await call('/jobs?n=3', 'POST')).status, 202);
  let done = before;
  for (let i = 0; i < 40 && done < before + 3; i++) {
    await sleep(250);
    done = (await call('/stats')).json.jobs_done;
  }
  assert.equal(done, before + 3);
});
