// Challenge 8, part 1: the full stack, then kill the database.
// Run: node challenges/challenge-8-compose-stack/part-1-the-full-stack/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to use the fixed compose.yaml in reference/ instead of yours.
//
// Builds the stack image, starts compose.yaml (db, cache, migrate job, api, worker), times how long until
// the api is ready, pushes jobs through the worker, then kills the database and watches what recovers.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, run } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { PROJECT, buildStackImage, compose, composeOk, docker, filesDir, freePort, get, pollUntil, projectVolumes, removeStackImage, CHALLENGE } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 8, part 1: the full stack, then kill the database');
const file = join(filesDir(here), 'compose.yaml');
const READY_CAP_MS = 45_000;
const volumes = new Set();

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** The services of the project and their state: [{ service, state, exit, health }]. */
function services() {
  const r = compose(file, ['ps', '-a', '--format', 'json'], env);
  const text = r.stdout.trim();
  if (!text) return [];
  const items = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return items.map((c) => ({ service: c.Service, state: c.State, exit: c.ExitCode, health: c.Health || '-' })).sort((a, b) => a.service.localeCompare(b.service));
}
const table = (list) => ['service  state     exit  health', ...list.map((s) => `${s.service.padEnd(9)}${s.state.padEnd(10)}${String(s.exit).padEnd(6)}${s.health}`)].join('\n');
const sec = (ms) => round(ms / 1000, 1);

