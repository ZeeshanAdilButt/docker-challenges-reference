// Challenge 3, part 4 test.
// Run: node --test challenges/challenge-3-dockerfile-review/part-4-build-and-run-secrets/test.mjs
// It builds YOUR Dockerfile with a made-up build token and looks for the token in the history, the config and
// every layer. Then it starts a container with the flags from YOUR secret-run.mjs and looks at docker inspect.
// It fails until neither secret can be read from the image or from the container's config. That is on purpose.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { workDir, tmp, rmTree, removeImages } from '../lib/common.mjs';
import { BUILD_TOKEN, RUNTIME_KEY, fingerprint, makeContext, writeSecret, buildWithToken, scanImage, buildProof, runtimeCheck } from './checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TAG = 'dkr-c3-test-p4:1';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const work = tmp('p4t');
let built;
let scan;
let proof;
let runtime;

before(async () => {
  if (dockerDown) return;
  const ctx = makeContext(join(work, 'ctx'));
  const tokenFile = writeSecret(join(work, 'secrets'), 'npm_token', BUILD_TOKEN);
  const keyFile = writeSecret(join(work, 'secrets'), 'api_key', RUNTIME_KEY);
  built = buildWithToken(join(workDir(here), 'Dockerfile'), ctx, TAG, tokenFile);
  if (built.code !== 0) return;
  scan = scanImage(TAG, work);
  proof = buildProof(TAG);
  const mine = await import(pathToFileURL(join(workDir(here), 'secret-run.mjs')).href);
  runtime = runtimeCheck(TAG, mine.runArgs, keyFile);
});

after(() => {
  if (!dockerDown) removeImages(TAG);
  rmTree(work);
});

test('the Dockerfile builds with the token given as --build-arg and as --secret', { skip: dockerDown }, () => {
  assert.equal(built.code, 0, built.out.split('\n').filter(Boolean).slice(-8).join('\n'));
});

test('the token was usable during the build: build-proof.txt holds its fingerprint', { skip: dockerDown }, () => {
  assert.equal(proof, fingerprint(BUILD_TOKEN), 'build-proof.txt is missing or wrong. The install step must still be able to read the token (with --mount=type=secret it is the file /run/secrets/npm_token).');
});

test('the token is not in docker history', { skip: dockerDown }, () => {
  assert.equal(scan.history, false, 'docker history shows the token. An ARG that a RUN step uses is written into the history. Use RUN --mount=type=secret instead.');
});

test('the token is not in the image config', { skip: dockerDown }, () => {
  assert.equal(scan.config, false, 'the image config (it holds the history and the environment) contains the token.');
});

test('the token is not in any file of any layer', { skip: dockerDown }, () => {
  assert.equal(scan.layers, false, 'a layer contains the token. Do not write it to a file that stays in the image.');
});

test('the key is given to the container as a read-only file, not as an environment variable', { skip: dockerDown }, () => {
  assert.ok(!runtime.error || runtime.source, `the container did not start or the app could not read the key: ${runtime.error}`);
  assert.equal(runtime.flagsHaveKey, false, 'the key is in the docker run flags. Pass the path of the file, not the key.');
  assert.equal(runtime.inspectHasKey, false, 'docker inspect shows the key (an -e variable is stored in the container config). Mount the file instead.');
  assert.ok(runtime.mounted, 'no file is mounted under /run/secrets/');
  assert.equal(runtime.mountReadonly, true, 'the secret file must be mounted read-only (add readonly to --mount)');
});

test('the app still reads the key, from a file', { skip: dockerDown }, () => {
  assert.equal(runtime.source, 'file', 'check-secret.mjs should find the key through API_KEY_FILE');
  assert.equal(runtime.fingerprintOk, true, 'the app read a different key than the one in the file');
});

test('run.mjs saved the facts from the last run', () => {
  const hint = 'Run: node challenges/challenge-3-dockerfile-review/part-4-build-and-run-secrets/run.mjs';
  assert.equal(getFact('c3.p4.original_history_has_token'), true, hint);
  assert.equal(getFact('c3.p4.mine_history_has_token'), false, hint);
  assert.equal(getFact('c3.p4.mine_inspect_has_key'), false, hint);
  assert.equal(getFact('c3.p4.mine_build_proof_ok'), true, hint);
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
