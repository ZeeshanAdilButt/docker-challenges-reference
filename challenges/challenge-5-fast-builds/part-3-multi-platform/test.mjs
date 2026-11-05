// Challenge 5, part 3 test (stretch).
// Run: node --test challenges/challenge-5-fast-builds/part-3-multi-platform/test.mjs
// It fails until the bake file and the workflow describe a build for amd64 and arm64.
// The arm64 build itself is learner-only and is not run by the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-5-fast-builds/part-3-multi-platform/run.mjs';
const f = (what) => getFact(`c5.p3.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('bake_platforms'), undefined, `No facts yet. ${hint}`);
});

test('the bake file builds for amd64 and arm64', () => {
  assert.equal(f('bake_has_amd64'), true, 'platforms in target "app" must include linux/amd64');
  assert.equal(f('bake_has_arm64'), true, 'platforms in target "app" must include linux/arm64. An arm64 server (or an Apple silicon laptop) cannot run an amd64-only image without emulation.');
});

test('the bake file has a target that loads one platform into your local Docker', () => {
  assert.equal(f('bake_local_target'), true, 'Add a target "app-local" that inherits from "app", sets platforms = [] and output = ["type=docker"].');
});

test('workflow: every action is pinned to a full commit SHA', () => {
  assert.ok(f('workflow_actions') >= 3);
  assert.equal(f('workflow_unpinned'), 0, `${f('workflow_unpinned')} action(s) use a tag. Pin each to a 40 character SHA: gh api repos/<owner>/<repo>/commits/<tag> -q .sha`);
});

test('workflow: QEMU is set up and the build asks for arm64', () => {
  assert.equal(f('workflow_has_qemu'), true, 'Add docker/setup-qemu-action (pinned) before setup-buildx-action.');
  assert.equal(f('workflow_platforms_arm64'), true, 'Set platforms: linux/amd64,linux/arm64 on the build step.');
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
