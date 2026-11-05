// Challenge 14, part 3: break it, then write the runbook.
// Run: node challenges/challenge-14-capstone/part-3-break-it/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in this part's reference/ folder (for maintainers).
//
// Three failure experiments on the development stack (your compose.yaml), each on a fresh stack:
//   kill          the api crashes while jobs are in flight
//   starve        something eats memory until its limit stops it
//   misconfigure  the api is started with a wrong database password
// Then it reads RUNBOOK.md and checks that the three entries are complete and quote the numbers measured here.
// Nothing here touches anything but containers of the stack, which carry the label dkr.challenge=14.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { PROJECT, clip, containerOf, http, k, releaseSystem, clearFacts, saveFacts, secs, sleep, stackDown, stackEnv, stackExec, stackHealth, stackUp, sysText, systemDir } from '../lib.mjs';
import { parseRunbook } from './runbook.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 14, part 3: break it');
const facts = {};
const f = (name, v) => (facts[`c14.p3.${name}`] = v);
const CAP_MS = 40_000;

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** Poll every 100 ms until fn() is true. Returns the milliseconds it took, or null after capMs. */
async function until(fn, capMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    if (await Promise.resolve(fn()).catch(() => false)) return Date.now() - t0;
    await sleep(100);
  }
  return null;
}

const base = (stack) => `http://127.0.0.1:${stack.ports.web}`;
const apiReady = (stack) => http(`${base(stack)}/api/ready`).then((r) => r.status === 200);

