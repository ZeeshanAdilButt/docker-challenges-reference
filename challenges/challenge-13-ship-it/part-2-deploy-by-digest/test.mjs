// Part 2 test. Run: node --test challenges/challenge-13-ship-it/part-2-deploy-by-digest/test.mjs
// It reads your compose.prod.yaml and the numbers run.mjs saved from the rollout on the production host.
// The first run fails on purpose. Each message says what to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers, run } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { pick } from '../kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-13-ship-it/part-2-deploy-by-digest/run.mjs';
const compose = readFileSync(pick(here, 'compose.prod.yaml'), 'utf8').replace(/^\s*#.*$/gm, '');
const fact = (name) => {
  const v = getFact(`c13.p2.${name}`);
  assert.notEqual(v, undefined, `c13.p2.${name} is missing. ${hint}`);
  return v;
};

test('compose: the image is named by digest, not by a tag', () => {
  const line = compose.split(/\r?\n/).find((l) => /^\s*image:/.test(l)) ?? '';
  assert.match(line, /@\$\{DIGEST/, `The image line is "${line.trim()}". Name the image by digest: ...api@\${DIGEST}. A tag can move between the pipeline and the deploy; a digest cannot.`);
});

test('compose: no secret is written in the file', () => {
  const line = compose.split(/\r?\n/).find((l) => /API_TOKEN\s*:/.test(l)) ?? '';
  assert.match(line, /\$\{API_TOKEN/, `The line "${line.trim()}" holds the secret itself. Read it from the environment of the person who deploys: API_TOKEN: \${API_TOKEN:?set API_TOKEN}`);
});

test('compose: a health check and limits are set', () => {
  assert.match(compose, /healthcheck:/, 'Add a healthcheck that calls /ready. "up --wait" waits for it, so traffic only moves to a copy that can take it.');
  assert.match(compose, /mem_limit:\s*\S+/, 'Add mem_limit: a runaway service must not take the host down.');
  assert.match(compose, /pids_limit:\s*\d+/, 'Add pids_limit.');
});

test('run.mjs ran: the first deploy worked', () => {
  assert.ok(fact('first_deploy_s') > 0, `The first deploy did not finish. ${hint}`);
  assert.equal(fact('rollout_ok'), true, 'A rollout failed. Read the "Stopped:" line of run.mjs.');
});

test('the host runs exactly the digest you intended, even though latest moved', () => {
  assert.equal(fact('latest_moved'), true, 'The scenario did not move latest. Run run.mjs again.');
  assert.equal(fact('digest_match'), true, 'The host runs an image you did not test. With a tag, "latest" moved to version 3 before your deploy. Use the digest.');
});

test('a rollout under load drops no request and both versions answered', () => {
  assert.equal(fact('rollout_failed_count'), 0, `${getFact('c13.p2.rollout_failed_count')} requests failed during the rollout. A health check makes "up --wait" wait until the new copy is ready, before nginx moves.`);
  assert.equal(fact('rollout_both_versions_served'), true, 'Only one version answered, so no swap happened.');
  assert.ok(fact('rollout_total_count') > 300, 'The load generator sent too few requests to prove anything.');
});

test('the secret reached the container from the deploy environment and is not in the image', () => {
  assert.equal(fact('image_holds_secret'), false, 'The token is inside the image. Never bake a secret into a layer.');
  assert.equal(fact('token_from_deploy_env'), true, 'The container does not hold the value the deploy passed in API_TOKEN. Read it from the environment in the compose file.');
});

test('the running container is limited and healthy', () => {
  assert.equal(fact('health_status'), 'healthy', 'The container has no health check, or it is not healthy.');
  assert.ok(fact('mem_limit_mb') > 0 && fact('mem_limit_mb') <= 512, 'Set mem_limit to something small (128m is plenty for this service).');
  assert.ok(fact('pids_limit_count') > 0, 'Set pids_limit.');
});

test('the careless control really did drop requests (so the comparison means something)', () => {
  assert.ok(fact('careless_failed_count') > 0, 'The control rollout lost nothing this time. Run run.mjs again; without a health check the swap is a race.');
});

test('chart.svg is accessible, the README links the safety rules and explains the one privileged container', () => {
  const svg = readFileSync(join(here, 'chart.svg'), 'utf8');
  assert.match(svg, /role="img"/);
  const readme = readFileSync(join(here, 'README.md'), 'utf8');
  assert.match(readme, /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
  assert.match(readme, /--privileged/);
  assert.match(readme, /docker:29-dind/);
});

test('live: the host, its context and the registry are gone after the run', { skip: run(['version']).code !== 0 && 'Docker is not running' }, () => {
  assert.deepEqual(leftovers(13), { containers: 0, networks: 0, volumes: 0 }, 'Something labelled dkr.challenge=13 is still there. Run: node toolkit/cleanup.mjs 13');
  assert.notEqual(run(['context', 'inspect', 'dkr-c13-prod']).code, 0, 'The Docker context dkr-c13-prod is still there. Run: docker context rm -f dkr-c13-prod');
});
