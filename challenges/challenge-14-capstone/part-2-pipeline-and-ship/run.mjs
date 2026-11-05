// Challenge 14, part 2: pipeline and ship it.
// Run: node challenges/challenge-14-capstone/part-2-pipeline-and-ship/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in this part's reference/ folder (for maintainers).
//
// THE ONE PRIVILEGED CONTAINER. The production host is a Docker engine inside a container (docker:29-dind, named
// dkr-c14-prod). A Docker engine needs --privileged to start inside a container. This is the single named exception
// to the "no --privileged" rule, as in challenge 13: one container, labelled, capped (memory, processes, a size-capped
// tmpfs disk), reached over TLS on 127.0.0.1 through a Docker context, removed at the end. The Docker socket of your
// machine is never mounted.
//
// The GitHub half of the pipeline (.github/workflows/ship.yml) is checked as text; the GitHub run is your own.
// The local pipeline runs the same stages against a registry on your machine.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { SERVICES, TEST_PASSWORD, SECRET_MARK, checkWorkflow, clip, k, platformDir, releaseSystem, clearFacts, saveFacts, secs, short, sleep, startLoad, sysPath, systemDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 14, part 2: pipeline and ship it');
const facts = {};
const f = (name, v) => (facts[`c14.p2.${name}`] = v);
const pad = (s, n) => String(s).padEnd(n);
const SHAS = { 1: '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2: '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
const LOAD_PATHS = ['/', '/api/', '/api/jobs'];

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let dir;
try {
  clearFacts('c14.p2.'); // a failed run must not leave the numbers of an older run behind
  k.teardown();
  k.removeImages();
  dir = systemDir();
  const config = JSON.parse(readFileSync(sysPath('pipeline.json'), 'utf8'));
  const composeProd = join(dir, 'compose.prod.yaml');
  const dataFile = join(platformDir, 'data.compose.yaml');

  // Step 1: the workflow, read as text.
  const wfFile = sysPath('.github/workflows/ship.yml');
  const wf = checkWorkflow(wfFile);
  const wfText = readFileSync(wfFile, 'utf8').replace(/^\s*#.*$/gm, '');
  Object.entries({
    actions_count: wf.actions,
    unpinned_count: wf.unpinned,
    write_all: wf.writeAll,
    pull_request_target: wf.pullRequestTarget,
    least_privilege_jobs: wf.permissionBlocks >= 2 && !wf.writeAll,
    push_guarded: wf.pushGuarded,
    push_always: wf.pushAlways,
    hardcoded_secret: wf.hardcodedSecret,
    uses_github_token: wf.usesGithubToken,
    prints_digest: wf.printsDigest,
    deploy_needs_build: wf.deployNeedsBuild,
    cache_gha: wf.cacheGha,
    has_test_step: wf.hasTestStep,
    builds_all: SERVICES.every((s) => new RegExp(`\\b${s}\\b`).test(wfText)) && (wfText.match(/uses:\s*docker\/build-push-action@/g) ?? []).length >= 3,
  }).forEach(([key, v]) => f(`workflow_${key}`, v));
  const wfOk = wf.unpinned === 0 && !wf.writeAll && !wf.pullRequestTarget && wf.pushGuarded && wf.cacheGha && facts['c14.p2.workflow_builds_all'];
  rec.step(
    'grep -nE "uses:|permissions|pull_request|push:|password:|cache-|target:" .github/workflows/ship.yml   (first lines)',
    clip(
      readFileSync(wfFile, 'utf8')
        .split(/\r?\n/)
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => /^\s*-?\s*(uses:|permissions|push:|password:|cache-|target:)|pull_request/.test(l) && !/^\s*#/.test(l))
        .map(([i, l]) => `${String(i).padStart(3)}: ${l.trim().replace(/^- /, '')}`)
        .join('\n'),
      25,
    ),
    wfOk
      ? 'Pinned actions, narrow permissions, no push from a pull request, a layer cache and all three images. The GitHub run is your own.'
      : `The workflow is not ready: ${wf.unpinned} action(s) not pinned, write-all ${wf.writeAll}, pull_request_target ${wf.pullRequestTarget}, push guarded ${wf.pushGuarded}, cache ${wf.cacheGha}.`,
  );

  // Step 2: registry, production host, proxy.
  const reg = await k.startRegistry();
  const t0 = Date.now();
  const host = await k.startProd({ ports: [8080], memory: '6g', tmpfsMb: 4500 });
  const edge = await k.startEdge({ hostPort: 8080 });
  f('host_start_s', secs(Date.now() - t0));
  rec.step(
    'docker run -d --name dkr-c14-prod --privileged --memory 6g --pids-limit 1024 --tmpfs /var/lib/docker:size=4500m docker:29-dind ...\ndocker --context dkr-c14-prod info --format "engine {{.ServerVersion}}"',
    `engine ${host.engine}   privileged: ${k.docker(['inspect', k.PROD, '--format', '{{.HostConfig.Privileged}}'])}   socket mounted: ${k.docker(['inspect', k.PROD, '--format', '{{json .HostConfig.Binds}}']).includes('docker.sock')}\nregistry at ${reg.inner} (inside), ${reg.host} (from here)`,
    'The same single privileged Docker-in-Docker host as challenge 13, named for this challenge. Everything you deploy lands here.',
  );

  // Step 3: the pipeline, for every service.
  const out = {};
  const stageTables = [];
  let anyBadStage = false;
  const statuses = { scan: [], sbom: [], sign: [] };
  for (const s of SERVICES) {
    const stages = s === 'api' ? config.stages : config.stages.filter((x) => x !== 'test');
    const r = await k.runPipeline({ config: { ...config, stages }, dir: join(dir, s), repo: `dkr-c14/${s}`, sha: SHAS[1], version: '1.0.0', target: null });
    out[s] = { 1: r };
    f(`pipeline_${s}_ok`, r.ok);
    if (!r.ok) anyBadStage = true;
    for (const st of r.stages) if (statuses[st.name]) statuses[st.name].push(st.status);
    stageTables.push(`${s}\n${r.stages.map((st) => `  ${pad(st.name, 6)} ${pad(st.status, 8)} ${String(secs(st.ms)).padStart(5)} s  ${st.detail.split('\n')[0].slice(0, 90)}`).join('\n')}`);
  }
  const roll = (name) => (statuses[name].length === 0 ? 'missing' : statuses[name].every((x) => x === 'ok') ? 'ok' : statuses[name].some((x) => x === 'failed') ? 'failed' : statuses[name].every((x) => x === 'skipped') ? 'skipped' : 'partial');
  f('scan_status', roll('scan'));
  f('sbom_status', roll('sbom'));
  f('sign_status', roll('sign'));
  const idx = (s) => config.stages.indexOf(s);
  f('pipeline_order_ok', idx('test') >= 0 && idx('push') >= 0 && idx('test') < idx('push') && idx('scan') >= 0 && idx('scan') < idx('push') && idx('sign') > idx('push'));
  f('tags_include_sha', (out.api[1].tags ?? []).some((t) => /^sha-[0-9a-f]{7}$/.test(t)));
  rec.step(
    `local pipeline for api, worker, web   stages ${config.stages.join(' > ')}   tags ${JSON.stringify(config.tags)}`,
    stageTables.join('\n'),
    anyBadStage ? 'A service failed a stage: nothing after it ran, and nothing was pushed from it. Read the detail column.' : 'Every service passed every stage. scan, sbom and sign say "skipped" until challenge 12 gives you the tools. The digests are in the registry.',
  );

  // Version 2: a second release (build and push only), to have something to roll out and to roll back from.
  for (const s of SERVICES) {
    const r = await k.runPipeline({ config: { stages: ['build', 'push'], tags: config.tags }, dir: join(dir, s), repo: `dkr-c14/${s}`, sha: SHAS[2], version: '2.0.0', target: null });
    out[s][2] = r;
    if (!r.ok) anyBadStage = true;
  }
  const digest = (s, v) => out[s][v].digest;
  const missing = SERVICES.some((s) => !digest(s, 1) || !digest(s, 2));
  if (missing) throw new Error('a service has no digest in the registry (its pipeline stopped before the push). Fix the pipeline first.');

  // The database image goes to the registry too, so the host pulls everything from one place.
  run(['tag', 'postgres:18-alpine', `${reg.host}/dkr-c14/postgres:18`]);
  const pushed = run(['push', `${reg.host}/dkr-c14/postgres:18`], { timeoutMs: 300_000 });
  if (pushed.code !== 0) throw new Error(`could not push postgres to the local registry: ${pushed.stderr.trim().split('\n').slice(-2).join(' ')}`);
  const digestDb = await k.digestOf('dkr-c14/postgres', '18');

  // Step 4: the data stack on the host, then the first deploy.
  k.prodDocker(['network', 'create', 'data']);
  const baseEnv = { REGISTRY: reg.inner, DIGEST_DB: digestDb, POSTGRES_PASSWORD: TEST_PASSWORD, DATABASE_URL: `postgres://daftar:${TEST_PASSWORD}@db:5432/daftar` };
  const envFor = (v) => ({ ...baseEnv, DIGEST_API: digest('api', v), DIGEST_WORKER: digest('worker', v), DIGEST_WEB: digest('web', v) });
  const td = Date.now();
  const data = k.prod(['compose', '-p', 'daftar-data', '-f', dataFile, 'up', '-d', '--wait', '--wait-timeout', '120'], { env: baseEnv, timeoutMs: 300_000 });
  if (data.code !== 0) throw new Error(`the database did not start on the host: ${data.stderr.trim().split('\n').slice(-3).join(' ')}`);
  f('db_start_s', secs(Date.now() - td));

  const deploy = (v, extra = {}) => edge.deploy({ file: composeProd, env: envFor(v), service: 'web', probe: '/', waitS: 90, ...extra });
  const digestsOf = (color) =>
    Object.fromEntries(
      SERVICES.map((s) => {
        const id = k.prod(['compose', '-p', `daftar-${color}`, '-f', composeProd, 'ps', '-q', s], { env: envFor(1) }).stdout.trim().split(/\s+/)[0];
        if (!id) return [s, []];
        const image = k.prodDocker(['inspect', id, '--format', '{{.Image}}']);
        return [s, JSON.parse(k.prodDocker(['image', 'inspect', image, '--format', '{{json .RepoDigests}}']) || '[]').map((d) => d.split('@')[1])];
      }),
    );

  const tf = Date.now();
  const first = await deploy(1);
  f('first_deploy_s', secs(Date.now() - tf));
  f('deploy_ok', first.ok);
  let match = false;
  let e2e = false;
  let ran = {};
  if (first.ok) {
    ran = digestsOf(first.color);
    match = SERVICES.every((s) => ran[s].includes(digest(s, 1)));
    const base = edge.url;
    const post = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'first job on the production host' }) }).then((r) => r.json()).catch(() => ({}));
    if (post.id) {
      for (let i = 0; i < 100 && !e2e; i++) {
        const jobs = await fetch(`${base}/api/jobs`).then((r) => r.json()).catch(() => ({ jobs: [] }));
        e2e = jobs.jobs.find((j) => j.id === post.id)?.status === 'done';
        if (!e2e) await sleep(300);
      }
    }
  }
  f('deploy_digests_match', match);
  f('prod_e2e_ok', e2e);
  rec.step(
    'docker --context dkr-c14-prod compose -p daftar-data -f data.compose.yaml up -d --wait   (the database)\nDIGEST_API=... DIGEST_WORKER=... DIGEST_WEB=... docker --context dkr-c14-prod compose -p daftar-blue -f compose.prod.yaml up -d --wait',
    first.ok
      ? `database ready in ${facts['c14.p2.db_start_s']} s; first deploy of version 1 in ${facts['c14.p2.first_deploy_s']} s\n${SERVICES.map((s) => `${pad(s, 7)} running ${short((ran[s] ?? [])[0])}   pushed ${short(digest(s, 1))}   ${ran[s]?.includes(digest(s, 1)) ? 'same' : 'DIFFERENT'}`).join('\n')}\nfirst job through the web page on the host: ${e2e ? 'done' : 'NOT done'}`
      : `the first deploy failed after ${facts['c14.p2.first_deploy_s']} s: ${clip(first.error ?? '', 3)}`,
    match && e2e ? 'The host runs exactly the three digests the pipeline pushed, and the system works there.' : 'The host does not run what the pipeline pushed (a tag was used, or a service did not start), or the system does not work there.',
  );

  // Step 5: three cycles of rollout under load, then rollback under load.
  const cycles = [];
  if (first.ok) {
    for (let i = 0; i < 3; i++) {
      edge.reset({ file: composeProd, env: envFor(1) });
      const d1 = await deploy(1);
      if (!d1.ok) {
        cycles.push({ failed: true, error: d1.error });
        break;
      }
      await sleep(500);
      let load = startLoad({ url: edge.url, paths: LOAD_PATHS });
      await sleep(1500);
      const up = await deploy(2);
      await sleep(1500);
      const rolloutLoad = await load.stop();
      load = startLoad({ url: edge.url, paths: LOAD_PATHS });
      await sleep(1000);
      const tb = Date.now();
      const back = await deploy(1);
      const backMs = Date.now() - tb;
      await sleep(1500);
      const backLoad = await load.stop();
      const landed = back.ok ? digestsOf(back.color) : {};
      cycles.push({
        rolloutOk: up.ok,
        rolloutMs: up.deploy_ms,
        rolloutFailed: rolloutLoad.failed,
        rolloutTotal: rolloutLoad.total,
        both: (rolloutLoad.versions['1.0.0'] ?? 0) > 0 && (rolloutLoad.versions['2.0.0'] ?? 0) > 0,
        backOk: back.ok,
        backMs,
        backFailed: backLoad.failed,
        landed: back.ok && SERVICES.every((s) => landed[s]?.includes(digest(s, 1))),
      });
    }
  }
  const good = cycles.filter((c) => !c.failed);
  const sum = (key) => good.reduce((a, c) => a + c[key], 0);
  f('rollout_s', good.length ? round(median(good.map((c) => c.rolloutMs)) / 1000, 1) : 0);
  f('rollout_failed_count', good.length === 3 ? sum('rolloutFailed') : 9999);
  f('rollout_total_count', sum('rolloutTotal'));
  f('rollout_both_versions', good.length === 3 && good.every((c) => c.both && c.rolloutOk));
  f('rollback_s', good.length ? round(median(good.map((c) => c.backMs)) / 1000, 1) : 9999);
  f('rollback_failed_count', good.length === 3 ? sum('backFailed') : 9999);
  f('rollback_digests_match', good.length === 3 && good.every((c) => c.landed));
  rec.step(
    'repeat 3 times:  deploy version 1;  roll out version 2 under load;  roll back to version 1 by digest under load',
    good.length === 3
      ? `rollout:  ${facts['c14.p2.rollout_s']} s (median)   requests ${facts['c14.p2.rollout_total_count']}   failed ${facts['c14.p2.rollout_failed_count']}   both versions answered: ${facts['c14.p2.rollout_both_versions']}\nrollback: ${facts['c14.p2.rollback_s']} s (median; target under 120 s)   failed during rollback ${facts['c14.p2.rollback_failed_count']}   back on the version 1 digests: ${facts['c14.p2.rollback_digests_match']}`
      : `a cycle could not complete: ${clip(cycles.find((c) => c.failed)?.error ?? 'the first deploy failed, so no rollout was tried', 3)}`,
    facts['c14.p2.rollout_failed_count'] === 0 && facts['c14.p2.rollback_digests_match']
      ? 'The new colour had to report healthy (all three services) before the proxy moved, so no request failed, in either direction. A rollback is a deploy of older digests that the host already has.'
      : `Requests failed, or the rollback landed on other images. Without health checks "up --wait" returns before the colour can take traffic.`,
  );

  // Step 6: the production compose file, read as Docker reads it.
  const raw = readFileSync(composeProd, 'utf8');
  const cfgRun = run(['compose', '-f', composeProd, 'config', '--format', 'json'], { env: envFor(1) });
  let svc = {};
  try {
    svc = JSON.parse(cfgRun.stdout).services ?? {};
  } catch { /* the file did not parse */ }
  const limit = (s) => Boolean(s?.mem_limit || s?.deploy?.resources?.limits?.memory);
  f('prod_secret_literal', raw.replace(/^\s*#.*$/gm, '').includes(SECRET_MARK));
  f('prod_health_count', SERVICES.filter((n) => svc[n]?.healthcheck && !svc[n].healthcheck.disable).length);
  f('prod_limits_count', SERVICES.filter((n) => limit(svc[n])).length);
  f('prod_restart_count', SERVICES.filter((n) => ['unless-stopped', 'always', 'on-failure'].includes(svc[n]?.restart)).length);
  f('prod_images_by_digest', SERVICES.every((n) => /@sha256:/.test(String(svc[n]?.image ?? ''))));
  rec.step(
    'docker compose -f compose.prod.yaml config --format json   (read: image, healthcheck, limits, restart, secrets)',
    `images named by digest: ${facts['c14.p2.prod_images_by_digest']}   secret written in the file: ${facts['c14.p2.prod_secret_literal']}\nhealth checks ${facts['c14.p2.prod_health_count']} of 3   memory limits ${facts['c14.p2.prod_limits_count']} of 3   restart policy ${facts['c14.p2.prod_restart_count']} of 3`,
    'The same things a reviewer checks by eye, counted.',
  );

  const stats = k.docker(['stats', '--no-stream', '--format', '{{.MemUsage}}', k.PROD]);
  const used = /([\d.]+)(MiB|GiB)/.exec(stats);
  f('host_mem_used_mb', used ? Math.round(Number(used[1]) * (used[2] === 'GiB' ? 1024 : 1)) : 0);
  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, production host engine ${host.engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Rollout and rollback under load: seconds (median of 3) and failed requests',
        unit: '',
        bars: [
          { label: 'Rollout (s)', value: facts['c14.p2.rollout_s'] },
          { label: 'Rollback (s)', value: facts['c14.p2.rollback_s'] === 9999 ? 0 : facts['c14.p2.rollback_s'] },
          { label: 'Requests failed in 3 rollouts', value: facts['c14.p2.rollout_failed_count'] === 9999 ? 0 : facts['c14.p2.rollout_failed_count'] },
          { label: 'Requests failed in 3 rollbacks', value: facts['c14.p2.rollback_failed_count'] === 9999 ? 0 : facts['c14.p2.rollback_failed_count'] },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nPipeline ok for all three: ${SERVICES.every((s) => facts[`c14.p2.pipeline_${s}_ok`])}. Running digests match: ${match}. Rollout failures: ${facts['c14.p2.rollout_failed_count']}. Rollback ${facts['c14.p2.rollback_s']} s.`);
  console.log('See your numbers with: node toolkit/show-facts.mjs c14.p2');
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 14)}`);
  try {
    saveFacts(facts);
  } catch { /* nothing more to save */ }
  process.exitCode = 1;
} finally {
  if (dir) releaseSystem(dir);
  k.teardown();
  k.removeImages();
}
