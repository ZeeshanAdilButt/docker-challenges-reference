// Challenge 3, part 1 test.
// Run: node --test challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/test.mjs
// It builds the five Dockerfiles in dockerfiles/ (yours) and tests what each fault was about.
// It fails until you have fixed them. That is on purpose.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { workDir, tmp, rmTree, removeImages } from '../lib/common.mjs';
import { NAMES, makeContext, checkOne } from './checks.mjs';
import { review } from './review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const work = tmp('p1t');
const dir = join(workDir(here), 'dockerfiles');
let ctx;

before(() => {
  ctx = makeContext(join(work, 'ctx'));
});
after(() => {
  if (!dockerDown) removeImages(...NAMES.map((n) => `dkr-c3-test-p1-${n.slice(0, 2)}:1`));
  rmTree(work);
});

const messages = {
  '01-unpinned-root': 'Pin the base image to a version tag (node:24-alpine is already on your machine) and run as a non-root user.',
  '02-cache-buster': 'Change the order so that editing server.mjs does not rerun npm ci: copy the package files, install, then copy the code.',
  '03-leaky-env': 'A secret must not be in ENV: it is in docker inspect and docker history. Give it to the container when it starts.',
  '04-add-and-shell': 'Use COPY for local files and exec form for CMD, so that node is PID 1.',
  '05-no-ignore': 'Keep .env files, notes and tests out of the image: add Dockerfile.dockerignore next to the Dockerfile, or copy only what you need.',
};

for (const n of NAMES) {
  test(`${n}: the reviewer finds nothing`, () => {
    const findings = review(join(dir, n, 'Dockerfile'));
    assert.deepEqual(findings, [], `${findings.map((f) => `line ${f.line} ${f.rule}`).join('; ')}. ${messages[n]}`);
  });

  test(`${n}: it builds, runs, and the fault is gone`, { skip: dockerDown }, async () => {
    const r = await checkOne(n, join(dir, n, 'Dockerfile'), ctx, `dkr-c3-test-p1-${n.slice(0, 2)}:1`);
    assert.ok(r.built, r.detail || 'the build failed');
    assert.ok(r.healthy, r.detail || 'the container did not answer /health');
    assert.ok(r.ok, `${r.detail}. ${messages[n]}`);
  });
}

test('run.mjs saved the facts from the last run', () => {
  const hint = 'Run: node challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/run.mjs';
  assert.equal(getFact('c3.p1.fixed_ok_count'), 5, `All five fixed Dockerfiles must pass. ${hint}`);
  assert.equal(getFact('c3.p1.findings_after_total'), 0, hint);
  assert.ok(getFact('c3.p1.findings_before_total') >= 5, hint);
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
