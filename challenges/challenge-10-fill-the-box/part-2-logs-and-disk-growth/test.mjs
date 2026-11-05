// Challenge 10, part 2 test.
// Run: node --test challenges/challenge-10-fill-the-box/part-2-logs-and-disk-growth/test.mjs
// It reads settings.json and checks log rotation and tmpfs size live (about 30 seconds).
// With DKR_TARGET=reference it tests reference/settings.json instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, cleanup, leftovers } from '../../../toolkit/docker.js';
import { gradeSettings, parseSizeSpec, targetDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const settings = JSON.parse(readFileSync(join(targetDir(here), 'settings.json'), 'utf8'));
const hint = 'Edit settings.json and run: node challenges/challenge-10-fill-the-box/part-2-logs-and-disk-growth/run.mjs';

let graded;
const grade = () => (graded ??= gradeSettings(settings));

test('parseSizeSpec reads docker sizes', () => {
  assert.equal(parseSizeSpec('2m'), 2 * 1024 * 1024);
  assert.equal(parseSizeSpec('512k'), 512 * 1024);
  assert.ok(Number.isNaN(parseSizeSpec('')));
});

for (const id of ['log rotation is set', 'log disk use stays inside the budget', 'newest log line is kept', 'scratch space fits the real job', 'runaway writer gets "no space", not a kill']) {
  test(`live: ${id}`, { skip: dockerDown }, () => {
    const c = grade().checks.find((x) => x.id === id);
    assert.ok(c.ok, `${c.text}. ${hint}`);
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
