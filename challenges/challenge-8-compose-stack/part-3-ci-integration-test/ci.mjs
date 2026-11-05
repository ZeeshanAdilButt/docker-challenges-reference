// The pipeline, as a script: build the image, start the stack, run the integration test, clean up.
// It does the same things as the job in ci.yml. run.mjs runs it in three situations and measures what happens.
// Settings come from the environment: API_PORT, API_START_DELAY_MS, CI_EXPECT_VERSION.
// Edit this file so that the pipeline is reliable: it must wait for the stack properly, and it must
// always clean up, also when the tests fail.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = import.meta.dirname; // the folder of this file
const compose = join(root, 'compose.yaml');
const stack = join(root, '..', 'stack');
const env = {
  ...process.env,
  APP_VERSION: '1',
  API_URL: `http://127.0.0.1:${process.env.API_PORT}`,
  EXPECT_VERSION: process.env.CI_EXPECT_VERSION ?? '1',
};

const sh = (cmd, args) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { stdio: 'inherit', env });
};
const dc = (...args) => sh('docker', ['compose', '-p', 'dkr-c8', '-f', compose, ...args]);

sh('docker', ['build', '-q', '-t', 'dkr-c8-stack:1', '--label', 'dkr.challenge=8', stack]);

dc('up', '-d');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000); // give the stack three seconds to start

const tests = sh(process.execPath, ['--test', join(root, 'integration.test.mjs')]);
if (tests.status !== 0) process.exit(tests.status);

dc('down', '-v');
