// Challenge 8, part 3 test.
// Run: node --test challenges/challenge-8-compose-stack/part-3-ci-integration-test/test.mjs
// It fails until ci.mjs waits for the stack properly and always cleans up, and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-8-compose-stack/part-3-ci-integration-test/run.mjs';
const ci = () => readFileSync(join(filesDir(here), 'ci.mjs'), 'utf8');

test('static check: ci.mjs waits with --wait, not with a sleep', () => {
  const src = ci();
  assert.match(src, /'--wait'/, 'ci.mjs should start the stack with "up -d --wait" so Compose waits for the health checks.');
  assert.doesNotMatch(src, /Atomics\.wait|setTimeout|sleep/, 'ci.mjs waits a fixed time. A fixed wait is too short on a slow runner and too long on a fast one: remove it.');
});

test('static check: ci.mjs tears the stack down in a finally block', () => {
  const src = ci();
  const finallyPart = src.split('finally')[1] ?? '';
  assert.match(finallyPart, /'down'/, 'The "down" command must sit in a finally block, so it runs when the tests fail too.');
  assert.match(finallyPart, /'-v'/, 'Use "down -v" so the volumes go too.');
  assert.doesNotMatch(src.split('finally')[0].split('try')[0] ?? '', /process\.exit/, 'Do not call process.exit before the clean-up has run.');
});

test('the pipeline is reliable (facts from run.mjs)', () => {
  assert.equal(getFact('c8.p3.normal_pass_count'), 3, `A normal run failed. ${hint}`);
  assert.equal(getFact('c8.p3.slow_start_passes'), true, `The pipeline did not wait for a slow api. ${hint}`);
  assert.equal(getFact('c8.p3.passing_run_leftover_containers_count'), 0, `A passing run left containers behind. ${hint}`);
});

test('a failing test fails the pipeline and still cleans up (facts from run.mjs)', () => {
  assert.equal(getFact('c8.p3.failing_run_exit_nonzero'), true, `A failing test must make the pipeline fail. ${hint}`);
  assert.equal(getFact('c8.p3.failing_run_leftover_containers_count'), 0, `A failing run left containers running. ${hint}`);
});

test('the workflow file pins every action to a full commit SHA', () => {
  const yml = readFileSync(join(here, 'ci.yml'), 'utf8');
  const uses = [...yml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 1);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} is not pinned to a full commit SHA`);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(8), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
