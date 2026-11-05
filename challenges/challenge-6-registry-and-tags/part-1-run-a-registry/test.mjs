// Challenge 6, part 1 test.
// Run: node --test challenges/challenge-6-registry-and-tags/part-1-run-a-registry/test.mjs
// It fails until the registry listens only on this machine, keeps its data in a volume and allows deletes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-6-registry-and-tags/part-1-run-a-registry/run.mjs';
const f = (what) => getFact(`c6.p1.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('survives_recreate'), undefined, `No facts yet. ${hint}`);
});

test('the registry listens on this machine only', () => {
  assert.equal(f('bound_host'), '127.0.0.1', `The registry is published on ${f('bound_host')}. It has no password. Publish it as 127.0.0.1::5000.`);
});

test('the images survive when the registry container is removed and created again', () => {
  assert.equal(f('survives_recreate'), true, 'The catalog was empty after the container was recreated. Mount a volume on /var/lib/registry.');
});

test('deleting manifests is allowed (part 2 needs it)', () => {
  assert.equal(f('delete_enabled'), true, 'Set the environment variable REGISTRY_STORAGE_DELETE_ENABLED=true with -e.');
});

test('push and pull worked, and the second image shared a layer with the first', () => {
  assert.ok(f('push2_layers_reused') >= 1, 'The second push reused no layer.');
  assert.ok(f('blobs_after_push2') - f('blobs_after_push1') < f('blobs_after_push1'), 'The second image added as many blobs as the first. Layers should be shared.');
  assert.ok(f('pull_s') > 0);
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
