// Challenge 7, part 2 test.
// Run: node --test challenges/challenge-7-networks-and-volumes/part-2-the-localhost-trap/test.mjs
// It fails until api.env is fixed and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-7-networks-and-volumes/part-2-the-localhost-trap/run.mjs';

test('the same database looks different from different places (facts from run.mjs)', () => {
  assert.equal(getFact('c7.p2.api_localhost_result'), 'ECONNREFUSED', `Inside the api, localhost must be refused. ${hint}`);
  assert.equal(getFact('c7.p2.api_by_name_result'), 'open', `The name db must work on the shared network. ${hint}`);
  assert.equal(getFact('c7.p2.db_own_localhost_ok'), true, hint);
  assert.equal(getFact('c7.p2.host_published_result'), 'open', `The published port must work from your computer. ${hint}`);
  assert.equal(getFact('c7.p2.api_published_port_on_localhost_result'), 'ECONNREFUSED', hint);
});

test('api.env: DB_HOST is not localhost', () => {
  const text = readFileSync(join(filesDir(here), 'api.env'), 'utf8');
  const host = /^DB_HOST=(.*)$/m.exec(text)?.[1]?.trim();
  assert.ok(host, 'api.env needs a DB_HOST line');
  assert.ok(!['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host), `DB_HOST=${host} points the api at itself. Use the name of the database container's network alias.`);
});

test('the api can open a connection to the database with your api.env (live result of your run)', () => {
  assert.equal(getFact('c7.p2.api_env_result'), 'open', `The api could not reach the database with DB_HOST=${getFact('c7.p2.api_env_db_host')}. Fix api.env, then run run.mjs again. ${hint}`);
  assert.equal(getFact('c7.p2.api_env_db_host'), 'db', 'The database container has the network alias "db". Use DB_HOST=db.');
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
