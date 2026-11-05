// Challenge 5, part 2 test.
// Run: node --test challenges/challenge-5-fast-builds/part-2-cache-backends/test.mjs
// It fails until the local and registry caches really save the install step on a cold runner,
// and the workflow pins every action and writes the cache only on a push.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-5-fast-builds/part-2-cache-backends/run.mjs';
const f = (what) => getFact(`c5.p2.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('none_s'), undefined, `No facts yet. ${hint}`);
});

test('without a cache the install step runs on every cold runner', () => {
  assert.equal(f('none_install_cached'), false);
});

test('local cache: the install step comes from the cache', () => {
  assert.equal(
    f('local_install_cached'),
    true,
    'The install step ran again with the local cache. The install runs in the "build" stage, which is not part of the final image. Which cache mode also saves such layers?',
  );
});

test('registry cache: the install step comes from the cache', () => {
  assert.equal(
    f('registry_install_cached'),
    true,
    'The install step ran again with the registry cache. Compare the ref in --cache-to with the ref in --cache-from. They must be the same.',
  );
});

test('more steps come from the cache with a working backend than with none', () => {
  assert.ok(f('local_steps_cached') > f('none_steps_cached'), 'The local cache brought back no more steps than no cache at all.');
  assert.ok(f('registry_steps_cached') > f('none_steps_cached'), 'The registry cache brought back no more steps than no cache at all.');
});

test('inline cache keeps only the final image, so it cannot save the install stage', () => {
  assert.equal(f('inline_install_cached'), false);
});

test('workflow: every action is pinned to a full commit SHA', () => {
  assert.ok(f('workflow_actions') >= 3);
  assert.equal(f('workflow_unpinned'), 0, `${f('workflow_unpinned')} action(s) use a tag. Pin each to a 40 character SHA: gh api repos/<owner>/<repo>/commits/<tag> -q .sha`);
});

test('workflow: the GitHub cache is read, and written only on a push, with mode=max', () => {
  assert.equal(f('workflow_cache_from_gha'), true, 'Add cache-from: type=gha');
  assert.equal(f('workflow_cache_to_guarded'), true, 'cache-to must only run on a push. A pull request from a fork cannot write the cache. Use github.event_name in an expression.');
  assert.equal(f('workflow_cache_to_max'), true, 'Use mode=max so the build stage is saved too.');
  assert.equal(f('workflow_uses_pull_request_target'), false, 'Do not use pull_request_target to build code from a pull request.');
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
