// Challenge 10, part 1 test.
// Run: node --test challenges/challenge-10-fill-the-box/part-1-hit-the-limits/test.mjs
// It reads limits.json and runs the runaway jobs live in capped containers (about 20 seconds).
// With DKR_TARGET=reference it tests reference/limits.json instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, cleanup, leftovers } from '../../../toolkit/docker.js';
import { gradeLimits, targetDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const limits = JSON.parse(readFileSync(join(targetDir(here), 'limits.json'), 'utf8'));

let graded;
const grade = () => (graded ??= gradeLimits(limits));

test('limits.json has the three numbers', () => {
  for (const key of ['heap_mb', 'pids', 'nofile']) assert.ok(Number.isInteger(limits[key]) && limits[key] >= 0, `limits.json needs a whole number for ${key}`);
});

for (const id of ['legit job still works', 'runaway heap stops before the kernel', 'fork loop is contained', 'open-file leak is contained']) {
  test(`live: ${id}`, { skip: dockerDown }, () => {
    const c = grade().find((x) => x.id === id);
    assert.ok(c.ok, `${c.text}. Edit limits.json and run: node challenges/challenge-10-fill-the-box/part-1-hit-the-limits/run.mjs`);
  });
}

test('nothing with the challenge label is left in Docker', { skip: dockerDown }, () => {
  grade();
  cleanup(10);
  assert.deepEqual(leftovers(10), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});
