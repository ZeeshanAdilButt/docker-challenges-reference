// Challenge 11, part 2 test.
// Run: node --test challenges/challenge-11-broken-containers/part-2-runs-but-unreachable/test.mjs
// Each service is started from your files, checked, and taken down again (about a minute).
// With DKR_TARGET=reference it tests the services and the runbook in reference/ instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, cleanup, leftovers } from '../../../toolkit/docker.js';
import { gradeService, checkRunbook, targetDir } from '../part.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const ids = ['05-port-clash', '06-bad-healthcheck', '07-dns-typo'];

for (const id of ids) {
  test(`live: ${id} works`, { skip: dockerDown }, async () => {
    const g = await gradeService(id, join(targetDir(here), 'services', id));
    assert.ok(g.working, `${g.problems.join(" | ")}. Work down the ladder in the README, fix the files in services/${id}, and run this test again.`);
  });
}

test('runbook.md has a Symptom, Cause and Fix line for every service', () => {
  const problems = checkRunbook(join(targetDir(here), 'runbook.md'), ids);
  assert.deepEqual(problems, []);
});

test('nothing with the challenge label is left in Docker', { skip: dockerDown }, () => {
  cleanup(11);
  assert.deepEqual(leftovers(11), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});
