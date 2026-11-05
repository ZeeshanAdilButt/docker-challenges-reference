// Challenge 10, part 3 test.
// Run: node --test challenges/challenge-10-fill-the-box/part-3-audit-the-host/test.mjs
// It tests your audit.mjs on saved docker inspect files, on small made-up objects, and live.
// With DKR_TARGET=reference it tests reference/audit.mjs instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, cleanup, leftovers } from '../../../toolkit/docker.js';
import { AUDIT_EXPECT, createAuditContainers, targetDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const auditPath = join(targetDir(here), 'audit.mjs');
const audit = await import(pathToFileURL(auditPath));
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures', 'inspect.json'), 'utf8'));
const byName = (list, key) => list.find((c) => String(c.Name).endsWith(`aud-${key}`));
const ids = (c) => audit.auditContainer(c).map((x) => x.id);

test('parseSize reads the sizes Docker prints', () => {
  assert.equal(audit.parseSize('0B'), 0);
  assert.equal(audit.parseSize('512B'), 512);
  assert.equal(audit.parseSize('21kB'), 21_000);
  assert.equal(audit.parseSize('21MB'), 21_000_000);
  assert.equal(audit.parseSize('1.5GB'), 1_500_000_000);
  assert.equal(audit.parseSize('21MB (virtual 30.1MB)'), 21_000_000);
  assert.ok(Number.isNaN(audit.parseSize('lots')));
});

for (const key of Object.keys(AUDIT_EXPECT)) {
  test(`saved inspect JSON: ${key}`, () => {
    const found = ids(byName(fixtures, key));
    const exp = AUDIT_EXPECT[key];
    if (exp.exact) assert.deepEqual(found, exp.exact, `${key} should have no findings, got ${found.join(', ') || 'none'}`);
    for (const id of exp.has ?? []) assert.ok(found.includes(id), `${key}: expected finding ${id}, got ${found.join(', ') || 'none'}`);
    for (const id of exp.lacks ?? []) assert.ok(!found.includes(id), `${key}: ${id} should not be reported`);
  });
}

test('a privileged container is critical', () => {
  const c = structuredClone(byName(fixtures, 'good'));
  c.HostConfig.Privileged = true;
  const f = audit.auditContainer(c).find((x) => x.id === 'privileged');
  assert.ok(f, 'privileged is not reported');
  assert.equal(f.severity, 'critical');
});

test('a mounted Docker socket is critical', () => {
  const c = structuredClone(byName(fixtures, 'good'));
  c.HostConfig.Binds = ['/var/run/docker.sock:/var/run/docker.sock'];
  const f = audit.auditContainer(c).find((x) => x.id === 'docker-socket');
  assert.ok(f, 'docker-socket is not reported');
  assert.equal(f.severity, 'critical');
});

test('limits that Docker reports as -1 or null count as missing', () => {
  const c = structuredClone(byName(fixtures, 'good'));
  c.HostConfig.PidsLimit = -1;
  c.HostConfig.Memory = 0;
  assert.ok(ids(c).includes('no-pids-limit'));
  c.HostConfig.PidsLimit = null;
  assert.ok(ids(c).includes('no-pids-limit'));
  assert.ok(ids(c).includes('no-memory-limit'));
});

test('local and none log drivers are not "unrotated json-file"', () => {
  const c = structuredClone(byName(fixtures, 'unrotated'));
  c.HostConfig.LogConfig = { Type: 'local', Config: {} };
  assert.ok(!ids(c).includes('log-not-rotated'));
});

test('summarize counts findings per severity', () => {
  const s = audit.summarize(audit.auditAll(fixtures));
  assert.ok(s.high >= 2, `expected at least 2 high findings, got ${s.high}`);
  assert.ok(s.medium >= 3, `expected at least 3 medium findings, got ${s.medium}`);
});

test('the command line exits 1 when there is a high finding, 0 when clean', () => {
  const good = JSON.stringify([byName(fixtures, 'good')]);
  const bad = JSON.stringify(fixtures);
  const a = spawnSync(process.execPath, [auditPath, '-'], { input: good, encoding: 'utf8' });
  const b = spawnSync(process.execPath, [auditPath, '-'], { input: bad, encoding: 'utf8' });
  assert.equal(a.status, 0, `clean input should exit 0. ${a.stderr}`);
  assert.equal(b.status, 1, `input with high findings should exit 1. ${b.stderr}`);
  assert.match(b.stdout, /no-memory-limit/);
});

test('live: the audit is right on containers Docker makes today', { skip: dockerDown }, () => {
  try {
    cleanup(10);
    const list = createAuditContainers();
    for (const key of Object.keys(AUDIT_EXPECT)) {
      const found = ids(byName(list, key));
      const exp = AUDIT_EXPECT[key];
      if (exp.exact) assert.deepEqual(found, exp.exact, `live ${key}: expected no findings, got ${found.join(', ') || 'none'}`);
      for (const id of exp.has ?? []) assert.ok(found.includes(id), `live ${key}: expected ${id}, got ${found.join(', ') || 'none'}`);
      for (const id of exp.lacks ?? []) assert.ok(!found.includes(id), `live ${key}: ${id} should not be reported`);
    }
  } finally {
    cleanup(10);
  }
  assert.deepEqual(leftovers(10), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});
