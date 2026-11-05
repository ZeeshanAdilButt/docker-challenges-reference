// Challenge 9, part 3: a restart storm, and the mystery of how long `docker stop` really waits.
// Run: node challenges/challenge-9-deploy-without-drops/part-3-restart-storm-and-stop-timeout/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to use the fixed settings.json in reference/ instead of yours.
//
// (Part B is measured first, on a quiet daemon.)
// Part A: a container that crashes at once, under `--restart always` (the control) and under your restart policy.
//         We read its restart count every 250 ms for 60 s and write down when each restart happened.
// Part B: how long `docker stop` takes for a process that ignores SIGTERM, measured on this machine, with the
//         default and with each setting that changes it. Each timing is the median of three runs.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, name, run, runAsync, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, buildDaftar, daftarDir, docker, filesDir, pollUntil, removeImages, sleep } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 9, part 3: a restart storm, and how long docker stop waits');
const ALPINE = 'alpine:3.23';
const NAIVE = 'dkr-c9-naive3:1';
const GRACEFUL = 'dkr-c9-graceful3:1';
const settings = JSON.parse(readFileSync(join(filesDir(here), 'settings.json'), 'utf8'));
const WINDOW_S = 60;

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const policyArg = (s) => (s.restartPolicy === 'on-failure' && s.maxRetries > 0 ? `on-failure:${s.maxRetries}` : s.restartPolicy);

/** Start a container that exits with code 1 at once and write down when its restart count goes up. */
async function storm(what, policy) {
  const cname = name(CHALLENGE, what);
  const t0 = Date.now();
  await runAsync(['run', '-d', ...safeArgs(CHALLENGE, what, { memory: '32m', pids: 20 }), '--restart', policy, ALPINE, 'sh', '-c', 'exit 1']);
  const at = [];
  let last = 0;
  let finalStatus = 'running';
  let quiet = 0;
  while ((Date.now() - t0) / 1000 < WINDOW_S) {
    const r = await runAsync(['inspect', cname, '--format', '{{.RestartCount}} {{.State.Status}} {{.State.Restarting}}']);
    const [count, status, restarting] = r.stdout.trim().split(' ');
    finalStatus = status;
    if (Number(count) > last) {
      for (let k = last; k < Number(count); k++) at.push(round((Date.now() - t0) / 1000, 1));
      last = Number(count);
      quiet = 0;
    }
    // a container that has stopped for good (exited, not restarting) for 4 s will not restart again
    if (status === 'exited' && restarting === 'false') {
      quiet += 1;
      if (quiet >= 16) break;
    } else quiet = 0;
    await sleep(250);
  }
  return { count: last, at, status: finalStatus, seconds: round((Date.now() - t0) / 1000, 1) };
}

/** Time `docker stop` on a fresh container, three times. Returns { s (median), exit, runs }. */
async function stopTime(label, image, extraRun, cmd, stopArgs = []) {
  const runs = [];
  let exit = '';
  for (let i = 0; i < 3; i++) {
    const cname = name(CHALLENGE, label);
    await runAsync(['run', '-d', ...safeArgs(CHALLENGE, label, { memory: '64m', pids: 20 }), ...extraRun, image, ...cmd]);
    await sleep(1500); // let the process start and install its signal handlers
    const t0 = process.hrtime.bigint();
    await runAsync(['stop', ...stopArgs, cname], { timeoutMs: 90_000 });
    runs.push(Number(process.hrtime.bigint() - t0) / 1e9);
    exit = (await runAsync(['inspect', cname, '--format', '{{.State.ExitCode}}'])).stdout.trim();
    await runAsync(['rm', '-f', cname]);
  }
  return { s: round(median(runs), 1), exit, runs: runs.map((x) => round(x, 1)) };
}

