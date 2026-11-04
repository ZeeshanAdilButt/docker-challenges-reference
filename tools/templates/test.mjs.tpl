// Challenge @@N@@, part @@M@@ test.
// Run: node --test challenges/@@CHALLENGE_DIR@@/@@PART_DIR@@/test.mjs
// It fails until you have run run.mjs once. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/@@CHALLENGE_DIR@@/@@PART_DIR@@/run.mjs';

test('run.mjs saved its facts', () => {
  // TODO: check the real facts here.
  assert.ok(getFact('c@@N@@.p@@M@@.example_s') > 0, `c@@N@@.p@@M@@.example_s is missing. ${hint}`);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(@@N@@), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
