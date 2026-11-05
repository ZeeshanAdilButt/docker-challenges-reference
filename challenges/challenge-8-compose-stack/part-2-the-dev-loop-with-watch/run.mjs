// Challenge 8, part 2: the dev loop with Compose watch.
// Run: node challenges/challenge-8-compose-stack/part-2-the-dev-loop-with-watch/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to use the fixed compose.yaml in reference/ instead of yours.
//
// For each watch action (rebuild, sync+restart, sync with node --watch-path, sync only) and then for your own compose.yaml:
// start the service with `docker compose watch`, edit app/src/message.mjs, and time how long until
// GET /message shows the new text. Each action is timed three times and the median is kept.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, run } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, PROJECT, compose, composeOk, filesDir, freePort, get, pollUntil, sleep } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 8, part 2: the dev loop with Compose watch');
const messageFile = join(here, 'app', 'src', 'message.mjs');
const packageFile = join(here, 'app', 'package.json');
const originalMessage = readFileSync(messageFile, 'utf8');
const originalPackage = readFileSync(packageFile, 'utf8');
const IMAGE = 'dkr-c8-dev:1';

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let env;
const progress = (m) => console.error(`  [${new Date().toISOString().slice(11, 19)}] ${m}`);

/** Stop the watch process we started, with the processes it started. On Windows child.kill() leaves docker-compose.exe running. */
function stopWatch(child) {
  if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill();
}
const imageId = () => run(['image', 'inspect', IMAGE, '--format', '{{.Id}}']).stdout.trim();

/**
 * Start `file` with watch, edit the message `edits` times, and time each edit until /message shows it.
 * Returns { reloaded, msList, ms (median), log }. capMs is how long to wait for one edit.
 */
