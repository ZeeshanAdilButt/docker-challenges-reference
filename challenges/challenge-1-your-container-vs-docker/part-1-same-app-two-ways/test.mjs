// Challenge 1, part 1 test.
// Run: node --test challenges/challenge-1-your-container-vs-docker/part-1-same-app-two-ways/test.mjs
// It fails until you have filled in answers.json and run run.mjs once. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { workDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Fill in answers.json, then run: node challenges/challenge-1-your-container-vs-docker/part-1-same-app-two-ways/run.mjs';
const answers = () => JSON.parse(readFileSync(join(workDir(here), 'answers.json'), 'utf8'));
const sorted = (a) => [...a].sort();

test('answers.json is filled in', () => {
  const a = answers();
  assert.ok(Array.isArray(a.docker_makes_namespaces) && a.docker_makes_namespaces.length > 0, 'docker_makes_namespaces is empty. List the namespace types Docker makes for a container.');
  assert.ok(Array.isArray(a.your_script_makes_namespaces) && a.your_script_makes_namespaces.length > 0, 'your_script_makes_namespaces is empty. List the ones your script makes.');
  assert.ok(['docker', 'your script'].includes(a.who_runs_the_image_user), 'who_runs_the_image_user must be "docker" or "your script"');
  assert.equal(typeof a.docker_proc_sys_writable, 'boolean', 'docker_proc_sys_writable must be true or false');
  assert.ok(['docker', 'your script'].includes(a.more_mounts), 'more_mounts must be "docker" or "your script"');
  assert.equal(typeof a.node_sees_its_limit_in_your_container, 'boolean', 'node_sees_its_limit_in_your_container must be true or false');
});

test('run.mjs saved the facts from your run', () => {
  assert.ok(getFact('c1.p1.start_mini_s') > 0, `c1.p1.start_mini_s is missing. ${hint}`);
  assert.ok(getFact('c1.p1.start_docker_s') > 0, `c1.p1.start_docker_s is missing. ${hint}`);
  assert.equal(getFact('c1.p1.pid1_both_node'), true, `node should be PID 1 in both containers. ${hint}`);
  assert.equal(getFact('c1.p1.memory_max_mini_bytes'), 134217728, `Your container should show a 128 MB limit. ${hint}`);
  assert.equal(getFact('c1.p1.memory_max_docker_bytes'), 134217728, `Docker's container should show a 128 MB limit. ${hint}`);
});

test('your answers match what the probe measured', () => {
  const a = answers();
  const ns = getFact('c1.p1.ns_new_docker');
  assert.ok(ns, `c1.p1.ns_new_docker is missing. ${hint}`);
  assert.deepEqual(sorted(a.docker_makes_namespaces), sorted(ns.split(',')), 'Which namespaces does Docker make that the host did not have? Read the "namespaces it made" row.');
  assert.deepEqual(sorted(a.your_script_makes_namespaces), sorted(getFact('c1.p1.ns_new_mini').split(',')), 'Which namespaces does your script make? Read the "namespaces it made" row.');
  const dockerUser = getFact('c1.p1.uid_docker') !== 0 && getFact('c1.p1.uid_mini') === 0 ? 'docker' : 'your script';
  assert.equal(a.who_runs_the_image_user, dockerUser, 'Which one ran the app as the user from the image (USER node)?');
  assert.equal(a.docker_proc_sys_writable, getFact('c1.p1.proc_sys_writable_docker'), 'Can the process write /proc/sys inside the Docker container?');
  const more = getFact('c1.p1.mounts_docker') > getFact('c1.p1.mounts_mini') ? 'docker' : 'your script';
  assert.equal(a.more_mounts, more, 'Which container sees more mounts?');
  assert.equal(a.node_sees_its_limit_in_your_container, getFact('c1.p1.node_limit_seen_mini_mb') > 0, 'Does node read the 128 MB limit when it runs in your container?');
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
