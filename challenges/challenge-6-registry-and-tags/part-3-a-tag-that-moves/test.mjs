// Challenge 6, part 3 test.
// Run: node --test challenges/challenge-6-registry-and-tags/part-3-a-tag-that-moves/test.mjs
// It fails until two servers deployed from the same release run the same bytes, and a rollback goes back one release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-6-registry-and-tags/part-3-a-tag-that-moves/run.mjs';
const f = (what) => getFact(`c6.p3.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('tag_moved'), undefined, `No facts yet. ${hint}`);
});

test('the tag really moved while server A kept running', () => {
  assert.equal(f('tag_moved'), true);
});

test('deploy.mjs names the image by digest', () => {
  assert.equal(f('deploys_by_digest'), true, 'imageRef() builds a reference with a tag. A tag can move. Use repo@digest.');
});

test('two servers deployed from the same release run the same code', () => {
  assert.equal(f('same_code'), true, `Server A runs ${f('a_version')} and server B runs ${f('b_version')}. Same release, different bytes.`);
  assert.equal(f('same_image_id'), true);
});

test('a running container can be traced to a commit through its labels', () => {
  assert.equal(f('trace_revision_found'), true);
});

test('a rollback goes to the release before the bad one, and the server is healthy', () => {
  assert.equal(f('rollback_to_previous'), true, `After the rollback the server runs ${f('rollback_version')}. rollbackTarget() must return the release before the newest one.`);
  assert.equal(f('rollback_healthy'), true);
  assert.ok(f('rollback_s') > 0);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(6), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