async function measure(file, { edits = 3, capMs = 30_000, packageTest = false } = {}) {
  const base = `http://127.0.0.1:${env.API_PORT}`;
  progress(`up -d --build ${file.split(/[\/]/).slice(-2).join('/')}`);
  composeOk(file, ['up', '-d', '--build'], env, { timeoutMs: 240_000 });
  await pollUntil(async () => (await get(`${base}/message`)).json?.message === 'v0', { timeoutMs: 20_000 });
  const child = spawn('docker', ['compose', '-p', PROJECT, '-f', file, 'watch', '--no-up'], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const result = { reloaded: true, msList: [], pkg: null };
  // Wait until the watch output has been silent for 3 s, so one edit is never made while the last one is still being handled.
  const quiet = async () => {
    let last = -1;
    let since = Date.now();
    for (let i = 0; i < 80; i++) {
      if (log.length !== last) { last = log.length; since = Date.now(); }
      if (Date.now() - since >= 3000) return;
      await sleep(250);
    }
  };
  try {
    await pollUntil(async () => /watch enabled/i.test(log), { timeoutMs: 15_000, intervalMs: 100 });
    await sleep(500);
    for (let k = 1; k <= edits; k++) {
      const want = `v${k}`;
      writeFileSync(messageFile, `export const MESSAGE = '${want}';\n`);
      const t0 = process.hrtime.bigint();
      progress(`edit ${k}`);
      const r = await pollUntil(async () => (await get(`${base}/message`, { timeoutMs: 1500 })).json?.message === want, { timeoutMs: capMs, intervalMs: 20 });
      if (!r.value) {
        result.reloaded = false;
        break;
      }
      result.msList.push(Number(process.hrtime.bigint() - t0) / 1e6);
      await quiet(); // let the watcher finish before the next edit
    }
    if (packageTest) {
      const before = imageId();
      writeFileSync(packageFile, originalPackage.replace('"private": true', '"private": true, "edited": true'));
      const r = await pollUntil(async () => imageId() !== before, { timeoutMs: 15_000, intervalMs: 500 });
      result.pkg = Boolean(r.value);
      await sleep(1500);
    }
  } finally {
    stopWatch(child);
    writeFileSync(messageFile, originalMessage);
    writeFileSync(packageFile, originalPackage);
    composeOk(file, ['down', '-v', '--remove-orphans'], env, { timeoutMs: 120_000 });
  }
  result.ms = result.msList.length ? median(result.msList) : null;
  result.log = log;
  return result;
}

const variant = (name) => join(here, 'variants', name);
const ms = (v) => (v === null ? 'never' : `${round(v, 0)} ms`);

try {
  cleanup(CHALLENGE);
  env = { API_PORT: String(await freePort()) };

  const results = {};
  const plan = [
    ['rebuild', 'rebuild.yaml', { capMs: 40_000 }, 'action: rebuild. Docker builds a new image and creates a new container for every change.'],
    ['sync_restart', 'sync-restart.yaml', { capMs: 40_000 }, 'action: sync+restart. The changed file is copied in and the container restarts. No build.'],
    ['sync_watch', 'sync-watch.yaml', { capMs: 20_000 }, 'action: sync, and the server runs with node --watch-path. The file is copied in and the same container restarts only the process.'],
    ['sync_only', 'sync-only.yaml', { edits: 1, capMs: 6_000 }, 'action: sync and nothing that restarts the server. The file arrives but the running process never reads it.'],
  ];
  for (const [key, fileName, opts, what] of plan) {
    if (process.env.DKR_ONLY && !fileName.includes(process.env.DKR_ONLY)) continue;
    const r = await measure(variant(fileName), opts);
    results[key] = r;
    const outText = r.reloaded ? r.msList.map((x) => `${round(x, 0)} ms`).join(', ') : 'the change never showed up (waited 6 s)';
    rec.step(`docker compose -p ${PROJECT} -f variants/${fileName} watch   (then edit app/src/message.mjs, ${opts.edits ?? 3} time${(opts.edits ?? 3) > 1 ? 's' : ''})`, outText, r.reloaded ? `${what} Median ${ms(r.ms)}.` : what);
  }

  const mine = await measure(join(filesDir(here), 'compose.yaml'), { capMs: 40_000, packageTest: true });
  rec.step(
    'docker compose -p dkr-c8 -f compose.yaml watch   (then edit app/src/message.mjs 3 times, and app/package.json once)',
    `${mine.reloaded ? mine.msList.map((x) => `${round(x, 0)} ms`).join(', ') : 'src change never showed up'}\npackage.json change rebuilt the image: ${mine.pkg}`,
    mine.reloaded ? `Your compose.yaml: a source edit shows up in ${ms(mine.ms)} (median of 3). A package.json edit ${mine.pkg ? 'rebuilds the image, as it should' : 'does not rebuild the image: new dependencies would not arrive'}.` : 'Your compose.yaml: the edit did not show up in time.',
  );

  setFact('c8.p2.rebuild_edit_to_reload_ms', round(results.rebuild.ms ?? 0, 0));
  setFact('c8.p2.sync_restart_edit_to_reload_ms', round(results.sync_restart.ms ?? 0, 0));
  setFact('c8.p2.sync_watch_edit_to_reload_ms', round(results.sync_watch.ms ?? 0, 0));
  setFact('c8.p2.sync_only_reloaded', results.sync_only.reloaded);
  setFact('c8.p2.your_edit_reloaded', mine.reloaded);
  setFact('c8.p2.your_edit_to_reload_ms', round(mine.ms ?? 0, 0));
  setFact('c8.p2.package_json_triggers_rebuild', Boolean(mine.pkg));

  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Compose ${run(['compose', 'version', '--short']).stdout.trim()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Milliseconds from saving a file to seeing the change',
        unit: 'ms',
        bars: [
          { label: 'sync + node --watch-path', value: round(results.sync_watch.ms ?? 0, 0) },
          { label: 'sync+restart', value: round(results.sync_restart.ms ?? 0, 0) },
          { label: 'rebuild', value: round(results.rebuild.ms ?? 0, 0) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c8.p2');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  writeFileSync(messageFile, originalMessage);
  writeFileSync(packageFile, originalPackage);
  if (env) compose(join(filesDir(here), 'compose.yaml'), ['down', '-v', '--remove-orphans'], env, { timeoutMs: 120_000 });
  cleanup(CHALLENGE);
  run(['image', 'rm', IMAGE]);
}
