// Challenge 4, part 1 test.
// Run: node --test challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/test.mjs
// It fails until run.mjs has built all five bases and each one answers /health.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/run.mjs';
const BASES = {
  full: 'Dockerfile.full',
  slim: 'Dockerfile.slim',
  alpine: 'Dockerfile.alpine',
  alpine_os: 'Dockerfile.alpine-os',
  distroless: 'Dockerfile.distroless',
};
const f = (base, what) => getFact(`c4.p1.${base}_${what}`);

for (const [key, file] of Object.entries(BASES)) {
  test(`${key}: ${file} builds and the container answers /health`, () => {
    assert.notEqual(f(key, 'built'), undefined, `No facts for ${key}. ${hint}`);
    assert.equal(f(key, 'built'), true, `${file} did not build. Read the build output from run.mjs.`);
    assert.equal(
      f(key, 'health_ok'),
      true,
      `The container built from ${file} did not answer /health. ` +
        (key === 'distroless'
          ? 'Hint: this base already sets ENTRYPOINT to node. What should CMD hold then?'
          : 'Run the image by hand and read its logs.'),
    );
  });
}

test('every base has a size and a package count', () => {
  for (const key of Object.keys(BASES)) {
    assert.ok(f(key, 'unpacked_mb') > 0, `c4.p1.${key}_unpacked_mb is missing. ${hint}`);
    assert.ok(f(key, 'packed_mb') > 0, `c4.p1.${key}_packed_mb is missing. ${hint}`);
    assert.ok(f(key, 'packages') > 0, `c4.p1.${key}_packages is missing. ${hint}`);
  }
});

test('the sizes tell the story: full > slim > alpine, and distroless is smaller than slim', () => {
  for (const key of Object.keys(BASES)) assert.ok(f(key, 'unpacked_mb') > f(key, 'packed_mb'), `${key}: unpacked must be bigger than packed`);
  assert.ok(f('full', 'unpacked_mb') > f('slim', 'unpacked_mb'));
  assert.ok(f('slim', 'unpacked_mb') > f('alpine', 'unpacked_mb'));
  assert.ok(f('distroless', 'unpacked_mb') < f('slim', 'unpacked_mb'));
});

test('alpine + apk leaves no package cache in the image', () => {
  assert.equal(
    f('alpine_os', 'apk_cache_kb'),
    0,
    `Dockerfile.alpine-os leaves ${f('alpine_os', 'apk_cache_kb')} KB of package index in /var/cache/apk. Hint: apk add has a flag that never writes the cache.`,
  );
});

test('what you gain and lose: distroless has no shell, Alpine cannot run glibc programs', () => {
  assert.equal(f('distroless', 'has_shell'), false);
  assert.equal(f('full', 'has_shell'), true);
  assert.equal(f('alpine', 'glibc_ok'), false);
  assert.equal(f('slim', 'glibc_ok'), true);
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
