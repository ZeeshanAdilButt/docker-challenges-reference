// Challenge 4, part 2 test.
// Run: node --test challenges/challenge-4-slim-lock-drop-root/part-2-non-root-read-only/test.mjs
// It fails until run.mjs shows a numeric non-root user, a read-only root and one writable folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-4-slim-lock-drop-root/part-2-non-root-read-only/run.mjs';
const f = (what) => getFact(`c4.p2.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('service_uid'), undefined, `No facts yet. ${hint}`);
});

test('the service answers /health with your Dockerfile and flags', () => {
  assert.equal(f('health_ok'), true, 'The service did not answer /health. Run it by hand and read the logs. A read-only root or a wrong owner is the usual reason.');
});

test('the service does not run as root', () => {
  assert.ok(f('service_uid') > 0, `The service runs as uid ${f('service_uid')}. Add a USER line to the Dockerfile.`);
});

test('the user in the image is a number, not a name', () => {
  assert.equal(f('image_user_numeric'), true, 'Use USER 10001:10001 (numbers). Kubernetes can check "runAsNonRoot" only against a number.');
});

test('the image listens on a port above 1023', () => {
  assert.ok(f('port_num') >= 1024, `PORT is ${f('port_num')}. Do not depend on a runtime setting that lets non-root open low ports. Use 8080.`);
});

test('the root filesystem is read-only', () => {
  assert.equal(f('readonly_root'), true, 'Add the flag --read-only to run-flags.txt.');
});

test('the app can still write to /app/data', () => {
  assert.equal(
    f('data_writable'),
    true,
    'The app cannot write to /app/data. Mount the volume in run-flags.txt, and make the folder in the Dockerfile owned by your user (RUN mkdir ... && chown ...).',
  );
});

test('the app cannot change its own code or /etc', () => {
  assert.equal(f('code_writable'), false, 'The app user can write to /app. Keep the code owned by root.');
  assert.equal(f('etc_writable'), false, '/etc is writable.');
});

test('the process has no Linux powers left', () => {
  assert.equal(f('caps_yours'), 0, `The process still has ${f('caps_yours')} capabilities. Add --cap-drop ALL to run-flags.txt.`);
});

test('fewer than half of the six probe paths are writable', () => {
  assert.ok(f('writable_paths_yours') <= 2, `${f('writable_paths_yours')} of 6 paths are writable. Only /app/data and /tmp should be.`);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(4), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
