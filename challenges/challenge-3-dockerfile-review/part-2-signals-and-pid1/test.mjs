// Challenge 3, part 2 test.
// Run: node --test challenges/challenge-3-dockerfile-review/part-2-signals-and-pid1/test.mjs
// It builds YOUR Dockerfile.signals with YOUR entrypoint.sh, starts it, runs `docker stop` and times it.
// It fails until node is PID 1 and receives SIGTERM. That is on purpose.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { workDir, tmp, rmTree, build, removeImages, imageExists } from '../lib/common.mjs';
import { makeContext, measureStop } from './stopcheck.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = workDir(here);
const TAG = 'dkr-c3-test-p2:1';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const work = tmp('p2t');
let built;
let result;

before(async () => {
  if (dockerDown) return;
  if (!imageExists('node:24-alpine')) throw new Error('node:24-alpine is not on this machine. Run challenge 0 first.');
  built = build({ tag: TAG, dockerfile: join(dir, 'Dockerfile.signals'), context: makeContext(join(work, 'ctx'), dir, ['entrypoint.sh']) });
  if (built.code === 0) result = await measureStop(TAG, 'test');
});

after(() => {
  if (!dockerDown) removeImages(TAG);
  rmTree(work);
});

test('Dockerfile.signals builds and the container answers /health', { skip: dockerDown }, () => {
  assert.equal(built.code, 0, built.out.split('\n').slice(-10).join('\n'));
  assert.ok(result, 'the container did not start');
});

test('node is PID 1', { skip: dockerDown }, () => {
  assert.match(result.pid1, /^node/, `PID 1 is "${result.pid1}". The script keeps running as PID 1 and node is its child. End the script with: exec node server.mjs`);
});

test('docker stop finishes in under 3 seconds (the default grace period is much longer)', { skip: dockerDown }, () => {
  assert.ok(result.stopMs < 3000, `docker stop took ${(result.stopMs / 1000).toFixed(1)} s. It waited for the grace period and then killed the container.`);
});

test('the container exits with code 0, not 137', { skip: dockerDown }, () => {
  assert.equal(result.exitCode, 0, `exit code ${result.exitCode}. 137 means SIGKILL: the signal never reached the service.`);
});

test('the service logged that it received SIGTERM', { skip: dockerDown }, () => {
  assert.ok(result.graceful, 'no shutdown line with signal SIGTERM in the log');
});

test('the entrypoint script still runs its own step', { skip: dockerDown }, () => {
  assert.ok(result.prepared, 'entrypoint.sh must still print "entrypoint: preparing" before it starts node');
});

test('the run.mjs facts show the broken variants and the fix', () => {
  const hint = 'Run: node challenges/challenge-3-dockerfile-review/part-2-signals-and-pid1/run.mjs';
  assert.equal(getFact('c3.p2.shell_cmd_exit_code'), 137, `The shell-form variant should end with 137. ${hint}`);
  assert.equal(getFact('c3.p2.entry_noexec_graceful'), false, hint);
  assert.equal(getFact('c3.p2.node_exec_graceful'), true, hint);
  assert.equal(getFact('c3.p2.init_flag_graceful'), false, `--init does not rescue a shell wrapper: tini signals the shell, the shell dies and node never hears. ${hint}`);
  assert.equal(getFact('c3.p2.init_node_graceful'), true, hint);
  assert.equal(getFact('c3.p2.mine_graceful'), true, `Your container did not shut down gracefully in the last run. ${hint}`);
  assert.ok(getFact('c3.p2.default_stop_s') > 1, hint);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(3), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.match(readFileSync(join(here, 'chart.svg'), 'utf8'), /role="img"/);
});