async function postJobs(stack, n, prefix) {
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const r = await http(`${base(stack)}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `${prefix} ${i}` }) });
    if (r.status === 201) ids.push(r.body.id);
  }
  return ids;
}
async function doneCount(stack, ids) {
  const r = await http(`${base(stack)}/api/jobs`);
  const jobs = r.body?.jobs ?? [];
  return ids.filter((id) => jobs.find((j) => j.id === id)?.status === 'done').length;
}

let dir;
let stack;
try {
  clearFacts('c14.p3.'); // a failed run must not leave the numbers of an older run behind
  cleanup(14);
  k.removeImages();
  dir = systemDir();

  // Experiment 1: kill.
  stack = await stackUp(dir, { waitS: 90 });
  if (!stack.ports.web || !stack.ports.api) throw new Error(`the stack did not come up: ${stack.error}`);
  await until(() => apiReady(stack), 30_000);
  const jobs1 = await postJobs(stack, 6, 'kill experiment job');
  const t1 = Date.now();
  await http(`http://127.0.0.1:${stack.ports.api}/crash`);
  await sleep(400);
  const recoveredMs = await until(() => apiReady(stack), CAP_MS);
  const doneMs = await until(async () => (await doneCount(stack, jobs1)) === jobs1.length, CAP_MS);
  const h1 = stackHealth(stack);
  f('kill_jobs_total_count', jobs1.length);
  f('kill_recovered', recoveredMs !== null);
  f('kill_recovery_s', recoveredMs === null ? secs(CAP_MS) : secs(recoveredMs + 400));
  f('kill_restart_count', h1.api?.restarts ?? 0);
  f('kill_jobs_lost_count', jobs1.length - (await doneCount(stack, jobs1)));
  f('kill_all_done_s', doneMs === null ? secs(CAP_MS) : secs(Date.now() - t1));
  rec.step(
    `curl http://127.0.0.1:<api port>/crash   (the api answers, then exits with code 137, while ${jobs1.length} jobs are queued and in flight)\npoll GET /api/ready through the web page every 100 ms; poll /api/jobs until every job is done`,
    [
      `restart policy of the api in your compose.yaml: ${stack.config.services.api?.restart ?? 'none'}`,
      recoveredMs === null ? `api NOT back after ${CAP_MS / 1000} s` : `api answering again after ${facts['c14.p3.kill_recovery_s']} s   (restart count ${facts['c14.p3.kill_restart_count']})`,
      `jobs: ${jobs1.length - facts['c14.p3.kill_jobs_lost_count']} of ${jobs1.length} done${doneMs === null ? '' : ` after ${facts['c14.p3.kill_all_done_s']} s`}   lost: ${facts['c14.p3.kill_jobs_lost_count']}`,
    ].join('\n'),
    recoveredMs === null
      ? 'Nothing restarted the api. With no restart policy a crashed container stays down until a person notices, and the jobs wait.'
      : facts['c14.p3.kill_jobs_lost_count'] === 0
        ? 'Docker restarted the api, and no job was lost: a job claimed by a worker that cannot report back goes back in the queue after a few seconds, and is done again. Delivery is at least once.'
        : 'The api is back, but some jobs never finished.',
  );
  stackDown(stack);
  stack = undefined;

  // Experiment 2: starve.
  stack = await stackUp(dir, { waitS: 90 });
  if (!stack.ports.web || !stack.ports.api) throw new Error(`the stack did not come up for the starve experiment: ${stack.error}`);
  await until(() => apiReady(stack), 30_000);
  const limitBytes = Number(stack.config.services.api?.mem_limit ?? 0);
  f('starve_limit_mb', Math.round(limitBytes / 1048576));
  const before = stackHealth(stack);
  const since = Math.floor(Date.now() / 1000) - 1;
  const results = [];
  for (let i = 0; i < 3; i++) {
    const r = await http(`http://127.0.0.1:${stack.ports.api}/alloc?mb=200`);
    results.push(r.status);
    if (r.status === 0) break;
  }
  await sleep(500);
  const t2 = Date.now();
  const recovered2 = await until(() => apiReady(stack), CAP_MS);
  const ids2 = await postJobs(stack, 3, 'starve experiment job');
  await until(async () => (await doneCount(stack, ids2)) === ids2.length, 20_000);
  const h2 = stackHealth(stack);
  const events = run(['events', '--since', String(since), '--until', String(Math.floor(Date.now() / 1000) + 1), '--filter', 'event=oom', '--filter', `container=${before.api.id}`, '--format', '{{.Action}}']).stdout.trim().split(/\r?\n/).filter((l) => l.includes('oom'));
  f('starve_oom_killed', events.length > 0);
  f('starve_recovered', recovered2 !== null);
  f('starve_recovery_s', recovered2 === null ? secs(CAP_MS) : secs(recovered2 + 500));
  f('starve_worker_unaffected', (h2.worker?.restarts ?? 1) === 0 && h2.worker?.state === 'running' && (h2.db?.restarts ?? 1) === 0 && (await doneCount(stack, ids2)) === ids2.length);
  rec.step(
    'GET /alloc?mb=200 on the api, up to three times (each call holds 200 MB)\ndocker events --filter event=oom --filter container=<api>\npoll GET /api/ready until the api is back, then queue 3 jobs',
    [
      `memory limit of the api in your compose.yaml: ${facts['c14.p3.starve_limit_mb'] ? `${facts['c14.p3.starve_limit_mb']} MB` : 'none'}`,
      `answers to the three /alloc calls: ${results.join(', ')}   (0 means the connection died)`,
      `out-of-memory kill events: ${events.length}   api restarts: ${h2.api?.restarts ?? '?'}   worker restarts: ${h2.worker?.restarts ?? '?'}   db restarts: ${h2.db?.restarts ?? '?'}`,
      recovered2 === null ? `api NOT back after ${CAP_MS / 1000} s` : `api answering again ${facts['c14.p3.starve_recovery_s']} s after the last call`,
      `jobs queued afterwards: ${ids2.length}, done: ${await doneCount(stack, ids2)}`,
    ].join('\n'),
    events.length > 0 && recovered2 !== null
      ? 'The kernel stopped the hog at its limit (exit 137, an OOM kill event), Docker started it again, and nothing else on the host noticed. A limit turns "the whole machine is slow" into "one container restarted".'
      : 'Nothing stopped the memory hog. With no limit, a leak in one service eats the memory of the whole host, and the kernel picks a victim that may be your database.',
  );
  stackDown(stack);
  stack = undefined;

  // Experiment 3: misconfigure.
  stack = await stackUp(dir, { waitS: 90 });
  if (!stack.ports.web) throw new Error(`the stack did not come up for the misconfigure experiment: ${stack.error}`);
  await until(() => apiReady(stack), 30_000); // a stack without health checks may still be starting
  const wrong = join(dirname(stack.override), 'misconfig.yaml');
  writeFileSync(wrong, 'services:\n  api:\n    environment:\n      DATABASE_URL: postgres://daftar:the-wrong-password@db:5432/daftar\n');
  const t3 = Date.now();
  const up3 = stackExec({ ...stack, base: [...stack.base, '-f', wrong] }, ['up', '-d', '--wait', '--wait-timeout', '40', 'api'], { timeoutMs: 120_000 });
  const detectMs = Date.now() - t3;
  await sleep(500);
  const ready3 = await http(`${base(stack)}/api/ready`);
  const h3 = stackHealth(stack);
  f('misconfig_detected', up3.code !== 0);
  f('misconfig_detect_s', up3.code !== 0 ? secs(detectMs) : secs(40_000));
  f('misconfig_really_broken', ready3.status !== 200);
  f('misconfig_silent', up3.code === 0 && ready3.status !== 200);
  rec.step(
    'start the api with DATABASE_URL pointing at the right host and the wrong password:  docker compose up -d --wait --wait-timeout 40 api\ncurl http://127.0.0.1:<web port>/api/ready',
    [
      `compose up --wait: ${up3.code !== 0 ? `FAILED after ${secs(detectMs)} s (${clip(`${up3.stderr}`.trim().split('\n').pop() ?? '', 1)})` : `returned success after ${secs(detectMs)} s`}`,
      `api health status: ${h3.api?.health ?? '?'}   GET /api/ready through the web page: ${ready3.status}`,
    ].join('\n'),
    up3.code !== 0
      ? 'The health gate refused the release: /ready checks the database, the health check calls /ready, and "up --wait" says no. You find out in seconds, from the command that made the change.'
      : 'The deploy said "success" and the service cannot reach its database. Without a health check that touches the database, a typo in a secret is found by a customer.',
  );
  stackDown(stack);
  stack = undefined;

  // The runbook.
  const text = sysText('RUNBOOK.md');
  const rb = parseRunbook(text, {
    kill: facts['c14.p3.kill_recovery_s'],
    starve: facts['c14.p3.starve_recovery_s'],
    misconfig: facts['c14.p3.misconfig_detect_s'],
  });
  f('runbook_entries_count', rb.entries.length);
  f('runbook_complete_count', rb.complete);
  f('runbook_numbers_match', rb.numbersMatch);
  rec.step(
    'read RUNBOOK.md: one entry each for kill, starve and misconfigure; check the fields and the Measured: numbers',
    rb.report.join('\n') || '(no entries found under "## Entries")',
    rb.complete === 3 && rb.numbersMatch ? 'Three complete entries, and each quotes the number your own experiment measured. That is what a person at 3 am needs: what to look at, what to type, and what normal looks like.' : 'The runbook is not finished: each entry needs a symptom, commands to check, a cause, a fix, a prevention and a measured number.',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Seconds until the system noticed or recovered',
        unit: 's',
        bars: [
          { label: 'Kill: api back', value: facts['c14.p3.kill_recovery_s'] },
          { label: 'Starve: api back after OOM', value: facts['c14.p3.starve_recovery_s'] },
          { label: 'Misconfigure: caught by the gate', value: facts['c14.p3.misconfig_detect_s'] },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nkill: back ${facts['c14.p3.kill_recovered']} in ${facts['c14.p3.kill_recovery_s']} s, jobs lost ${facts['c14.p3.kill_jobs_lost_count']}. starve: oom ${facts['c14.p3.starve_oom_killed']}, recovered ${facts['c14.p3.starve_recovered']}. misconfigure: caught ${facts['c14.p3.misconfig_detected']} in ${facts['c14.p3.misconfig_detect_s']} s. runbook: ${facts['c14.p3.runbook_complete_count']} of 3 complete.`);
  console.log('See your numbers with: node toolkit/show-facts.mjs c14.p3');
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 14)}`);
  try {
    saveFacts(facts);
  } catch { /* nothing more to save */ }
  process.exitCode = 1;
} finally {
  if (stack) stackDown(stack);
  if (dir) releaseSystem(dir);
  k.teardown();
  k.removeImages();
}
