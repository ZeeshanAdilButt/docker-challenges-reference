// Part 1 test. Run: node --test challenges/challenge-13-ship-it/part-1-build-check-push/test.mjs
// It checks your workflow file (text only) and the numbers that run.mjs saved from your pipeline.json.
// The first run fails on purpose. Each message says what to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers, run } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { checkWorkflow, pick } from '../kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-13-ship-it/part-1-build-check-push/run.mjs';
const wf = checkWorkflow(pick(here, 'workflow/ship.yml'));
const fact = (name) => {
  const v = getFact(`c13.p1.${name}`);
  assert.notEqual(v, undefined, `c13.p1.${name} is missing. ${hint}`);
  return v;
};

test('workflow: every action is pinned to a full 40-character commit', () => {
  const loose = wf.uses.filter((u) => !/@[0-9a-f]{40}$/.test(u));
  assert.deepEqual(loose, [], `These actions use a tag, which can be moved: ${loose.join(', ')}. Find the commit with: gh api repos/<owner>/<repo>/commits/<tag> -q .sha  then write uses: owner/repo@<sha> # <tag>`);
});

test('workflow: permissions are narrow and the trigger does not hand secrets to fork code', () => {
  assert.equal(wf.writeAll, false, 'permissions: write-all gives every step every right. Use "permissions: {}" at the top and ask for what each job needs.');
  assert.ok(wf.permissionBlocks >= 2, 'Give each job its own permissions block (contents: read, and packages: write only where you push).');
  assert.equal(wf.pullRequestTarget, false, 'pull_request_target runs code from a fork with your secrets. Use pull_request.');
});

test('workflow: a pull request never pushes, and the login uses the built-in token', () => {
  assert.equal(wf.pushAlways, false, '"push: true" pushes images built from pull requests. Use: push: ${{ github.event_name != \'pull_request\' }}');
  assert.equal(wf.pushGuarded, true, 'Guard the push input with github.event_name != \'pull_request\'.');
  assert.equal(wf.hardcodedSecret, false, 'A password or token is written in the file. Use ${{ secrets.GITHUB_TOKEN }}.');
  assert.equal(wf.usesGithubToken, true, 'Log in to ghcr.io with ${{ secrets.GITHUB_TOKEN }}.');
});

test('workflow: tests run first, scan, sbom and sign have a step, and the deploy job gets a digest', () => {
  assert.equal(wf.hasTestStep, true, 'Add a build step with target: test before the push.');
  assert.equal(wf.hasScan && wf.hasSbom && wf.hasSign, true, 'Add steps for scan, sbom and sign. A placeholder that says "filled in after challenge 12" is fine for now.');
  assert.equal(wf.printsDigest, true, 'Give the push step an id and export steps.<id>.outputs.digest as a job output.');
  assert.equal(wf.deployNeedsBuild, true, 'The deploy job needs the build job (needs: build) and must read needs.build.outputs.digest.');
});

test('pipeline: run.mjs ran and the good commit went all the way', () => {
  assert.equal(fact('good_run_ok'), true, `The good commit failed a stage. ${hint}`);
  assert.match(String(fact('good_digest')), /^sha256:[0-9a-f]{64}$/, 'The good commit left no digest in the registry. Does your pipeline.json include "push"?');
});

test('pipeline: a failing test stops the run before anything is pushed', () => {
  assert.equal(fact('bad_image_pushed'), false, 'The broken image reached the registry. In pipeline.json put "test" before "push".');
  assert.equal(fact('tests_before_push'), true, 'In pipeline.json the stage "test" must come before "push".');
  assert.equal(fact('bad_run_ok'), false, 'The bad commit should make the pipeline fail.');
});

test('pipeline: scan and sbom run before the push, and sign runs after it', () => {
  assert.equal(fact('scan_before_push'), true, 'Put "scan" before "push" in pipeline.json: you do not want to publish what you have not looked at.');
  assert.equal(fact('sign_after_push'), true, 'Put "sign" after "push": a signature belongs to a digest that is in the registry.');
  assert.equal(fact('lint_first'), true, 'Start with "lint" (docker build --check): it is the cheapest check.');
});

test('pipeline: the tags name the commit, and latest is not the only name', () => {
  assert.equal(fact('tags_include_sha'), true, 'Add "sha" to "tags" in pipeline.json so every image has a tag that names its commit.');
  assert.equal(fact('latest_only'), false, '"latest" alone says nothing about the code. Use "sha" and "version".');
});

test('the build is faster with the layer cache', () => {
  assert.ok(fact('build_warm_s') < fact('build_cold_s'), `A cached build (${getFact('c13.p1.build_warm_s')} s) should be faster than a cold one (${getFact('c13.p1.build_cold_s')} s).`);
});

test('chart.svg is an accessible chart, the README links the safety rules', () => {
  const svg = readFileSync(join(here, 'chart.svg'), 'utf8');
  assert.match(svg, /role="img"/);
  assert.match(svg, /<desc id="d">/);
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('live: the run cleaned up after itself', { skip: run(['version']).code !== 0 && 'Docker is not running' }, () => {
  assert.deepEqual(leftovers(13), { containers: 0, networks: 0, volumes: 0 }, 'Something labelled dkr.challenge=13 is still there. Run: node toolkit/cleanup.mjs 13');
});
