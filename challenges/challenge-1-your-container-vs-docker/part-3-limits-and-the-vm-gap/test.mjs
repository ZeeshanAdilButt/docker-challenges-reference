// Challenge 1, part 3 test.
// Run: node --test challenges/challenge-1-your-container-vs-docker/part-3-limits-and-the-vm-gap/test.mjs
// It fails until limit.json is right and you have run run.mjs once. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { workDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Edit limit.json, then run: node challenges/challenge-1-your-container-vs-docker/part-3-limits-and-the-vm-gap/run.mjs';
const limit = () => JSON.parse(readFileSync(join(workDir(here), 'limit.json'), 'utf8')).container_limit_mb;

test('limit.json is a number of megabytes below the 256 MB machine', () => {
  const mb = limit();
  assert.ok(Number.isInteger(mb) && mb > 0, 'container_limit_mb must be a whole number of megabytes');
  assert.ok(mb < 256, `${mb} MB is not below the machine's 256 MB. The machine runs out first and kills the app. Pick a limit the container reaches first.`);
  assert.ok(mb >= 96, `${mb} MB is too small: node needs about 50 MB just to start, so the app would die in the first request.`);
});

test('the facts come from a run with the current limit.json', () => {
  assert.equal(getFact('c1.p3.gap_container_limit_mb'), limit(), `The last run used a different limit.json. ${hint}`);
});

test('the app was stopped by its own limit, not by the machine under it', () => {
  assert.equal(getFact('c1.p3.gap_killed_by_own_limit'), true, `The machine's memory ran out before the container limit. ${hint}`);
  assert.ok(getFact('c1.p3.gap_inner_max_events') > 0, `The container's memory.events should show it hit its own max. ${hint}`);
});

test('the same 128 MB limit reads the same in your cgroup and in Docker', () => {
  assert.equal(getFact('c1.p3.memory_max_mini_bytes'), 134217728, `${hint}`);
  assert.equal(getFact('c1.p3.memory_max_docker_bytes'), 134217728, `${hint}`);
});

test('docker stats shows the working set, not memory.current', () => {
  assert.equal(getFact('c1.p3.stats_is_working_set'), true, `docker stats should match memory.current minus inactive_file. ${hint}`);
  assert.ok(getFact('c1.p3.docker_inactive_file_mib') > 5, `The run should have created some page cache. ${hint}`);
  assert.ok(getFact('c1.p3.docker_current_mib') > getFact('c1.p3.docker_stats_mib'), `memory.current should be larger than docker stats. ${hint}`);
});

test('hitting the limit ends the same way in both', () => {
  assert.equal(getFact('c1.p3.docker_oom_killed'), true, hint);
  assert.equal(getFact('c1.p3.docker_exit_code'), 137, hint);
  assert.ok(getFact('c1.p3.mini_oom_kill_events') >= 1, hint);
  assert.equal(getFact('c1.p3.mini_alive_after_oom'), false, hint);
});

test('a container sees the machine memory, not its limit', () => {
  assert.equal(getFact('c1.p3.container_sees_ram_mb'), getFact('c1.p3.vm_ram_mb'), hint);
  assert.ok(getFact('c1.p3.container_sees_ram_mb') > 128, hint);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(1), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.match(readFileSync(join(here, 'chart.svg'), 'utf8'), /role="img"/);
});
