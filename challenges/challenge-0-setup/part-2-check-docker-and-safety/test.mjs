// Part 2 test. Run: node --test challenges/challenge-0-setup/part-2-check-docker-and-safety/test.mjs
// The first group fails until you have run run.mjs once. That is on purpose.
// The second group runs a tiny live experiment against your Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, cleanup, leftovers, name, safeArgs, label } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const IMAGE = 'alpine:3.23';
const hint = 'Run: node challenges/challenge-0-setup/part-2-check-docker-and-safety/run.mjs';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';

test('run.mjs saved the facts from your run', () => {
  assert.ok(getFact('c0.p2.image_mb') > 1 && getFact('c0.p2.image_mb') < 50, `c0.p2.image_mb is missing or odd. ${hint}`);
  assert.ok(getFact('c0.p2.pull_s') >= 0, `c0.p2.pull_s is missing. ${hint}`);
  assert.ok(getFact('c0.p2.run_s') > 0, `c0.p2.run_s is missing. ${hint}`);
  assert.equal(getFact('c0.p2.memory_max_bytes'), 64 * 1024 * 1024, `The container should report a 64 MB limit. ${hint}`);
  assert.equal(getFact('c0.p2.pids_max'), 50, `The container should report 50 processes. ${hint}`);
});

test('cleanup left nothing behind, and kept the object with no label', () => {
  assert.equal(getFact('c0.p2.leftover_count'), 0, `Objects with the label were left after cleanup. ${hint}`);
  assert.ok(getFact('c0.p2.cleanup_removed_count') >= 3, `Cleanup should have removed a container, a network and a volume. ${hint}`);
  assert.equal(getFact('c0.p2.unlabelled_kept_count'), 1, `The volume with no label must survive cleanup. ${hint}`);
});

test('chart.svg is an accessible chart', () => {
  const svg = readFileSync(join(here, 'chart.svg'), 'utf8');
  assert.match(svg, /role="img"/);
  assert.match(svg, /<desc id="d">/);
});

test('the README links the safety rules, and SAFETY.md exists', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
  assert.match(readFileSync(join(here, '..', '..', '..', 'SAFETY.md'), 'utf8'), /docker system prune/);
});

test('live: a container made with safeArgs has the limits, and cleanup removes it', { skip: dockerDown }, () => {
  const id = name(0, 'test-live');
  try {
    cleanup(0);
    const started = run(['run', '-d', ...safeArgs(0, 'test-live'), IMAGE, 'sleep', '60']);
    assert.equal(started.code, 0, started.stderr);

    const fmt = '{{.HostConfig.Memory}} {{.HostConfig.PidsLimit}} {{.HostConfig.Privileged}} {{index .Config.Labels "dkr.challenge"}}';
    const info = run(['inspect', id, '--format', fmt]).stdout.trim();
    assert.equal(info, `${64 * 1024 * 1024} 50 false 0`);

    const binds = run(['inspect', id, '--format', '{{json .HostConfig.Binds}}']).stdout.trim();
    assert.ok(!binds.includes('docker.sock'), 'the Docker socket must not be mounted');

    assert.deepEqual(leftovers(0), { containers: 1, networks: 0, volumes: 0 });
    const removed = cleanup(0);
    assert.equal(removed.containers.length, 1);
    assert.deepEqual(leftovers(0), { containers: 0, networks: 0, volumes: 0 });
  } finally {
    cleanup(0);
  }
});

test('live: cleanup does not remove an object that has no label', { skip: dockerDown }, () => {
  const decoy = name(0, 'test-decoy');
  try {
    assert.equal(run(['volume', 'create', decoy]).code, 0);
    assert.equal(run(['volume', 'create', ...label(0), name(0, 'test-labelled')]).code, 0);
    cleanup(0);
    assert.equal(run(['volume', 'inspect', decoy]).code, 0, 'the volume with no label is gone, cleanup is too wide');
    assert.equal(run(['volume', 'inspect', name(0, 'test-labelled')]).code, 1, 'the labelled volume should be gone');
  } finally {
    run(['volume', 'rm', decoy]);
    cleanup(0);
  }
});
