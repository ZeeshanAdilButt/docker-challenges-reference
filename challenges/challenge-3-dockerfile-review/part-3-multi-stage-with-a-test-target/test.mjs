// Challenge 3, part 3 test.
// Run: node --test challenges/challenge-3-dockerfile-review/part-3-multi-stage-with-a-test-target/test.mjs
// It builds YOUR Dockerfile three ways and looks inside the result. It fails until the Dockerfile has a
// test stage that gates the build and a runtime stage that ships only the service. That is on purpose.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { workDir, tmp, rmTree, build, removeImages } from '../lib/common.mjs';
import { makeContext, withFailingTest, stagesOf, testsRun, rootBytes, inspectRuntime, healthy, TOOLCHAIN_BYTES } from './checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerfile = join(workDir(here), 'Dockerfile');
const TAGS = ['dkr-c3-test-p3-single:1', 'dkr-c3-test-p3-test:1', 'dkr-c3-test-p3-runtime:1'];
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const work = tmp('p3t');
let ctx;
let stages;
let testBuild;
let failingBuild;
let runtimeBuild;
let singleBytes;

before(() => {
  stages = stagesOf(dockerfile);
  if (dockerDown) return;
  ctx = makeContext(join(work, 'ctx'));
  const single = build({ tag: TAGS[0], dockerfile: join(here, 'Dockerfile.single'), context: ctx });
  assert.equal(single.code, 0, single.out);
  singleBytes = rootBytes(TAGS[0]);
  testBuild = build({ tag: TAGS[1], dockerfile, context: ctx, target: 'test', args: ['--no-cache-filter', 'test'] });
  failingBuild = build({ tag: 'dkr-c3-test-p3-never:1', dockerfile, context: withFailingTest(ctx), target: 'test' });
  runtimeBuild = build({ tag: TAGS[2], dockerfile, context: ctx });
});

after(() => {
  if (!dockerDown) removeImages(...TAGS, 'dkr-c3-test-p3-never:1');
  rmTree(work);
});

test('the Dockerfile has a stage named "test" and a different last stage', () => {
  assert.ok(stages.names.includes('test'), `stages are: ${stages.names.map((n) => n ?? '(unnamed)').join(', ')}. Name one "FROM ... AS test".`);
  assert.ok(stages.count >= 2 && stages.last !== 'test', 'the last stage is the one that ships. It must not be the test stage.');
});

test('docker build --target test builds and runs the tests', { skip: dockerDown }, () => {
  assert.equal(testBuild.code, 0, testBuild.out.split('\n').filter(Boolean).slice(-6).join('\n'));
  assert.ok(testsRun(testBuild.out) >= 5, `node --test should have run the daftar-api tests (it reported ${testsRun(testBuild.out)}). Does the test stage RUN node --test test.mjs?`);
});

test('a failing test stops docker build --target test', { skip: dockerDown }, () => {
  assert.notEqual(failingBuild.code, 0, 'the build passed although a test fails. The test stage must run the tests with RUN.');
  assert.match(failingBuild.out, /forced failure/, 'the failure of the test should be visible in the build output');
});

test('the default target builds, and runs as a non-root user and answers /health', { skip: dockerDown }, async () => {
  assert.equal(runtimeBuild.code, 0, runtimeBuild.out.split('\n').filter(Boolean).slice(-6).join('\n'));
  assert.notEqual(inspectRuntime(TAGS[2]).uid, '0', 'the runtime image runs as root. Add USER.');
  assert.equal(await healthy(TAGS[2]), true, 'the runtime image did not answer /health');
});

test('the runtime image has no tests and no toolchain', { skip: dockerDown }, () => {
  const inside = inspectRuntime(TAGS[2]);
  assert.ok(!inside.app.includes('test.mjs'), 'test.mjs is in /app. Copy it into the test stage only.');
  assert.ok(!inside.opt.includes('toolchain'), 'the toolchain is in /opt. The service does not need it to run: keep it in the test stage.');
});

test('the runtime image is at least 25 MB smaller than the single-stage image', { skip: dockerDown }, () => {
  const rt = rootBytes(TAGS[2]);
  assert.ok(singleBytes - rt >= TOOLCHAIN_BYTES - 5_000_000, `the runtime image is ${(rt / 1e6).toFixed(1)} MB and the single-stage image is ${(singleBytes / 1e6).toFixed(1)} MB`);
});

test('run.mjs saved the facts from the last run', () => {
  const hint = 'Run: node challenges/challenge-3-dockerfile-review/part-3-multi-stage-with-a-test-target/run.mjs';
  assert.equal(getFact('c3.p3.has_test_stage'), true, hint);
  assert.equal(getFact('c3.p3.failing_test_blocks_build'), true, hint);
  assert.equal(getFact('c3.p3.runtime_has_toolchain'), false, hint);
  assert.equal(getFact('c3.p3.runtime_has_tests'), false, hint);
  assert.ok(getFact('c3.p3.saved_mb') >= 25, hint);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(3), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.match(readFileSync(join(here, 'chart.svg'), 'utf8'), /role="img"/);
});
