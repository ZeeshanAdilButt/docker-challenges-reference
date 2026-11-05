// Challenge 4, part 3 test.
// Run: node --test challenges/challenge-4-slim-lock-drop-root/part-3-reproducible-build/test.mjs
// It fails until two builds of the same source give the same image digest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-4-slim-lock-drop-root/part-3-reproducible-build/run.mjs';
const f = (what) => getFact(`c4.p3.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('digest_equal'), undefined, `No facts yet. ${hint}`);
});

test('the base image is pinned by digest', () => {
  assert.equal(f('base_pinned'), true, 'The FROM line has a tag only. A tag can move. Add @sha256:... after it (docker buildx imagetools inspect node:24-alpine shows the digest).');
});

test('no layer differs between two builds of the same source', () => {
  assert.equal(
    f('layers_differ'),
    0,
    `${f('layers_differ')} layer(s) differ. Read the layer table that run.mjs prints: a RUN that writes the date, or file modified times from COPY, change a layer.`,
  );
});

test('the two image digests are equal', () => {
  assert.equal(f('digest_equal'), true, 'The digests differ. If every layer is the same, the image config still has a build time. Set SOURCE_DATE_EPOCH and rewrite-timestamp in build-flags.txt.');
  assert.equal(f('config_equal'), true);
});

test('a moved tag changes the build, a digest pin does not', () => {
  assert.equal(f('tag_drift_changed'), true);
  assert.equal(f('pin_drift_changed'), false);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(4), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
