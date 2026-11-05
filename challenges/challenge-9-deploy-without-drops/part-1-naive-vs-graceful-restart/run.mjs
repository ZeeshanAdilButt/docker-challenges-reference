// Challenge 9, part 1: restart a service under load and count the failed requests.
// Run: node challenges/challenge-9-deploy-without-drops/part-1-naive-vs-graceful-restart/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to build the fixed Dockerfile in reference/ instead of yours.
//
// Two images of daftar-api: the naive one (shell-form CMD, the control) and the one built from your Dockerfile.
// For each: start a container, send load at it, run `docker restart` in the middle, and count what failed.
// Each image is tried three times and the median is kept.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, name, run, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, buildDaftar, daftarDir, docker, filesDir, freePort, get, pollUntil, removeImages, sleep, timedDocker } from '../lib.mjs';
import { startLoad } from '../load.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 9, part 1: restart a service under load');
const APP = name(CHALLENGE, 'p1-app');
const NAIVE = 'dkr-c9-naive:1';
const YOURS = 'dkr-c9-yours:1';

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** One trial: start the container, send load, restart in the middle, stop the load. */
async function trial(image) {
  const port = await freePort();
  docker(['run', '-d', ...safeArgs(CHALLENGE, 'p1-app', { memory: '128m' }), '-p', `127.0.0.1:${port}:8080`, image]);
  const url = `http://127.0.0.1:${port}`;
  try {
    await pollUntil(async () => (await get(`${url}/health`)).status === 200, { timeoutMs: 20_000 });
    const load = startLoad({ url });
    await sleep(2000);
    const restart = timedDocker(['restart', APP], { timeoutMs: 60_000 });
    await pollUntil(async () => (await get(`${url}/health`)).status === 200, { timeoutMs: 20_000 });
    await sleep(2000);
    const r = await load.stop();
    // then stop it once more by hand: how long does it take, and how does the process end? (137 = killed, 0 = clean exit)
    const stopped = timedDocker(['stop', APP], { timeoutMs: 60_000 });
    r.stop_s = stopped.ms / 1000;
    r.stop_exit = Number(run(['inspect', APP, '--format', '{{.State.ExitCode}}']).stdout.trim());
    console.error(`  trial: restart ${round(restart.ms / 1000, 1)} s, sent ${r.total}, failed ${r.failed} (refused ${r.refused}, reset ${r.reset}, timeout ${r.timeout}, 5xx ${r.http_5xx}, other ${r.other})`);
    return { ...r, restart_s: restart.ms / 1000 };
  } finally {
    run(['rm', '-f', APP]);
  }
}

const med = (list, key) => median(list.map((r) => r[key]));
const row = (list) => ({
  total: med(list, 'total'),
  failed: med(list, 'failed'),
  refused: med(list, 'refused'),
  reset: med(list, 'reset'),
  timeout: med(list, 'timeout'),
  http_5xx: med(list, 'http_5xx'),
  outage_ms: med(list, 'outage_ms'),
  restart_s: round(med(list, 'restart_s'), 1),
  stop_s: round(med(list, 'stop_s'), 1),
  stop_exit: med(list, 'stop_exit'),
});
const describe = (r) => `requests: ${r.total}   failed: ${r.failed}   (refused ${r.refused}, reset ${r.reset}, timeout ${r.timeout}, 5xx ${r.http_5xx})\ndocker restart took ${r.restart_s} s; first to last failure: ${r.outage_ms} ms`;

try {
  cleanup(CHALLENGE);
  buildDaftar(NAIVE, join(daftarDir, 'Dockerfile.naive'));
  buildDaftar(YOURS, join(filesDir(here), 'Dockerfile'));

  const naiveRuns = [];
  for (let i = 0; i < 3; i++) naiveRuns.push(await trial(NAIVE));
  const naive = row(naiveRuns);
  rec.step(
    `docker build -f daftar-api/Dockerfile.naive daftar-api ; load.mjs while: docker restart ${APP}   (median of 3)`,
    describe(naive),
    `The naive image ignores SIGTERM (the shell in front of node does not pass it on), so docker restart has to wait for the stop timeout and then kills node: ${naive.restart_s} s for the restart, and a later docker stop ends with exit code ${naive.stop_exit} (killed). While it waits, the old process keeps serving. When it is killed, requests in flight are cut.`,
  );

  const yoursRuns = [];
  for (let i = 0; i < 3; i++) yoursRuns.push(await trial(YOURS));
  const yours = row(yoursRuns);
  rec.step(
    `docker build -f ${useRef() ? 'reference/' : ''}Dockerfile daftar-api ; load.mjs while: docker restart ${APP}   (median of 3)`,
    describe(yours),
    yours.restart_s < 3 && yours.stop_exit === 0
      ? `Your image restarts in ${yours.restart_s} s and a docker stop ends with exit code 0: node received SIGTERM and finished cleanly. Requests still fail during the restart (${yours.failed}, of which ${yours.refused} refused and ${yours.reset} reset), because for a moment nobody is listening. A graceful stop is necessary and not enough. Part 2 closes the gap.`
      : `Your image still stops slowly or is killed (restart ${yours.restart_s} s, stop exit code ${yours.stop_exit}). Does SIGTERM reach node?`,
  );

  setFact('c9.p1.naive_total_count', naive.total);
  setFact('c9.p1.naive_failed_count', naive.failed);
  setFact('c9.p1.naive_refused_count', naive.refused);
  setFact('c9.p1.naive_reset_count', naive.reset);
  setFact('c9.p1.naive_outage_ms', naive.outage_ms);
  setFact('c9.p1.naive_restart_s', naive.restart_s);
  setFact('c9.p1.yours_total_count', yours.total);
  setFact('c9.p1.yours_failed_count', yours.failed);
  setFact('c9.p1.yours_refused_count', yours.refused);
  setFact('c9.p1.yours_reset_count', yours.reset);
  setFact('c9.p1.yours_outage_ms', yours.outage_ms);
  setFact('c9.p1.yours_restart_s', yours.restart_s);
  setFact('c9.p1.naive_stop_s', naive.stop_s);
  setFact('c9.p1.naive_stop_exit_code', naive.stop_exit);
  setFact('c9.p1.yours_stop_s', yours.stop_s);
  setFact('c9.p1.yours_stop_exit_code', yours.stop_exit);

  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Failed requests during one docker restart (median of 3)',
        unit: 'requests',
        bars: [
          { label: 'Naive image', value: naive.failed },
          { label: 'Your image', value: yours.failed },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c9.p1');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages([NAIVE, YOURS]);
}

function useRef() {
  return process.argv.includes('--reference');
}
