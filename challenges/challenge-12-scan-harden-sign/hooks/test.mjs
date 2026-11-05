// Tests for the pipeline hooks of challenge 12.
// Run: node --test challenges/challenge-12-scan-harden-sign/hooks/test.mjs
// The first group needs no Docker. The second group runs each hook for real on small images (about a minute).
// The full vulnerability scan is tested only when the scanner's database is already cached (part 1 shows how).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, cleanup, leftovers } from '../../../toolkit/docker.js';
import { haveDb } from '../lib.mjs';
import { parseResult, resultLine } from './common.mjs';
import { build } from '../part-2-hunt-the-secret/leaks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const hook = (stage, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [join(here, `${stage}.mjs`), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, parsed: parseResult(r.stdout) };
};
const oneLine = (r) => assert.equal(r.stdout.trim().split(/\r?\n/).length, 1, `the hook must print exactly one line, got: ${r.stdout}${r.stderr}`) ?? assert.equal(r.stderr.trim(), '', `nothing on stderr, got: ${r.stderr}`);

test('resultLine and parseResult agree', () => {
  const line = resultLine('scan', 'ok', { critical_fixable: 0, os: 'alpine 3.23.7' });
  assert.equal(line, 'scan ok critical_fixable=0 os=alpine_3.23.7');
  assert.deepEqual(parseResult(`noise\n${line}\n`), { stage: 'scan', status: 'ok', fields: { critical_fixable: '0', os: 'alpine_3.23.7' } });
});

test('parseResult reads the last result line and ignores everything else', () => {
  assert.equal(parseResult('hello'), null);
  assert.equal(parseResult('scan maybe a=b'), null);
  assert.equal(parseResult('sign ok a=1\nsign failed reason=x').status, 'failed');
  assert.equal(parseResult('sbom partial').status, 'partial');
});

test('every hook fails with one result line when it gets no image reference', () => {
  for (const stage of ['scan', 'sbom', 'sign']) {
    const r = hook(stage);
    assert.equal(r.code, 1, stage);
    assert.equal(r.parsed.stage, stage);
    assert.equal(r.parsed.status, 'failed');
    oneLine(r);
  }
});

test('sign refuses a tag: it needs a digest', () => {
  const r = hook('sign', ['127.0.0.1:5000/app:1']);
  assert.equal(r.code, 1);
  assert.match(r.parsed.fields.reason, /sha256/);
});

test('the hooks use no privileged flag and no Docker socket', () => {
  for (const f of readdirSync(here).filter((x) => x.endsWith('.mjs') && x !== 'test.mjs')) {
    const text = readFileSync(join(here, f), 'utf8').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/--privileged|docker\.sock/.test(text), `${f} must not use --privileged or the Docker socket`);
  }
});

test('live: sbom makes an SPDX document of a small image', { skip: dockerDown }, () => {
  const r = hook('sbom', ['alpine:3.23']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  oneLine(r);
  assert.equal(r.parsed.status, 'ok');
  assert.match(r.parsed.fields.format, /^SPDX-/);
  assert.ok(Number(r.parsed.fields.packages) >= 5);
});

test('live: sbom fails on an image that does not exist', { skip: dockerDown }, () => {
  const r = hook('sbom', ['dkr-c12-no-such-image:1']);
  assert.equal(r.code, 1);
  assert.equal(r.parsed.status, 'failed');
});

test('live: scan (offline) is partial for a clean image and says so', { skip: dockerDown }, () => {
  const r = hook('scan', ['alpine:3.23'], { DKR_SCAN_OFFLINE: '1' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  oneLine(r);
  assert.equal(r.parsed.status, 'partial');
  assert.equal(r.parsed.fields.secrets, '0');
  assert.equal(r.parsed.fields.vuln, 'not-run');
});

test('live: scan fails on an image with a secret in a deleted layer', { skip: dockerDown }, () => {
  const tag = 'dkr-c12-hooktest-leaky:1';
  try {
    const b = build(join(here, '..', 'part-2-hunt-the-secret', 'app'), tag);
    assert.ok(b.ok, b.output);
    const r = hook('scan', [tag], { DKR_SCAN_OFFLINE: '1' });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    oneLine(r);
    assert.equal(r.parsed.status, 'failed');
    assert.ok(Number(r.parsed.fields.secrets) >= 1);
  } finally {
    run(['rmi', '-f', tag]);
  }
});

test('live: scan with the cached database is ok for a clean base image', { skip: dockerDown || (!haveDb() && 'the scanner database is not cached (run part 1 with --live to cache it)') }, () => {
  const r = hook('scan', ['alpine:3.23']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  oneLine(r);
  assert.equal(r.parsed.status, 'ok');
  assert.equal(r.parsed.fields.critical_fixable, '0');
  assert.ok(r.parsed.fields.os.startsWith('alpine'));
});

test('live: sign signs and verifies a digest in a local registry, and fails for a digest that is not there', { skip: dockerDown }, () => {
  const net = 'dkr-c12-hooktest-net';
  const reg = 'dkr-c12-hooktest-registry';
  const lbl = ['--label', 'dkr.challenge=12'];
  const cage = ['--memory', '64m', '--memory-swap', '64m', '--pids-limit', '50', '--log-opt', 'max-size=1m'];
  try {
    cleanup(12);
    assert.equal(run(['network', 'create', ...lbl, net]).code, 0);
    const up = run(['run', '-d', '--name', reg, ...lbl, ...cage, '--network', net, '-p', '127.0.0.1:15014:5000', 'registry:3']);
    assert.equal(up.code, 0, up.stderr);
    run(['tag', 'alpine:3.23', '127.0.0.1:15014/hook/a:1']);
    assert.equal(run(['push', '127.0.0.1:15014/hook/a:1'], { timeoutMs: 120_000 }).code, 0);
    const digest = /Digest:\s+(sha256:[0-9a-f]{64})/.exec(run(['buildx', 'imagetools', 'inspect', '127.0.0.1:15014/hook/a:1']).stdout)[1];
    const ok = hook('sign', [`127.0.0.1:15014/hook/a@${digest}`]);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    oneLine(ok);
    assert.equal(ok.parsed.status, 'ok');
    assert.equal(ok.parsed.fields.verified, 'true');
    const missing = hook('sign', [`127.0.0.1:15014/hook/a@sha256:${'0'.repeat(64)}`]);
    assert.equal(missing.code, 1);
    assert.equal(missing.parsed.status, 'failed');
  } finally {
    run(['rmi', '127.0.0.1:15014/hook/a:1']);
    cleanup(12);
  }
});

after(() => cleanup(12));

test('nothing with the challenge label is left in Docker', { skip: dockerDown }, () => {
  cleanup(12);
  assert.deepEqual(leftovers(12), { containers: 0, networks: 0, volumes: 0 });
});
