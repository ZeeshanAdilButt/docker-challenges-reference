// The pipeline, as a script: build the image, start the stack, wait for it to be healthy,
// run the integration test, and always clean up.
// It does the same things as the job in ci.yml. run.mjs runs it in three situations and measures what happens.
// Settings come from the environment: API_PORT, API_START_DELAY_MS, CI_EXPECT_VERSION.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..'); // the part folder, one level above reference/
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

let exitCode = 1;
try {
  sh('docker', ['build', '-q', '-t', 'dkr-c8-stack:1', '--label', 'dkr.challenge=8', stack]);

  // --wait returns when every service is healthy (or finished successfully), and fails if one never gets there.
  const up = dc('up', '-d', '--wait', '--wait-timeout', '90');
  if (up.status !== 0) throw new Error('the stack did not become healthy');

  const tests = sh(process.execPath, ['--test', join(root, 'integration.test.mjs')]);
  exitCode = tests.status ?? 1;
} catch (e) {
  console.error(String(e.message));
} finally {
  // Runs whether the tests passed, failed or never started.
  dc('down', '-v', '--remove-orphans');
}
process.exit(exitCode);
