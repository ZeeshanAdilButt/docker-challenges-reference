// Challenge 7, part 1 test.
// Run: node --test challenges/challenge-7-networks-and-volumes/part-1-default-vs-user-defined-bridge/test.mjs
// It fails until your topology.json is fixed and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-7-networks-and-volumes/part-1-default-vs-user-defined-bridge/run.mjs';
const spec = () => JSON.parse(readFileSync(join(filesDir(here), 'topology.json'), 'utf8'));

test('the default bridge cannot resolve names, a user-defined bridge can (facts from run.mjs)', () => {
  assert.equal(getFact('c7.p1.default_bridge_name_lookup_ok'), false, `Default bridge lookup fact is missing. ${hint}`);
  assert.equal(getFact('c7.p1.default_bridge_ip_reach_ok'), true, `Reaching by IP on the default bridge should work. ${hint}`);
  assert.equal(getFact('c7.p1.user_bridge_nameserver'), '127.0.0.11', `A user-defined network should use Docker's DNS at 127.0.0.11. ${hint}`);
  assert.equal(getFact('c7.p1.user_bridge_name_lookup_ok'), true, hint);
  assert.equal(getFact('c7.p1.user_bridge_name_reach_ok'), true, hint);
  assert.equal(getFact('c7.p1.cross_network_ip_reach_ok'), false, `Two separate networks must not reach each other. ${hint}`);
});

test('topology.json: api and db are on a user-defined network, not on "bridge"', () => {
  const s = spec();
  for (const c of s.containers) {
    assert.notEqual(c.network, 'bridge', `"${c.name}" is on the default bridge. Put it on a network you create, and list that network in "networks".`);
    assert.ok(s.networks.includes(c.network), `"${c.name}" uses the network "${c.network}", which is not listed in "networks".`);
  }
  const nets = new Set(s.containers.map((c) => c.network));
  assert.equal(nets.size, 1, 'api and db must share one network, or they cannot see each other');
});

test('api reaches db by the name "db" (the live result of your run)', () => {
  assert.equal(getFact('c7.p1.topology_name_ok'), true, `api could not reach db by name. Fix topology.json, then run run.mjs again. ${hint}`);
  assert.ok(getFact('c7.p1.topology_user_networks_count') >= 1, 'Your topology created no user-defined network.');
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(7), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
