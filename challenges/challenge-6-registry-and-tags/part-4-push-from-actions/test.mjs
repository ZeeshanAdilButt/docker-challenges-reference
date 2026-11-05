// Challenge 6, part 4 test.
// Run: node --test challenges/challenge-6-registry-and-tags/part-4-push-from-actions/test.mjs
// It fails until tags.mjs gives every build the right tags and the workflow trusts as little as it can.
// The GitHub run itself is yours and is not run by the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-6-registry-and-tags/part-4-push-from-actions/run.mjs';
const f = (what) => getFact(`c6.p4.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('tag_cases_total'), undefined, `No facts yet. ${hint}`);
});

test('tags.mjs gives every kind of build the right tags', () => {
  assert.equal(f('tag_cases_passed'), f('tag_cases_total'), `${f('tag_cases_passed')} of ${f('tag_cases_total')} cases pass. Run run.mjs and read the FAIL lines.`);
});

test('every tag in the registry points to one digest, and the labels are on the image', () => {
  assert.equal(f('registry_tags_match'), true, 'The tags in the registry are not the tags the rules ask for.');
  assert.equal(f('one_digest'), true);
  assert.equal(f('labels_ok'), true);
});

test('a push to main does not move latest', () => {
  assert.equal(f('latest_stays_on_release'), true, 'latest moved on a branch push. latest belongs to release tags only.');
});

test('workflow: every action is pinned to a full commit SHA', () => {
  assert.ok(f('workflow_actions') >= 4);
  assert.equal(f('workflow_unpinned'), 0, 'Pin each action to a 40 character SHA: gh api repos/<owner>/<repo>/commits/<tag> -q .sha');
});

test('workflow: narrow permissions, the built-in token, no push from a pull request', () => {
  assert.equal(f('workflow_write_all'), false, 'permissions: write-all gives every step of every job write access to everything.');
  assert.equal(f('workflow_packages_write'), true, 'The job needs packages: write to push to GHCR, and nothing more than that and contents: read.');
  assert.equal(f('workflow_uses_github_token'), true, 'Log in with secrets.GITHUB_TOKEN. A personal access token lives for months and can do much more.');
  assert.equal(f('workflow_push_guarded'), true, 'push must be false for a pull request: its code is not trusted yet.');
});

test('workflow: the digest is printed so you can deploy by it', () => {
  assert.equal(f('workflow_prints_digest'), true);
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
