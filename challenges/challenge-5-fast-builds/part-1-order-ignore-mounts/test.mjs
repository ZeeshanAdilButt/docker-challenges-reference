// Challenge 5, part 1 test.
// Run: node --test challenges/challenge-5-fast-builds/part-1-order-ignore-mounts/test.mjs
// It fails until a code change no longer reinstalls the packages, the build folder is small
// and the install uses a cache mount.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-5-fast-builds/part-1-order-ignore-mounts/run.mjs';
const f = (what) => getFact(`c5.p1.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('code_change_s'), undefined, `No facts yet. ${hint}`);
});

test('a code change does not install the packages again', () => {
  assert.equal(
    f('install_reran_on_code_change'),
    false,
    'The install step ran again after a one line edit. Copy only package.json and package-lock.json before the install, and the rest of the code after it.',
  );
});

test('a code change rebuilds much faster than a dependency change', () => {
  assert.ok(
    f('code_change_s') < f('deps_change_s') * 0.6,
    `A code change took ${f('code_change_s')} s and a dependency change ${f('deps_change_s')} s. After the fix the first should be a fraction of the second.`,
  );
});

test('the build folder sent to the builder is small', () => {
  assert.ok(f('context_mb') < 5, `${f('context_mb')} MB were sent to the builder. Add .git, node_modules, coverage and logs to .dockerignore.`);
});

test('the clutter is not inside the image', () => {
  assert.equal(f('clutter_in_image'), 0, `${f('clutter_in_image')} of .git, logs, coverage are inside the image. Use .dockerignore and copy only what you need.`);
});

test('the install step uses a cache mount, and the npm cache is not in the image', () => {
  assert.equal(f('mount_used'), true, 'Add --mount=type=cache,target=/root/.npm to the RUN line that installs packages.');
  assert.ok(f('npm_cache_in_image_mb') < 1, `${f('npm_cache_in_image_mb')} MB of npm cache are inside the image.`);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(5), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
