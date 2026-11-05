// Part 3 test. Run: node --test challenges/challenge-13-ship-it/part-3-roll-back/test.mjs
// The first group tests your rollbackTarget() and release-plan.json without Docker.
// The second group reads the numbers run.mjs saved from the host.
// The first run fails on purpose. Each message says what to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { leftovers, run } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { pick } from '../kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-13-ship-it/part-3-roll-back/run.mjs';
const { rollbackTarget } = await import(pathToFileURL(pick(here, 'rollback.mjs')).href);
const plan = JSON.parse(readFileSync(pick(here, 'release-plan.json'), 'utf8'));
const fact = (name) => {
  const v = getFact(`c13.p3.${name}`);
  assert.notEqual(v, undefined, `c13.p3.${name} is missing. ${hint}`);
  return v;
};
const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);

test('rollbackTarget goes back to the digest of the previous release', () => {
  const history = [
    { version: '1.0.0', tag: '1.0.0', digest: A, deployedAt: '2026-11-05T10:00:00Z' },
    { version: '2.0.0', tag: '2.0.0', digest: B, deployedAt: '2026-11-05T11:00:00Z' },
  ];
  const target = rollbackTarget(history);
  assert.equal(target.digest, A, 'Return { digest } of the previous deployment. A tag such as "1.0.0" can be re-pushed after you deployed it; the digest cannot.');
});

test('rollbackTarget does not trust a tag', () => {
  const target = rollbackTarget([
    { version: '1.0.0', tag: '1.0.0', digest: A },
    { version: '2.0.0', tag: '2.0.0', digest: B },
  ]);
  assert.ok(target.digest, 'The target must hold a digest.');
  assert.equal(target.tag, undefined, 'A tag in the answer lets the deploy tool look the tag up again, and the tag may have moved.');
});

test('rollbackTarget refuses when there is nothing to go back to', () => {
  assert.throws(() => rollbackTarget([{ version: '1.0.0', tag: '1.0.0', digest: A }]), /no earlier release|there is no/i);
});

test('release-plan.json ships the schema change in two steps (expand first)', () => {
  assert.equal(plan.secondRelease, 'expand', 'Set "secondRelease" to "expand": release 2 adds the new column and keeps the old one, so release 1 can still run. Renaming in one step makes the rollback useless.');
});

test('run.mjs ran: the rollback was by digest and the host runs release 1 again', () => {
  assert.equal(fact('tag_moved'), true, `The scenario did not move the tag. ${hint}`);
  assert.equal(fact('rollback_by'), 'digest', 'Your rollbackTarget returned a tag, and the tag had been moved. Return a digest.');
  assert.equal(fact('rollback_digest_matches'), true, 'The host does not run the digest of release 1 after the rollback.');
  assert.equal(fact('rollback_version'), '1.0.0', 'The service that answers reports another version than 1.0.0.');
});

test('after the rollback the data is still readable and writable', () => {
  assert.equal(fact('data_readable_after_rollback'), true, 'Release 1 cannot read the database release 2 left behind (it asks for a column that was renamed). Ship the schema change in two steps.');
  assert.ok(fact('data_count_after_rollback') >= fact('data_count_before_rollback'), 'Customers were lost.');
  assert.equal(fact('write_after_rollback'), true, 'Release 1 cannot write to the database any more.');
});

test('the control shows why: a one-step rename breaks the rolled-back release', () => {
  assert.equal(fact('control_data_readable'), false, 'In the control, the rollback should leave the data unreadable. Run run.mjs again.');
  assert.equal(fact('control_digest_matches'), true, 'The control rolled back by digest, so it should run the right image.');
});

test('a rollback takes under two minutes (median of 3)', () => {
  assert.ok(fact('rollback_s') > 0 && fact('rollback_s') < 120, `rollback_s is ${getFact('c13.p3.rollback_s')} s.`);
});

test('the drift check finds the container someone started by hand, and only that one', () => {
  assert.equal(fact('drift_found_count'), fact('drift_expected_count'), 'The drift check should list exactly the hand-made container.');
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
