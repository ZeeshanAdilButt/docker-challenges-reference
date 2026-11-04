// Challenge 7, part 3 test.
// Run: node --test challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/test.mjs
// It fails until compose.yaml is fixed and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers, run } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/run.mjs';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';

// The normalised compose file, the way Docker Compose reads it.
function loadSpec() {
  const r = run(['compose', '-f', join(filesDir(here), 'compose.yaml'), 'config', '--format', 'json'], {
    env: { WEB_PORT: '41001', API_PORT: '41002', DB_PORT: '41003' },
  });
  assert.equal(r.code, 0, `compose.yaml is not valid: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const ports = (svc) => svc.ports ?? [];
const netsOf = (svc) => Object.keys(svc.networks ?? { default: null });

test('static check: the database has no published port', { skip: dockerDown }, () => {
  const { services } = loadSpec();
  assert.equal(ports(services.db).length, 0, 'db publishes a port. A database needs no door on your computer: the api reaches it by name on the network. Remove "ports" from db.');
});

test('static check: every published port is bound to 127.0.0.1, and the api is not published', { skip: dockerDown }, () => {
  const { services } = loadSpec();
  assert.equal(ports(services.api).length, 0, 'api publishes a port. Only web should be reachable from outside; web talks to api on the network.');
  for (const [name, svc] of Object.entries(services)) {
    for (const p of ports(svc)) {
      assert.equal(p.host_ip, '127.0.0.1', `${name} publishes ${p.published} on every address. Write "127.0.0.1:\${WEB_PORT}:80" so only your computer can use it.`);
    }
  }
});

test('static check: web and db share no network, and the Docker socket is not mounted', { skip: dockerDown }, () => {
  const { services } = loadSpec();
  const shared = netsOf(services.web).filter((n) => netsOf(services.db).includes(n));
  assert.deepEqual(shared, [], `web and db are both on ${shared.join(', ')}. Put db on a network that web is not on (api sits on both).`);
  assert.ok(netsOf(services.api).some((n) => netsOf(services.web).includes(n)), 'api must share a network with web');
  assert.ok(netsOf(services.api).some((n) => netsOf(services.db).includes(n)), 'api must share a network with db');
  for (const [name, svc] of Object.entries(services)) {
    for (const v of svc.volumes ?? []) assert.ok(!String(v.source ?? '').includes('docker.sock'), `${name} mounts the Docker socket`);
  }
});

test('the scan found nothing but web on your computer, and the stack still works (facts from run.mjs)', () => {
  assert.equal(getFact('c7.p3.db_published'), false, `The database is still published. ${hint}`);
  assert.equal(getFact('c7.p3.db_reachable_from_lan'), false, hint);
  assert.equal(getFact('c7.p3.lan_reachable_count'), 0, `Some ports still answer on your network address. ${hint}`);
  assert.equal(getFact('c7.p3.wildcard_bound_count'), 0, hint);
  assert.equal(getFact('c7.p3.web_reaches_db'), false, `The web tier can still open the database. ${hint}`);
  assert.equal(getFact('c7.p3.api_reaches_db'), true, `The api must still reach the database. ${hint}`);
  assert.equal(getFact('c7.p3.end_to_end_ok'), true, `The page must still load through web and api. ${hint}`);
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
