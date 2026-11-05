// Challenge 9, part 1 test.
// Run: node --test challenges/challenge-9-deploy-without-drops/part-1-naive-vs-graceful-restart/test.mjs
// It fails until your Dockerfile lets SIGTERM reach node and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-9-deploy-without-drops/part-1-naive-vs-graceful-restart/run.mjs';

test('static check: the Dockerfile starts node in exec form, so node is PID 1', () => {
  const text = readFileSync(join(filesDir(here), 'Dockerfile'), 'utf8');
  const cmd = text.split('\n').filter((l) => /^\s*(CMD|ENTRYPOINT)\b/i.test(l));
  assert.ok(cmd.length > 0, 'The Dockerfile has no CMD');
  for (const l of cmd) {
    assert.match(l, /^\s*(CMD|ENTRYPOINT)\s+\[/i, `"${l.trim()}" is shell form. The shell becomes PID 1 and does not pass SIGTERM on. Use the exec form: CMD ["node", "server.mjs"].`);
  }
});

test('the naive control behaves as expected (facts from run.mjs)', () => {
  assert.ok(getFact('c9.p1.naive_restart_s') >= 3, `The naive image should make docker restart wait for the stop timeout. ${hint}`);
  assert.ok(getFact('c9.p1.naive_failed_count') > 0, `The naive restart should fail some requests. ${hint}`);
  assert.equal(getFact('c9.p1.naive_stop_exit_code'), 137, `The naive image should be killed, exit code 137. ${hint}`);
});

test('your image stops fast and exits cleanly on SIGTERM (facts from run.mjs)', () => {
  assert.ok(getFact('c9.p1.yours_restart_s') < 3, `docker restart took ${getFact('c9.p1.yours_restart_s')} s with your image. SIGTERM is not reaching node. ${hint}`);
  assert.equal(getFact('c9.p1.yours_stop_exit_code'), 0, `docker stop ended your container with exit code ${getFact('c9.p1.yours_stop_exit_code')}. Exit code 137 means it was killed; 0 means node handled SIGTERM. ${hint}`);
  assert.ok(getFact('c9.p1.yours_restart_s') < getFact('c9.p1.naive_restart_s'), `Your restart should be faster than the naive one. ${hint}`);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(9), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
