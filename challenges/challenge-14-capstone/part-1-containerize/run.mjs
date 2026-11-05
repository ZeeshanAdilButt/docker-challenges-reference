// Challenge 14, part 1: containerize the Daftar platform.
// Run: node challenges/challenge-14-capstone/part-1-containerize/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in this part's reference/ folder (for maintainers).
//
// It builds your three Dockerfiles and your compose.yaml, measures every target of the rubric
// (size, user, pinning, build check, secrets, stop time, cache, health, the whole system end to end) and prints one number each.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, run, safeArgs } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { SECRET_MARK, SERVICES, buildCheck, buildService, clip, composeConfig, dockerOut, fromLines, imageSizeMb, k, releaseSystem, runJobs, clearFacts, saveFacts, secs, sleep, stackDown, stackHealth, stackUp, systemDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 14, part 1: containerize the Daftar platform');
const facts = {};
const f = (name, v) => (facts[`c14.p1.${name}`] = v);
const pad = (s, n) => String(s).padEnd(n);

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const STOP_ENV = { api: ['-e', 'DATABASE_URL=postgres://x:y@127.0.0.1:1/z'], worker: ['-e', 'API_URL=http://127.0.0.1:1'], web: [] };
const SECRET_DIRS = { api: ['/app'], worker: ['/app'], web: ['/usr/share/nginx/html', '/etc/nginx'] };
const tagOf = (s) => `dkr-c14-${s}:p1`;

/** Start the image, then `docker stop` it (5 s limit). Returns how long it took and the exit code. */
function stopOnce(service) {
  const name = `dkr-c14-stop-${service}`;
  run(['rm', '-f', name]);
  const start = run(['run', '-d', ...safeArgs(14, `stop-${service}`, { memory: '128m', pids: 100 }), ...STOP_ENV[service], tagOf(service)]);
  if (start.code !== 0) return { ms: NaN, exit: -1, error: start.stderr.trim().split('\n').pop() };
  const t0 = Date.now();
  return (async () => {
    await sleep(1800);
    const t1 = Date.now();
    run(['stop', '-t', '5', name], { timeoutMs: 60_000 });
    const ms = Date.now() - t1;
    const exit = Number(dockerOut(['inspect', name, '--format', '{{.State.ExitCode}}']));
    run(['rm', '-f', name]);
    return { ms, exit, up: Date.now() - t0 };
  })();
}

