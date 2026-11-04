// Part 1 test. Run: node --test challenges/challenge-0-setup/part-1-check-your-toolkit/test.mjs
// It fails until you have run run.mjs once. That is on purpose: read the failure, then fix it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

test('Node is version 22 or newer', () => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22, `You have ${process.version}`);
});

test('toolkit/check-setup.mjs passes', () => {
  const r = spawnSync(process.execPath, [join(root, 'toolkit', 'check-setup.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `check-setup failed:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /^FAIL/m);
});

test('run.mjs saved your numbers in facts.json', () => {
  const hint = 'Run: node challenges/challenge-0-setup/part-1-check-your-toolkit/run.mjs';
  assert.ok(getFact('c0.p1.node_major') >= 22, `c0.p1.node_major is missing or too low. ${hint}`);
  assert.ok(getFact('c0.p1.docker_memory_gb') > 0, `c0.p1.docker_memory_gb is missing. ${hint}`);
  assert.ok(getFact('c0.p1.disk_free_gb') >= 2, `c0.p1.disk_free_gb is missing or below 2. ${hint}`);
  const ms = getFact('c0.p1.docker_call_ms');
  assert.ok(ms > 0 && ms < 30_000, `c0.p1.docker_call_ms should be between 0 and 30000, got ${ms}. ${hint}`);
});

test('chart.svg is an accessible chart', () => {
  const svg = readFileSync(join(here, 'chart.svg'), 'utf8');
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title id="t">/);
  assert.match(svg, /<desc id="d">/);
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});
