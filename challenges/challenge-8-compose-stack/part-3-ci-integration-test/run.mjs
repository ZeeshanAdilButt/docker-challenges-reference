// Challenge 8, part 3: a CI integration test.
// Run: node challenges/challenge-8-compose-stack/part-3-ci-integration-test/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run the fixed ci.mjs in reference/ instead of yours.
//
// Runs ci.mjs (build, start the stack, integration test, clean up) in three situations and measures:
//   1. a normal run, three times (does it pass, how long, does it clean up);
//   2. a run where the api needs 12 s to warm up (does the pipeline wait for it);
//   3. a run where the test fails on purpose (does the pipeline still clean up).

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, run } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, PROJECT, compose, filesDir, freePort, removeStackImage } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 8, part 3: a CI integration test');
const ciFile = join(filesDir(here), 'ci.mjs');
const composeFile = join(here, 'compose.yaml');

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const containersLeft = () => run(['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`]).stdout.split('\n').filter(Boolean).length;
const sec = (ms) => round(ms / 1000, 1);
let env;

/** Run the pipeline once. Returns { status, ms, out, left } where left is how many containers it left running. */
function pipeline(extraEnv) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [ciFile], { env: { ...process.env, ...env, ...extraEnv }, encoding: 'utf8', timeout: 300_000, windowsHide: true });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const left = containersLeft();
  compose(composeFile, ['down', '-v', '--remove-orphans'], env, { timeoutMs: 120_000 }); // our own tidy-up between situations
  return { status: r.status ?? 1, ms, out, left };
}
const summary = (out) => out.split('\n').filter((l) => /^(\$ |# (tests|pass|fail)|not ok|ok )/.test(l.trim()) || /^\s*(✔|✖)/.test(l)).map((l) => l.trimEnd().replace(/^\$ (\S+) /, '$ $1 ')).slice(-14).join('\n');

try {
  cleanup(CHALLENGE);
  env = { API_PORT: String(await freePort()) };

  // 1. normal runs
  const normal = [];
  for (let i = 0; i < 3; i++) normal.push(pipeline({ API_START_DELAY_MS: '0' }));
  rec.step(`node ci.mjs   (normal run, first of 3; exit code ${normal[0].status})`, summary(normal[0].out), `${normal.filter((r) => r.status === 0).length} of 3 normal runs passed. The median run took ${sec(median(normal.map((r) => r.ms)))} s, from build to clean-up. After a passing run ${normal[0].left} containers were left.`);

  // 2. slow warm-up
  const slow = pipeline({ API_START_DELAY_MS: '12000' });
  rec.step(`API_START_DELAY_MS=12000 node ci.mjs   (exit code ${slow.status})`, summary(slow.out), slow.status === 0 ? 'The api needed 12 s before it listened, and the pipeline waited for it. It waits for the health check, not for a guess.' : 'The pipeline started the test before the api was listening, and the test failed for a reason that has nothing to do with the code. This is a flaky pipeline.');

  // 3. failing test
  const failing = pipeline({ API_START_DELAY_MS: '0', CI_EXPECT_VERSION: '999' });
  rec.step(`CI_EXPECT_VERSION=999 node ci.mjs   (exit code ${failing.status})`, summary(failing.out), `The test fails on purpose (the stack runs version 1, the test expects 999). The pipeline exited with ${failing.status}${failing.status === 0 ? ', which hides the failure' : ', as a failed test should'}, and ${failing.left} containers were still running afterwards${failing.left ? '. A failed run that does not clean up leaves a stack behind for the next job to trip over.' : '. A failed run cleaned up after itself.'}`);

  setFact('c8.p3.normal_pass_count', normal.filter((r) => r.status === 0).length);
  setFact('c8.p3.normal_total_s', sec(median(normal.map((r) => r.ms))));
  setFact('c8.p3.passing_run_leftover_containers_count', normal[0].left);
  setFact('c8.p3.slow_start_passes', slow.status === 0);
  setFact('c8.p3.slow_start_total_s', sec(slow.ms));
  setFact('c8.p3.failing_run_exit_nonzero', failing.status !== 0);
  setFact('c8.p3.failing_run_leftover_containers_count', failing.left);

  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Compose ${run(['compose', 'version', '--short']).stdout.trim()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Seconds from build to clean-up',
        unit: 's',
        bars: [
          { label: 'Normal run (median of 3)', value: sec(median(normal.map((r) => r.ms))) },
          { label: 'Slow warm-up (12 s)', value: sec(slow.ms) },
          { label: 'Failing test', value: sec(failing.ms) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c8.p3');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (env) compose(composeFile, ['down', '-v', '--remove-orphans'], env, { timeoutMs: 120_000 });
  cleanup(CHALLENGE);
  removeStackImage();
}