let dir;
let stack;
let scratch;
try {
  clearFacts('c14.p1.'); // a failed run must not leave the numbers of an older run behind
  cleanup(14);
  k.removeImages();
  dir = systemDir();
  const per = {};
  for (const s of SERVICES) per[s] = {};

  // Step 1: what the Dockerfiles say.
  const lines = [];
  for (const s of SERVICES) {
    const text = existsSync(join(dir, s, 'Dockerfile')) ? readFileSync(join(dir, s, 'Dockerfile'), 'utf8') : '';
    const froms = fromLines(text);
    per[s].froms = froms;
    f(`${s}_pinned`, froms.length > 0 && froms.every((x) => x.pinned));
    f(`${s}_dockerignore`, existsSync(join(dir, s, '.dockerignore')));
    f(`${s}_from_count`, froms.length);
    lines.push(`${pad(s, 7)} FROM ${froms.map((x) => x.image.replace(/@sha256:([0-9a-f]{12})[0-9a-f]+/, '@sha256:$1...')).join(' ; ') || '(none)'}   .dockerignore: ${facts[`c14.p1.${s}_dockerignore`] ? 'yes' : 'no'}`);
  }
  const apiText = existsSync(join(dir, 'api', 'Dockerfile')) ? readFileSync(join(dir, 'api', 'Dockerfile'), 'utf8') : '';
  f('api_multistage', fromLines(apiText).length >= 2);
  f('api_test_stage', /^\s*FROM\s+\S+\s+AS\s+test\b/im.test(apiText));
  rec.step('grep -n FROM api/Dockerfile worker/Dockerfile web/Dockerfile   and   ls -a <service>/.dockerignore', lines.join('\n'), 'A digest after the tag (@sha256:...) names exactly one image; the tag alone can move. A .dockerignore keeps secrets and junk out of the build context.');

  // Step 2: docker build --check.
  const checks = [];
  for (const s of SERVICES) {
    const c = buildCheck(join(dir, s));
    f(`${s}_check_warnings_count`, c.count);
    checks.push(`${pad(s, 7)} ${c.count} warning(s)${c.rules.length ? `: ${c.rules.join(', ')}` : ''}`);
  }
  rec.step('docker build --check api   (and worker, web)', checks.join('\n'), SERVICES.every((s) => facts[`c14.p1.${s}_check_warnings_count`] === 0) ? 'Clean. Buildx read each Dockerfile and found nothing to complain about.' : 'Each rule name is a page in the Dockerfile reference. Fix the Dockerfile, not the check.');

  // Step 3: build each image cold three times.
  const buildLines = [];
  for (const s of SERVICES) {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const b = buildService(dir, s, { tag: tagOf(s), noCache: true, args: { APP_VERSION: '1.0.0' } });
      if (!b.ok) throw new Error(`the ${s} image did not build:\n${b.error}`);
      times.push(b.ms);
    }
    f(`${s}_build_cold_s`, round(median(times) / 1000, 1));
    f(`${s}_size_mb`, imageSizeMb(tagOf(s)));
    const uid = dockerOut(['run', '--rm', ...safeArgs(14, `id-${s}`, { memory: '64m' }), '--entrypoint', 'id', tagOf(s), '-u']);
    f(`${s}_user_root`, uid === '0');
    buildLines.push(`${pad(s, 7)} ${String(facts[`c14.p1.${s}_size_mb`]).padStart(5)} MB   cold build ${facts[`c14.p1.${s}_build_cold_s`]} s (median of 3)   runs as uid ${uid || '?'}${uid === '0' ? ' (root)' : ''}`);
  }
  rec.step('docker build --no-cache -t <image> <service>   (3 times each, median)\ndocker image inspect <image> --format "{{.Size}}"\ndocker run --rm --entrypoint id <image> -u', buildLines.join('\n'), 'Size follows the base image and what you copy into it. A process that runs as uid 0 is root inside the container; the rubric asks for an unprivileged user.');

  // Step 4: secrets in the image.
  const secretLines = [];
  for (const s of SERVICES) {
    const hist = dockerOut(['image', 'history', '--no-trunc', tagOf(s)]).includes(SECRET_MARK) ? 1 : 0;
    const env = dockerOut(['image', 'inspect', tagOf(s), '--format', '{{json .Config.Env}}']).includes(SECRET_MARK) ? 1 : 0;
    const files = dockerOut(['run', '--rm', ...safeArgs(14, `grep-${s}`, { memory: '64m' }), '--entrypoint', 'grep', tagOf(s), '-rl', SECRET_MARK, ...SECRET_DIRS[s]]).split(/\r?\n/).filter(Boolean);
    f(`${s}_secret_leaks_count`, hist + env + files.length);
    secretLines.push(`${pad(s, 7)} history: ${hist ? 'LEAK' : 'clean'}   environment: ${env ? 'LEAK' : 'clean'}   files: ${files.length ? `LEAK ${files.join(', ')}` : 'clean'}`);
  }
  rec.step(`docker image history --no-trunc <image> | grep ${SECRET_MARK}\ndocker image inspect <image> (Config.Env)\ndocker run --rm --entrypoint grep <image> -rl ${SECRET_MARK} <app folders>`, secretLines.join('\n'), 'A secret in an ENV line stays in the image history for ever. A .env file copied by COPY . . ends up in a layer. Both are found in seconds by anyone who can pull the image.');

  // Step 5: stop time and exit code (median of 3).
  const stopLines = [];
  for (const s of SERVICES) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await stopOnce(s));
    if (runs.some((r) => Number.isNaN(r.ms))) throw new Error(`the ${s} image did not start: ${runs[0].error}`);
    f(`${s}_stop_s`, round(median(runs.map((r) => r.ms)) / 1000, 1));
    f(`${s}_stop_exit_code`, runs[runs.length - 1].exit);
    stopLines.push(`${pad(s, 7)} docker stop took ${facts[`c14.p1.${s}_stop_s`]} s (median of 3)   exit code ${runs[runs.length - 1].exit}`);
  }
  rec.step('docker run -d <image>; docker stop -t 5 <container>   (3 times each, median)', stopLines.join('\n'), '137 means the process ignored SIGTERM and Docker killed it after the limit. A shell in front of the program, or a program with no signal handler as PID 1, is the usual cause. Exec-form CMD fixes the first.');

  // Step 6: the dependency layer must survive an edit of the source (api).
  scratch = mkdtempSync(join(tmpdir(), 'dkr-c14-edit-'));
  cpSync(join(dir, 'api'), join(scratch, 'api'), { recursive: true, filter: (src) => !/node_modules/.test(src) });
  const editTag = 'dkr-c14-edit:p1';
  const first = buildService(scratch, 'api', { tag: editTag });
  if (!first.ok) throw new Error(`the api image did not build in the scratch folder:\n${first.error}`);
  const timed = [];
  let cachedAll = true;
  for (let i0 = 0; i0 < 3; i0++) {
    const file = join(scratch, 'api', 'server.mjs');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n// edit ${i0 + 1} at ${Date.now()}\n`);
    const t0 = Date.now();
    const r = run(['build', '--progress=plain', '--provenance=false', '--sbom=false', '--label', 'dkr.challenge=14', '-t', editTag, join(scratch, 'api')], { timeoutMs: 600_000 });
    timed.push(Date.now() - t0);
    if (r.code !== 0) throw new Error('rebuild after an edit failed');
    const out = `${r.stdout}${r.stderr}`;
    const steps = [...out.matchAll(/^#(\d+) \[[^\]]*\] RUN [^\n]*npm /gm)].map((m) => m[1]);
    const cached = steps.length > 0 && steps.every((id) => new RegExp(`^#${id} CACHED`, 'm').test(out));
    if (!cached) cachedAll = false;
  }
  f('api_deps_cached_on_edit', cachedAll);
  f('api_edit_rebuild_s', round(median(timed) / 1000, 1));
  rec.step(
    'append a comment to api/server.mjs, then docker build api   (3 edits; the npm step is looked for in the build log)',
    `npm install step reused from the cache after an edit: ${cachedAll ? 'yes' : 'NO'}\nrebuild after an edit: ${facts['c14.p1.api_edit_rebuild_s']} s (median of 3), cold build: ${facts['c14.p1.api_build_cold_s']} s`,
    cachedAll ? 'Packages are copied and installed before the source, so a source edit leaves that layer alone.' : 'The source is copied before the packages are installed, so every edit installs everything again. Copy package.json and the lock file first.',
  );
  rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;

  // Step 7: the compose file, read as Docker reads it.
  const config = composeConfig(dir);
  const raw = readFileSync(join(dir, 'compose.yaml'), 'utf8');
  if (!config) throw new Error('docker compose config failed on compose.yaml. Run it yourself to see the error.');
  const svc = config.services ?? {};
  const has = (name) => Boolean(svc[name]);
  const limit = (s) => Boolean(s?.mem_limit || s?.deploy?.resources?.limits?.memory);
  f('compose_services_count', Object.keys(svc).length);
  f('compose_db_published', Boolean(svc.db?.ports?.length));
  f('compose_healthchecks_count', ['db', 'api', 'worker', 'web'].filter((n) => has(n) && svc[n].healthcheck && !svc[n].healthcheck.disable && svc[n].healthcheck.test?.[0] !== 'NONE').length);
  const waits = (from, on) => svc[from]?.depends_on?.[on]?.condition === 'service_healthy';
  f('compose_wait_for_healthy', waits('api', 'db') && waits('worker', 'api') && waits('web', 'api'));
  f('compose_limits_count', ['db', 'api', 'worker', 'web'].filter((n) => limit(svc[n])).length);
  f('compose_hardened_count', ['api', 'worker', 'web'].filter((n) => svc[n]?.read_only === true && (svc[n]?.cap_drop ?? []).map(String).map((x) => x.toUpperCase()).includes('ALL') && (svc[n]?.security_opt ?? []).some((o) => /no-new-privileges/.test(o))).length);
  f('compose_restart_count', ['db', 'api', 'worker', 'web'].filter((n) => ['unless-stopped', 'always', 'on-failure'].includes(svc[n]?.restart)).length);
  f('compose_has_profile', Object.values(svc).some((s) => (s.profiles ?? []).length > 0));
  f('compose_has_watch', (svc.api?.develop?.watch ?? []).length > 0);
  f('compose_literal_secret', raw.includes(SECRET_MARK));
  f('compose_version_key', /^version:/m.test(raw));
  f('compose_db_pinned', /@sha256:[0-9a-f]{64}/.test(String(svc.db?.image ?? '')));
  rec.step(
    'docker compose config --format json   (read: ports, healthchecks, depends_on, limits, hardening, profiles, watch)',
    [
      `services: ${Object.keys(svc).join(', ')}`,
      `database publishes a port to the host: ${facts['c14.p1.compose_db_published']}`,
      `health checks: ${facts['c14.p1.compose_healthchecks_count']} of 4   dependants wait for healthy: ${facts['c14.p1.compose_wait_for_healthy']}`,
      `memory limits: ${facts['c14.p1.compose_limits_count']} of 4   hardened (read-only, no capabilities, no-new-privileges): ${facts['c14.p1.compose_hardened_count']} of 3   restart policy: ${facts['c14.p1.compose_restart_count']} of 4`,
      `a profile for tools: ${facts['c14.p1.compose_has_profile']}   watch on the api: ${facts['c14.p1.compose_has_watch']}`,
      `secret written in the file: ${facts['c14.p1.compose_literal_secret']}   obsolete "version:" key: ${facts['c14.p1.compose_version_key']}   database image pinned: ${facts['c14.p1.compose_db_pinned']}`,
    ].join('\n'),
    'Each line is a thing a reviewer looks for. A published database port is reachable from your network. A password in the file is in git for good.',
  );

  // Step 8: bring the stack up and use it.
  stack = await stackUp(dir, { waitS: 90 });
  const health = stackHealth(stack);
  const healthy = Object.values(health).filter((h) => h.health === 'healthy').length;
  f('compose_up_s', secs(stack.upMs));
  f('compose_up_ok', stack.ok);
  f('compose_healthy_count', healthy);
  f('compose_containers_count', Object.keys(health).length);
  let e2e = { ok: false, ms: 0 };
  if (stack.ports.web) e2e = await runJobs(stack, 5, { waitMs: 40_000 });
  f('compose_e2e_ok', e2e.ok);
  f('compose_e2e_s', secs(e2e.ms));
  rec.step(
    'docker compose up -d --build --wait\ndocker compose ps   then queue 5 jobs through the web page path (POST /api/jobs) and wait until all are done',
    [
      `up took ${secs(stack.upMs)} s${stack.ok ? '' : ` and failed: ${clip(stack.error, 2)}`}`,
      ...Object.entries(health).map(([n, h]) => `${pad(n, 7)} ${pad(h.state, 8)} health: ${h.health}`),
      `jobs: ${e2e.ok ? `5 queued by the web path and all done after ${secs(e2e.ms)} s` : 'NOT all done in time'}`,
    ].join('\n'),
    e2e.ok && healthy === Object.keys(health).length ? 'Every container reports healthy, and a job goes web, API, database, worker, database, web. That is the whole system working.' : 'Containers without a health check show "none": "up --wait" cannot tell when they are ready. Without readiness, the start order is a guess.',
  );
  stackDown(stack);
  stack = undefined;

  // Step 9: the README.
  const readme = existsSync(join(dir, 'README.md')) ? readFileSync(join(dir, 'README.md'), 'utf8') : '';
  const stale = ['mysql', 'docker-compose', 'node 16', 'pm2', 'scp ', 'start:all'].filter((w) => readme.toLowerCase().includes(w));
  const needed = ['docker compose up', '.env', 'POSTGRES_PASSWORD'].filter((w) => !readme.includes(w));
  f('readme_stale_count', stale.length);
  f('readme_missing_count', needed.length);
  rec.step('grep -ci "mysql|docker-compose|node 16|pm2" README.md   and   grep for "docker compose up", ".env", "POSTGRES_PASSWORD"', `stale words found: ${stale.length ? stale.join(', ') : 'none'}\nmissing words: ${needed.length ? needed.join(', ') : 'none'}`, stale.length === 0 && needed.length === 0 ? 'The README tells the truth about how to run it.' : 'The README describes a system that no longer exists. A newcomer follows it and fails.');

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Image size after containerizing (MB)',
        unit: 'MB',
        bars: SERVICES.map((s) => ({ label: s, value: facts[`c14.p1.${s}_size_mb`] })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nSizes: ${SERVICES.map((s) => `${s} ${facts[`c14.p1.${s}_size_mb`]} MB`).join(', ')}. Stop times: ${SERVICES.map((s) => `${s} ${facts[`c14.p1.${s}_stop_s`]} s`).join(', ')}. Stack healthy: ${healthy} of ${Object.keys(health).length}, jobs end to end: ${e2e.ok}.`);
  console.log('See your numbers with: node toolkit/show-facts.mjs c14.p1');
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 14)}`);
  try {
    saveFacts(facts);
  } catch { /* nothing more to save */ }
  process.exitCode = 1;
} finally {
  if (stack) stackDown(stack);
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  if (dir) releaseSystem(dir);
  k.teardown();
  k.removeImages();
}
