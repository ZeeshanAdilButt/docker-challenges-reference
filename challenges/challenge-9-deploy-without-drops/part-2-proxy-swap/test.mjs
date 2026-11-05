// Challenge 9, part 2 test.
// Run: node --test challenges/challenge-9-deploy-without-drops/part-2-proxy-swap/test.mjs
// It fails until swap.json makes the swap lose no request and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-9-deploy-without-drops/part-2-proxy-swap/run.mjs';

test('static check: swap.json waits for green to be ready and lets blue drain', () => {
  const s = JSON.parse(readFileSync(join(filesDir(here), 'swap.json'), 'utf8'));
  assert.equal(s.healthGate, true, 'healthGate is off. Point nginx at green only after green answers /ready with 200.');
  assert.ok(s.drainMs >= 500, `drainMs is ${s.drainMs}. Give blue at least 500 ms to finish its requests after nginx stops sending new ones.`);
});

test('the swap lost no request, and both versions served traffic (facts from run.mjs)', () => {
  assert.equal(getFact('c9.p2.yours_failed_count'), 0, `${getFact('c9.p2.yours_failed_count')} requests failed during your swap. ${hint}`);
  assert.ok(getFact('c9.p2.yours_version1_count') > 0 && getFact('c9.p2.yours_version2_count') > 0, `Both blue and green must have answered requests. ${hint}`);
  assert.ok(getFact('c9.p2.yours_total_count') > 100, 'The load generator sent too few requests to prove anything');
});

test('the careless control is measured too (facts from run.mjs)', () => {
  assert.ok(getFact('c9.p2.control_total_count') > 100, hint);
  assert.ok(getFact('c9.p2.control_failed_count') >= 0, hint);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(9), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
