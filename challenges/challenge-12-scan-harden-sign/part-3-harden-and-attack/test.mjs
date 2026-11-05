// Challenge 12, part 3 test.
// Run: node --test challenges/challenge-12-scan-harden-sign/part-3-harden-and-attack/test.mjs
// It starts the target with your harden.json, checks that the service still answers, and runs six attack
// scripts against it. Every attack must be blocked. With DKR_TARGET=reference it tests reference/harden.json.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, cleanup, leftovers } from '../../../toolkit/docker.js';
import { targetDir } from '../lib.mjs';
import { ATTACKS, buildTarget, loadHarden, trial } from './attacks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const h = loadHarden(targetDir(here));

let result;
const attacked = async () => {
  if (!result) {
    buildTarget();
    result = await trial(h);
  }
  return result;
};
after(() => cleanup(12));

test('harden.json has the six settings', () => {
  for (const k of ['user', 'cap_drop', 'read_only', 'no_new_privileges', 'pids_limit', 'tmpfs']) assert.ok(k in h, `harden.json needs "${k}"`);
  assert.ok(Array.isArray(h.cap_drop) && Array.isArray(h.tmpfs));
});

test('the hardened service still answers GET /health', { skip: dockerDown }, async () => {
  const r = await attacked();
  assert.ok(r.ok, 'The container did not answer /health. Hardening must not break the service: check the user, the read-only root and the tmpfs.');
});

for (const a of ATTACKS) {
  test(`attack blocked: ${a.title}`, { skip: dockerDown }, async () => {
    const r = await attacked();
    assert.ok(r.ok, 'the service did not start');
    const x = r.results.find((y) => y.id === a.id);
    assert.equal(x.worked, false, `The attack "${a.id}" SUCCEEDED. It is stopped by: ${a.stoppedBy}. Output: ${x.output.slice(0, 120)}`);
  });
}

test('the settings are sane: a process limit of 1 to 64 and no privileged flag', () => {
  assert.ok(h.pids_limit > 0 && h.pids_limit <= 64, 'pids_limit must be between 1 and 64');
  assert.ok(!JSON.stringify(h).includes('privileged'));
});

test('nothing with the challenge label is left in Docker', { skip: dockerDown }, () => {
  cleanup(12);
  assert.deepEqual(leftovers(12), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});
