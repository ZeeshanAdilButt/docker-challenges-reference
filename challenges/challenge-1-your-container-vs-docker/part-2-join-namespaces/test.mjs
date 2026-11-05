// Challenge 1, part 2 test.
// Run: node --test challenges/challenge-1-your-container-vs-docker/part-2-join-namespaces/test.mjs
// It fails until join.json is right and you have run run.mjs once. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { workDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Edit join.json, then run: node challenges/challenge-1-your-container-vs-docker/part-2-join-namespaces/run.mjs';
const flags = () => JSON.parse(readFileSync(join(workDir(here), 'join.json'), 'utf8'));

test('join.json has three true or false values', () => {
  const f = flags();
  for (const k of ['pid', 'network', 'ipc']) assert.equal(typeof f[k], 'boolean', `join.json: "${k}" must be true or false`);
});

test('join.json joins what the sidecar needs, and nothing more', () => {
  const f = flags();
  assert.equal(f.network, true, 'The sidecar must reach the app at 127.0.0.1:8080. Which namespace holds that address?');
  assert.equal(f.pid, true, 'The sidecar must see "node server.mjs" in its process list. Which namespace holds the process list?');
  assert.equal(f.ipc, false, 'Do not share the IPC namespace. Share only what the job needs.');
});

test('the facts come from a run with the current join.json', () => {
  const f = flags();
  assert.equal(getFact('c1.p2.join_pid'), f.pid, `The last run used a different join.json. ${hint}`);
  assert.equal(getFact('c1.p2.join_network'), f.network, `The last run used a different join.json. ${hint}`);
  assert.equal(getFact('c1.p2.join_ipc'), f.ipc, `The last run used a different join.json. ${hint}`);
});

test('in Docker and in your container the sidecar reaches the app, sees the process, and does not share IPC', () => {
  for (const side of ['docker', 'mini']) {
    assert.equal(getFact(`c1.p2.${side}_reaches_app`), true, `${side}: the sidecar cannot reach the app. ${hint}`);
    assert.equal(getFact(`c1.p2.${side}_sees_node`), true, `${side}: the sidecar cannot see the node process. ${hint}`);
    assert.equal(getFact(`c1.p2.${side}_shares_ipc`), false, `${side}: the sidecar shares the IPC namespace. ${hint}`);
  }
});

test('each flag changes one thing, in both worlds', () => {
  assert.equal(getFact('c1.p2.none_reaches_app'), false, `With nothing joined the sidecar must not reach the app. ${hint}`);
  assert.equal(getFact('c1.p2.net_only_reaches_app'), true, `--network alone should let the sidecar reach the app. ${hint}`);
  assert.equal(getFact('c1.p2.pid_only_sees_node'), true, `--pid alone should show the process. ${hint}`);
  assert.equal(getFact('c1.p2.shm_file_seen_with_ipc_join'), true, `Joining IPC should share /dev/shm. ${hint}`);
  assert.equal(getFact('c1.p2.private_ipc_join_refused'), true, `Joining a private IPC namespace should be refused. ${hint}`);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(1), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.match(readFileSync(join(here, 'chart.svg'), 'utf8'), /role="img"/);
});