let env;
try {
  cleanup(CHALLENGE);
  buildStackImage();
  env = { API_PORT: String(await freePort()) };
  const base = `http://127.0.0.1:${env.API_PORT}`;
  let boots = [];
  let ready = false;

  // Boot the stack up to three times and time how long until /ready answers 200. The last boot is kept.
  for (let i = 0; i < 3; i++) {
    if (i > 0) composeOk(file, ['down', '-v', '--remove-orphans'], env);
    const t0 = process.hrtime.bigint();
    compose(file, ['up', '-d'], env, { timeoutMs: 120_000 });
    const r = await pollUntil(async () => (await get(`${base}/ready`)).status === 200, { timeoutMs: READY_CAP_MS });
    projectVolumes().forEach((v) => volumes.add(v));
    ready = Boolean(r.value);
    boots.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (i === 0) {
      const list = services();
      rec.step(
        `docker compose -p ${PROJECT} up -d   (then: docker compose -p ${PROJECT} ps -a)`,
        table(list),
        ready ? `The api answered /ready after ${sec(boots[0])} s. The migrate job ran once and exited with 0.` : `The api was not ready after ${sec(READY_CAP_MS)} s. Look at the exit codes: something started before what it needs, and nothing started it again.`,
      );
    }
    if (!ready) break; // no point timing a stack that does not come up
  }
  const timeToReady = ready ? sec(median(boots)) : sec(READY_CAP_MS);
  const states = services();
  const crashed = states.filter((s) => s.state === 'exited' && s.exit !== 0);
  const psqlDefault = states.some((s) => s.service === 'psql');
  if (ready) rec.step(`(boot timing: ${boots.map((b) => `${sec(b)} s`).join(', ')})`, `time to ready, median of 3: ${timeToReady} s`, 'From docker compose up -d until the api answers /ready with 200. This includes the database starting for the first time.');

  const base2 = `http://127.0.0.1:${env.API_PORT}`;
  const stats = async () => (await get(`${base2}/stats`)).json;

  // Work flows through the whole stack: api -> cache -> worker -> database.
  let processed = 0;
  let notes = 0;
  if (ready) {
    await get(`${base2}/notes?body=hello`, { method: 'POST' });
    await get(`${base2}/jobs?n=5`, { method: 'POST' });
    await pollUntil(async () => (await stats())?.jobs_done >= 5, { timeoutMs: 20_000 });
    const s = await stats();
    processed = s?.jobs_done ?? 0;
    notes = s?.notes ?? 0;
    rec.step(`curl -X POST ${base2}/notes?body=hello ; curl -X POST ${base2}/jobs?n=5 ; curl ${base2}/stats`, JSON.stringify(s), `The api wrote a note and put 5 jobs on the cache list. The worker took them and wrote ${processed} rows to the database.`);
  }

  // The tool behind a profile.
  let tables = 0;
  if (ready) {
    const r = compose(file, ['--profile', 'tools', 'run', '--rm', '-T', 'psql', '-c', '\\dt'], env, { timeoutMs: 60_000 });
    tables = r.stdout.split('\n').filter((l) => l.includes('| table |')).length;
    rec.step(`docker compose -p ${PROJECT} --profile tools run --rm psql -c "\\dt"`, r.stdout.trim() || r.stderr.trim(), `The psql tool only exists when you ask for the "tools" profile. It found ${tables} tables.`);
  }

  // Kill the database.
  let aliveDuring = false;
  let detectS = 0;
  let recovered = false;
  let recoverS = sec(READY_CAP_MS);
  let workerRestarts = 0;
  let afterProcessed = 0;
  let survived = false;
  if (ready) {
    const killT0 = process.hrtime.bigint();
    // A crash: SIGQUIT makes the Postgres main process stop at once, and the container exits with an error code.
    docker(['exec', `${PROJECT}-db-1`, 'kill', '-QUIT', '1']);
    const down = await pollUntil(async () => (await get(`${base2}/ready`)).status === 503, { timeoutMs: 10_000, intervalMs: 100 });
    detectS = sec(Number(process.hrtime.bigint() - killT0) / 1e6);
    aliveDuring = (await get(`${base2}/health`)).status === 200;
    rec.step(`docker exec ${PROJECT}-db-1 kill -QUIT 1 ; curl ${base2}/ready ; curl ${base2}/health`, `/ready -> ${down.value ? 503 : 'still 200'} after ${detectS} s\n/health -> ${aliveDuring ? 200 : 'no answer'}`, !down.value ? '/ready never said 503, so the api cannot tell that its database is gone.' : aliveDuring ? 'The api noticed within a moment. /ready says 503 because the database is gone, but the api process itself is alive: that is what /health is for.' : 'The api did not survive the loss of the database.');

    const back = await pollUntil(async () => (await get(`${base2}/ready`)).status === 200, { timeoutMs: READY_CAP_MS, intervalMs: 250 });
    recovered = Boolean(back.value);
    recoverS = sec(Number(process.hrtime.bigint() - killT0) / 1e6);
    const after = services();
    rec.step(`docker compose -p ${PROJECT} ps -a   (after waiting up to ${sec(READY_CAP_MS)} s for /ready)`, table(after), recovered ? `Everything came back by itself, ${recoverS} s after the kill. The restart policy brought the database back, and the api found it on its next request.` : `Nothing brought the database back in ${sec(READY_CAP_MS)} s. With no restart policy, a container that crashed stays dead.`);

    if (recovered) {
      workerRestarts = Number(docker(['inspect', `${PROJECT}-worker-1`, '--format', '{{.RestartCount}}']));
      const before = (await stats())?.jobs_done ?? 0;
      await get(`${base2}/jobs?n=5`, { method: 'POST' });
      await pollUntil(async () => ((await stats())?.jobs_done ?? 0) >= before + 5, { timeoutMs: 25_000 });
      const s = await stats();
      afterProcessed = (s?.jobs_done ?? 0) - before;
      survived = (s?.notes ?? 0) >= 1;
      rec.step(`curl -X POST ${base2}/jobs?n=5 ; curl ${base2}/stats ; docker inspect ${PROJECT}-worker-1 --format "{{.RestartCount}}"`, `${JSON.stringify(s)}\nworker restarts: ${workerRestarts}`, `The worker held a connection to the old database, so it exited and the restart policy started it again (${workerRestarts} restart). ${afterProcessed} of the new 5 jobs were processed, and the note written before the kill is ${survived ? 'still there' : 'gone'}.`);
    }
  }

  // Same database, killed with docker kill. That counts as stopping it by hand, so the restart policy leaves it alone.
  let killRestarted = null;
  if (recovered) {
    docker(['kill', `${PROJECT}-db-1`]);
    await new Promise((res) => setTimeout(res, 8000));
    const st = docker(['inspect', `${PROJECT}-db-1`, '--format', '{{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}']);
    killRestarted = st.startsWith('running');
    rec.step(`docker kill ${PROJECT}-db-1 ; sleep 8 ; docker inspect ${PROJECT}-db-1 --format "{{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}"`, st, killRestarted ? 'The restart policy brought it back.' : 'docker kill counts as stopping the container by hand. A restart policy never undoes a manual stop, so the database stays down until someone starts it. Only a crash is restarted.');
    docker(['start', `${PROJECT}-db-1`]);
  }

  setFact('c8.p1.boot_ready', ready);
  setFact('c8.p1.time_to_ready_s', timeToReady);
  setFact('c8.p1.default_services_count', states.length);
  setFact('c8.p1.crashed_services_count', crashed.length);
  setFact('c8.p1.psql_started_by_default', psqlDefault);
  setFact('c8.p1.worker_processed_jobs_count', processed);
  setFact('c8.p1.notes_written_count', notes);
  setFact('c8.p1.psql_profile_tables_count', tables);
  setFact('c8.p1.db_outage_api_alive', aliveDuring);
  setFact('c8.p1.db_outage_detected_s', detectS);
  setFact('c8.p1.db_outage_recovered', recovered);
  setFact('c8.p1.db_outage_recover_s', recoverS);
  setFact('c8.p1.worker_restarts_count', workerRestarts);
  setFact('c8.p1.worker_after_outage_processed_count', afterProcessed);
  setFact('c8.p1.data_survived_outage', survived);
  if (killRestarted !== null) setFact('c8.p1.docker_kill_restarted', killRestarted);

  composeOk(file, ['down', '-v', '--remove-orphans'], env);
  for (const v of volumes) run(['volume', 'rm', v]);
  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Compose ${run(['compose', 'version', '--short']).stdout.trim()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Seconds for the stack to start and to recover',
        unit: 's',
        bars: [
          { label: 'Time to ready', value: timeToReady },
          { label: 'Outage detected', value: detectS },
          { label: recovered ? 'Recovered after kill' : 'Gave up waiting', value: recoverS },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c8.p1');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (env) compose(file, ['down', '-v', '--remove-orphans'], env, { timeoutMs: 120_000 });
  projectVolumes().forEach((v) => volumes.add(v));
  for (const v of volumes) run(['volume', 'rm', v]);
  cleanup(CHALLENGE);
  removeStackImage();
}
