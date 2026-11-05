// Part 4 test. Run: node --test challenges/challenge-13-ship-it/part-4-three-drills/test.mjs
// It reads your compose.prod.yaml and the numbers run.mjs saved from the three drills.
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
const hint = 'Run: node challenges/challenge-13-ship-it/part-4-three-drills/run.mjs';
const compose = readFileSync(pick(here, 'compose.prod.yaml'), 'utf8').replace(/^\s*#.*$/gm, '');
const fact = (name) => {
  const v = getFact(`c13.p4.${name}`);
  assert.notEqual(v, undefined, `c13.p4.${name} is missing. ${hint}`);
  return v;
};
const seconds = (text, key) => {
  const m = new RegExp(`${key}:\\s*(\\d+)(ms|s|m)\\b`).exec(text);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === 'm' ? 60 : m[2] === 'ms' ? 0.001 : 1);
};

test('compose: a dead process is restarted', () => {
  const m = /^\s*restart:\s*"?([\w-]+)"?/m.exec(compose);
  assert.ok(m && m[1] !== 'no', `restart is ${m ? `"${m[1]}"` : 'not set'}. Set restart: unless-stopped.`);
});

test('compose: the host does not ask the registry for an image it already has', () => {
  const m = /^\s*pull_policy:\s*(\S+)/m.exec(compose);
  assert.ok(m && ['missing', 'never'].includes(m[1]), `pull_policy is ${m ? `"${m[1]}"` : 'not set'}. "always" turns an outage of the registry into an outage of your deploys. Use missing.`);
});

test('compose: a copy that never gets ready is called unhealthy within 30 seconds', () => {
  const interval = seconds(compose, 'interval');
  const retries = Number(/retries:\s*(\d+)/.exec(compose)?.[1]);
  assert.ok(interval * retries <= 30, `interval ${interval} s times retries ${retries} is ${interval * retries} s. Shorten the interval (2s is fine for a local check) and keep retries around 5.`);
});

test('drill 1: a killed copy comes back by itself, within 20 seconds', () => {
  assert.equal(fact('kill_recovered'), true, `Nothing restarted the killed copy (restart policy "${getFact('c13.p4.kill_restart_policy')}"). Set restart: unless-stopped.`);
  assert.ok(fact('kill_recovery_s') <= 20, `It took ${getFact('c13.p4.kill_recovery_s')} s to come back.`);
  assert.ok(fact('kill_restart_count') >= 1, 'Docker did not count a restart.');
});

test('drill 2: with the registry down, the host still redeploys the digest it has', () => {
  assert.equal(fact('registry_down_redeploy_ok'), true, 'The redeploy failed while the registry was down. Use pull_policy: missing.');
});

test('drill 3: a bad release is refused quickly and the old one keeps serving', () => {
  assert.equal(fact('bad_release_rejected'), true, 'The bad release was accepted. Is there a health check on /ready?');
  assert.ok(fact('bad_release_detect_s') <= 30, `It took ${getFact('c13.p4.bad_release_detect_s')} s to refuse the bad release. Shorten the health check interval.`);
  assert.equal(fact('bad_release_old_still_serving'), true, 'After the refused deploy the old version no longer answers.');
  assert.equal(fact('bad_release_failed_count'), 0, `${getFact('c13.p4.bad_release_failed_count')} requests failed while the bad release was tried.`);
});

test('chart.svg is accessible, the README links the safety rules and says why the host is privileged', () => {
  assert.match(readFileSync(join(here, 'chart.svg'), 'utf8'), /role="img"/);
  const readme = readFileSync(join(here, 'README.md'), 'utf8');
  assert.match(readme, /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
  assert.match(readme, /--privileged/);
});

test('live: the host, its context and the registry are gone after the run', { skip: run(['version']).code !== 0 && 'Docker is not running' }, () => {
  assert.deepEqual(leftovers(13), { containers: 0, networks: 0, volumes: 0 }, 'Something labelled dkr.challenge=13 is still there. Run: node toolkit/cleanup.mjs 13');
  assert.notEqual(run(['context', 'inspect', 'dkr-c13-prod']).code, 0, 'The Docker context dkr-c13-prod is still there. Run: docker context rm -f dkr-c13-prod');
});
