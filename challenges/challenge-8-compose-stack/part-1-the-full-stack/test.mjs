// Challenge 8, part 1 test.
// Run: node --test challenges/challenge-8-compose-stack/part-1-the-full-stack/test.mjs
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
const hint = 'Run: node challenges/challenge-8-compose-stack/part-1-the-full-stack/run.mjs';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';

// The normalised compose file, the way Docker Compose reads it. --profile tools shows the profile services too.
function loadSpec() {
  const r = run(['compose', '-f', join(filesDir(here), 'compose.yaml'), '--profile', 'tools', 'config', '--format', 'json'], { env: { API_PORT: '41001' } });
  assert.equal(r.code, 0, `compose.yaml is not valid: ${r.stderr}`);
  return JSON.parse(r.stdout).services;
}
const cond = (svc, dep) => svc.depends_on?.[dep]?.condition;

test('static check: start order uses health and completion, not just "started"', { skip: dockerDown }, () => {
  const s = loadSpec();
  assert.ok(s.db.healthcheck && !s.db.healthcheck.disable, 'db needs a healthcheck (for example pg_isready), or nothing can wait for it to be ready.');
  assert.equal(cond(s.migrate, 'db'), 'service_healthy', 'migrate must wait until db is healthy: depends_on: { db: { condition: service_healthy } }');
  for (const name of ['api', 'worker']) {
    assert.equal(cond(s[name], 'db'), 'service_healthy', `${name} must wait for db to be healthy`);
    assert.equal(cond(s[name], 'migrate'), 'service_completed_successfully', `${name} must wait for the migrate job to finish successfully`);
  }
});

test('static check: restart policies, retries in the app, and the psql tool behind a profile', { skip: dockerDown }, () => {
  const s = loadSpec();
  for (const name of ['db', 'cache', 'api', 'worker']) {
    assert.ok(['unless-stopped', 'always', 'on-failure'].includes(s[name].restart), `${name} needs a restart policy, otherwise a crash leaves it dead.`);
  }
  assert.equal(s.migrate.restart ?? 'no', 'no', 'the migrate job must not restart: it runs once');
  assert.ok(Number(s.api.environment?.STARTUP_RETRIES) > 0, 'the api needs STARTUP_RETRIES above 0: the app retries too, health conditions are not enough on their own.');
  assert.deepEqual(s.psql.profiles, ['tools'], 'psql is a tool, not part of the stack. Put it in the profile "tools" so a plain "up" does not start it.');
});

test('the stack comes up by itself, and the work flows through it (facts from run.mjs)', () => {
  assert.equal(getFact('c8.p1.boot_ready'), true, `The api never became ready. ${hint}`);
  assert.equal(getFact('c8.p1.crashed_services_count'), 0, `Some services exited with an error at start-up. ${hint}`);
  assert.equal(getFact('c8.p1.psql_started_by_default'), false, hint);
  assert.equal(getFact('c8.p1.worker_processed_jobs_count'), 5, hint);
  assert.equal(getFact('c8.p1.psql_profile_tables_count'), 2, hint);
});

test('killing the database: the stack recovers on its own (facts from run.mjs)', () => {
  assert.equal(getFact('c8.p1.db_outage_api_alive'), true, hint);
  assert.equal(getFact('c8.p1.db_outage_recovered'), true, `The stack did not recover after the database was killed. ${hint}`);
  assert.ok(getFact('c8.p1.db_outage_recover_s') <= 30, 'Recovery took more than 30 s');
  assert.ok(getFact('c8.p1.worker_restarts_count') >= 1, 'The worker should have restarted at least once');
  assert.equal(getFact('c8.p1.worker_after_outage_processed_count'), 5, hint);
  assert.equal(getFact('c8.p1.data_survived_outage'), true, hint);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(8), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