try {
  cleanup(CHALLENGE);
  buildDaftar(NAIVE, join(daftarDir, 'Dockerfile.naive'));
  buildDaftar(GRACEFUL, join(daftarDir, 'Dockerfile'));

  const yoursPolicy = policyArg(settings);
  // The stop times are measured first, while the Docker daemon is quiet. A crash loop keeps it busy and slows every stop.

  const sleeper = ['sleep', '1000']; // PID 1 is sleep: it has no SIGTERM handler, so the signal is ignored
  const dflt = await stopTime('p3-stop-default', ALPINE, [], sleeper);
  // How the wait changes with docker stop -t N (0 means kill at once).
  const sweep = {};
  for (const n of [0, 1, 2, 3, 6, 10]) sweep[n] = await stopTime(`p3-stop-t${n}`, ALPINE, [], sleeper, ['-t', String(n)]);
  const short = sweep[2];
  const flag = await stopTime('p3-stop-flag', ALPINE, ['--stop-timeout', '3'], sleeper);
  const init = await stopTime('p3-stop-init', ALPINE, ['--init'], sleeper);
  const mine = await stopTime('p3-stop-yours', ALPINE, [...(settings.init ? ['--init'] : []), ...(settings.stopTimeoutSeconds ? ['--stop-timeout', String(settings.stopTimeoutSeconds)] : [])], sleeper);
  const naive = await stopTime('p3-stop-naive', NAIVE, [], []);
  const graceful = await stopTime('p3-stop-graceful', GRACEFUL, [], []);

  const configured = docker(['run', '-d', ...safeArgs(CHALLENGE, 'p3-inspect', { memory: '32m', pids: 20 }), ALPINE, 'sleep', '30'], {});
  const stopTimeoutField = docker(['inspect', configured, '--format', '{{.Config.StopTimeout}}']);
  const stopSignalField = docker(['inspect', configured, '--format', '[{{.Config.StopSignal}}]']);
  run(['rm', '-f', name(CHALLENGE, 'p3-inspect')]);

  rec.step('docker run --init   (alpine sleep 1000)   then: docker stop   (3 times)', `${init.runs.join(' s, ')} s   exit code ${init.exit}`, `With --init, a tiny init program is PID 1. It passes SIGTERM to sleep, so the container stops at once: median ${init.s} s.`);
  rec.step('docker run alpine:3.23 sleep 1000   then: docker stop   (3 times)', `${dflt.runs.join(' s, ')} s   exit code ${dflt.exit}`, `PID 1 is sleep and ignores SIGTERM. docker stop waits, then sends SIGKILL (exit code ${dflt.exit}). The default wait measured on this machine: ${dflt.s} s (median of 3). The docs say 10 s.`);
  rec.step('docker inspect <container> --format "{{.Config.StopTimeout}} [{{.Config.StopSignal}}]"', `${stopTimeoutField} ${stopSignalField}`, 'No stop timeout is stored in the container: it is empty, so Docker uses its built-in default. No stop signal is stored either, so Docker uses SIGTERM.');
  rec.step('docker stop -t N <container>   for N = 0, 1, 2, 3, 6, 10   (3 times each)', Object.entries(sweep).map(([n, r]) => `-t ${n}: ${r.runs.join(' s, ')} s   (median ${r.s} s)`).join('\n'), `The -t flag of docker stop overrides the wait for this one stop. Every stop also costs a fixed overhead on top of the wait (about ${sweep[0].s} s here, the time for -t 0 where nothing is waited for). The default behaves like -t ${Object.entries(sweep).map(([n, r]) => [n, Math.abs(r.s - dflt.s)]).sort((a, b) => a[1] - b[1])[0][0]} on this machine.`);
  rec.step('docker run --stop-timeout 3 ...   then: docker stop   (3 times)', `${flag.runs.join(' s, ')} s   exit code ${flag.exit}`, `--stop-timeout stores the wait in the container, so every stop of it uses it: median ${flag.s} s. In Compose this is stop_grace_period.`);
  rec.step(`your settings (init: ${settings.init}, stopTimeoutSeconds: ${settings.stopTimeoutSeconds})   then: docker stop   (3 times)`, `${mine.runs.join(' s, ')} s   exit code ${mine.exit}`, `Your settings: the stop takes ${mine.s} s.`);
  rec.step('docker stop the naive daftar-api image (shell-form CMD)   (3 times)', `${naive.runs.join(' s, ')} s   exit code ${naive.exit}`, `Node is behind a shell that does not forward SIGTERM, so it waits the default time and ends with SIGKILL: median ${naive.s} s.`);
  rec.step('docker stop the daftar-api image (exec-form CMD, handles SIGTERM)   (3 times)', `${graceful.runs.join(' s, ')} s   exit code ${graceful.exit}`, `Node is PID 1 and handles SIGTERM: it finishes its requests and exits with code ${graceful.exit}: median ${graceful.s} s.`);

  // Part A: the two crash loops side by side, now that the stop times are done.
  const [always, yours] = await Promise.all([storm('p3-storm-always', 'always'), storm('p3-storm-yours', yoursPolicy)]);
  const gaps = (r) => r.at.map((t, i) => round(t - (i ? r.at[i - 1] : 0), 1));
  rec.step(`docker run -d --restart always ${ALPINE} sh -c "exit 1"   (read RestartCount every 250 ms for ${WINDOW_S} s)`, `restart count: ${always.count}\nrestarted at (s): ${always.at.join(', ')}\ngaps (s): ${gaps(always).join(', ')}\nstatus at the end: ${always.status}`, `A container that crashes at once is restarted again and again, each wait about twice as long as the one before. The service is never up, and nothing ever says "this has failed". ${always.count} restarts in ${WINDOW_S} s.`);
  rec.step(`docker run -d --restart ${yoursPolicy} ${ALPINE} sh -c "exit 1"   (your restart policy)`, `restart count: ${yours.count}\nrestarted at (s): ${yours.at.join(', ')}\nstatus at the end: ${yours.status} (after ${yours.seconds} s)`, yours.status === 'exited' && yours.count <= 5 ? `Your policy gives up after ${yours.count} restarts and leaves the container exited, which a health check or an alert can see.` : 'Your policy keeps restarting the crashing container without limit.');

  setFact('c9.p3.always_restart_count', always.count);
  setFact('c9.p3.always_restart_at_s', always.at.join(','));
  setFact('c9.p3.always_window_s', WINDOW_S);
  setFact('c9.p3.yours_restart_count', yours.count);
  setFact('c9.p3.yours_final_status', yours.status);
  setFact('c9.p3.yours_policy', yoursPolicy);
  setFact('c9.p3.stop_default_s', dflt.s);
  setFact('c9.p3.stop_default_exit_code', Number(dflt.exit));
  for (const [n, r] of Object.entries(sweep)) setFact(`c9.p3.stop_t${n}_s`, r.s);
  setFact('c9.p3.stop_timeout_flag_s', flag.s);
  setFact('c9.p3.stop_init_s', init.s);
  setFact('c9.p3.stop_yours_s', mine.s);
  setFact('c9.p3.stop_naive_image_s', naive.s);
  setFact('c9.p3.stop_graceful_image_s', graceful.s);
  setFact('c9.p3.stop_graceful_image_exit_code', Number(graceful.exit));
  setFact('c9.p3.config_stop_timeout_field', stopTimeoutField);

  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Seconds docker stop waits for a process that ignores SIGTERM',
        unit: 's',
        bars: [
          { label: 'Default', value: dflt.s },
          { label: 'docker stop -t 0', value: sweep[0].s },
          { label: 'docker stop -t 2', value: short.s },
          { label: 'docker stop -t 6', value: sweep[6].s },
          { label: 'docker stop -t 10', value: sweep[10].s },
          { label: '--stop-timeout 3', value: flag.s },
          { label: '--init', value: init.s },
          { label: 'Your settings', value: mine.s },
        ],
      }),
    );
    writeFileSync(
      join(here, 'chart-storm.svg'),
      barsSvg({
        title: `Seconds after start when "--restart always" restarted a crashing container (first ${WINDOW_S} s)`,
        unit: 's',
        bars: always.at.map((t, i) => ({ label: `Restart ${i + 1}`, value: t })),
      }),
    );
    console.log('\nWrote results.md, chart.svg and chart-storm.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c9.p3');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages([NAIVE, GRACEFUL]);
}
