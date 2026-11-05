// Challenge 9, part 3 test.
// Run: node --test challenges/challenge-9-deploy-without-drops/part-3-restart-storm-and-stop-timeout/test.mjs
// It fails until settings.json stops the storm and shortens the stop, and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-9-deploy-without-drops/part-3-restart-storm-and-stop-timeout/run.mjs';

test('static check: the restart policy has a limit, and the stop is shortened', () => {
  const s = JSON.parse(readFileSync(join(filesDir(here), 'settings.json'), 'utf8'));
  assert.notEqual(s.restartPolicy, 'always', '"always" restarts a crashing container for ever. Use on-failure with a limit (maxRetries).');
  if (s.restartPolicy === 'on-failure') assert.ok(s.maxRetries >= 1 && s.maxRetries <= 5, `maxRetries is ${s.maxRetries}. Give it a number from 1 to 5.`);
  assert.ok(s.init === true || (s.stopTimeoutSeconds && s.stopTimeoutSeconds <= 2), 'Shorten the stop: run with init: true, or set stopTimeoutSeconds to 2 or less. On the reference machine the default wait is already about 3 s.');
});

test('the storm: your policy stops restarting (facts from run.mjs)', () => {
  assert.ok(getFact('c9.p3.always_restart_count') >= 5, `The control (--restart always) should have restarted at least 5 times in the window. ${hint}`);
  assert.ok(getFact('c9.p3.yours_restart_count') <= 5, `Your policy restarted the crashing container ${getFact('c9.p3.yours_restart_count')} times. ${hint}`);
  assert.equal(getFact('c9.p3.yours_final_status'), 'exited', `Your container should end up exited, not still restarting. ${hint}`);
});

test('the stop timeout was measured on this machine (facts from run.mjs)', () => {
  assert.ok(getFact('c9.p3.stop_default_s') > 0, hint);
  assert.equal(getFact('c9.p3.stop_default_exit_code'), 137, 'A process that ignores SIGTERM ends with SIGKILL, exit code 137');
  assert.ok(getFact('c9.p3.stop_t0_s') < getFact('c9.p3.stop_default_s'), 'docker stop -t 0 (kill at once) should be faster than the default wait');
  assert.ok(getFact('c9.p3.stop_t10_s') > getFact('c9.p3.stop_t2_s'), 'docker stop -t 10 should take longer than -t 2');
  assert.equal(getFact('c9.p3.stop_graceful_image_exit_code'), 0, 'daftar-api handles SIGTERM and exits with code 0');
});

test('your settings make the stop fast (facts from run.mjs)', () => {
  assert.ok(getFact('c9.p3.stop_yours_s') <= 3, `docker stop took ${getFact('c9.p3.stop_yours_s')} s with your settings. ${hint}`);
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
