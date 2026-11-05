// Challenge 12, part 1 test.
// Run: node --test challenges/challenge-12-scan-harden-sign/part-1-scan-an-old-image/test.mjs
// It runs your triage.mjs on three saved Trivy reports. It needs no Docker and no download.
// With DKR_TARGET=reference it tests reference/triage.mjs instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { targetDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const triagePath = join(targetDir(here), 'triage.mjs');
const t = await import(pathToFileURL(triagePath));
const policy = JSON.parse(readFileSync(join(here, 'policy.json'), 'utf8'));
const load = (n) => JSON.parse(readFileSync(join(here, 'fixtures', `${n}.json`), 'utf8'));
const old = load('old');
const yearOld = load('year-old');
const current = load('current');

test('summarize counts the old image', () => {
  const s = t.summarize(old);
  assert.equal(s.total, 51);
  assert.deepEqual(s.bySeverity, { CRITICAL: 6, HIGH: 29, MEDIUM: 12, LOW: 4, UNKNOWN: 0 });
  assert.equal(s.fixable, 51);
  assert.equal(s.unfixable, 0);
  assert.equal(s.endOfLife, true);
  assert.equal(s.os, 'alpine 3.11.11');
});

test('summarize counts the year-old image and an empty report', () => {
  assert.equal(t.summarize(yearOld).total, 216);
  assert.equal(t.summarize(yearOld).bySeverity.UNKNOWN, 7);
  const c = t.summarize(current);
  assert.equal(c.total, 0);
  assert.equal(c.endOfLife, false);
  assert.equal(c.os, 'alpine 3.23.7');
});

test('summarize counts findings that have no fix', () => {
  const r = { Results: [{ Class: 'os-pkgs', Vulnerabilities: [{ Severity: 'HIGH', FixedVersion: '' }, { Severity: 'LOW', FixedVersion: '1.2' }] }] };
  const s = t.summarize(r);
  assert.equal(s.fixable, 1);
  assert.equal(s.unfixable, 1);
  assert.equal(s.os, 'unknown');
});

test('classify: critical with a fix is fix-now, critical without a fix is accept', () => {
  assert.equal(t.classify({ Severity: 'CRITICAL', FixedVersion: '2', PkgName: 'x' }, policy), 'fix-now');
  assert.equal(t.classify({ Severity: 'CRITICAL', FixedVersion: '', PkgName: 'x' }, policy), 'accept');
});

test('classify: high is fix-now only in a runtime package', () => {
  assert.equal(t.classify({ Severity: 'HIGH', FixedVersion: '2', PkgName: 'zlib' }, policy), 'fix-now');
  assert.equal(t.classify({ Severity: 'HIGH', FixedVersion: '2', PkgName: 'busybox' }, policy), 'plan');
});

test('classify: medium with a fix is plan, low and unknown are accept', () => {
  assert.equal(t.classify({ Severity: 'MEDIUM', FixedVersion: '2', PkgName: 'x' }, policy), 'plan');
  assert.equal(t.classify({ Severity: 'LOW', FixedVersion: '2', PkgName: 'x' }, policy), 'accept');
  assert.equal(t.classify({ Severity: 'UNKNOWN', FixedVersion: '2', PkgName: 'x' }, policy), 'accept');
});

test('verdict: the old image fails for two reasons', () => {
  const v = t.verdict(old, policy);
  assert.equal(v.pass, false);
  assert.deepEqual(v.counts, { 'fix-now': 8, plan: 39, accept: 4 });
  assert.equal(v.reasons.length, 2);
  assert.match(v.reasons.join(' '), /end of life/);
});

test('verdict: the year-old image fails, the current image passes', () => {
  const y = t.verdict(yearOld, policy);
  assert.equal(y.pass, false);
  assert.equal(y.counts['fix-now'], 25);
  const c = t.verdict(current, policy);
  assert.equal(c.pass, true);
  assert.deepEqual(c.reasons, []);
});

test('verdict: a lenient policy passes a report with only plan items', () => {
  const r = { Metadata: { OS: { Family: 'alpine', Name: '3.99', EOSL: false } }, Results: [{ Class: 'os-pkgs', Vulnerabilities: [{ Severity: 'MEDIUM', FixedVersion: '2', PkgName: 'x' }] }] };
  assert.equal(t.verdict(r, policy).pass, true);
  assert.equal(t.verdict(r, { ...policy, max_fix_now: 0 }).counts.plan, 1);
});

test('topFixes lists the worst packages first', () => {
  const top = t.topFixes(yearOld, policy, 3);
  assert.equal(top.length, 3);
  assert.ok(top[0].count >= top[1].count && top[1].count >= top[2].count);
  assert.ok(top[0].fixedIn);
});

test('the command line prints a verdict and exits 1 on FAIL', () => {
  const a = spawnSync(process.execPath, [triagePath, join(here, 'fixtures', 'old.json'), join(here, 'policy.json')], { encoding: 'utf8' });
  assert.equal(a.status, 1, a.stdout + a.stderr);
  assert.match(a.stdout, /51 findings/);
  const b = spawnSync(process.execPath, [triagePath, join(here, 'fixtures', 'current.json'), join(here, 'policy.json')], { encoding: 'utf8' });
  assert.equal(b.status, 0);
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});
