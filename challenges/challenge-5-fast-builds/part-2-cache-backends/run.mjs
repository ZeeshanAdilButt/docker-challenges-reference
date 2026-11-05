// Challenge 5, part 2: cache backends on a cold runner.
// Run: node challenges/challenge-5-fast-builds/part-2-cache-backends/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).
//
// A cold CI runner has no layers and no cache. We model it with a fresh BuildKit builder
// (a container) for every build. The cache lives outside the builder: in a folder (local)
// or in a registry that this script starts. The GitHub Actions cache (type=gha) only exists
// on GitHub, so for that backend this part checks the workflow file you ship.

import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, label, run, safeArgs, waitFor } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median } from '../../../toolkit/stats.js';
import { CHALLENGE, clip, parseSteps, pick, saveFacts, secs } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const app = join(here, '..', 'app');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 5, part 2: cache backends on a cold runner');
const facts = {};

const BUILDER = 'dkr-c5-builder';
const NETWORK = 'dkr-c5-net';
const REGISTRY_NAME = 'dkr-c5-registry';
const REGISTRY = `${REGISTRY_NAME}:5000`;
const salt = randomBytes(4).toString('hex');
const fwd = (p) => p.replace(/\\/g, '/'); // buildx wants / in cache paths, also on Windows

/** cache-flags.txt: { local: [tokens], registry: [tokens] } */
function readCacheFlags(file, dir) {
  const sections = {};
  let current;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^\[(\w+)\]$/.exec(line);
    if (m) {
      current = sections[m[1]] = [];
      continue;
    }
    if (!current) throw new Error(`cache-flags.txt: the line "${line}" is before the first [section]`);
    current.push(...line.replaceAll('{DIR}', fwd(dir)).replaceAll('{REGISTRY}', REGISTRY).split(/\s+/));
  }
  for (const name of ['local', 'registry']) if (!sections[name]?.length) throw new Error(`cache-flags.txt needs a [${name}] section`);
  return sections;
}

/** Split tokens into the --cache-to part (seed) and everything (consumer). */
const onlyCacheTo = (tokens) => {
  const out = [];
  for (let i = 0; i < tokens.length; i++) if (tokens[i] === '--cache-to') out.push(tokens[i], tokens[++i]);
  return out;
};

function freshBuilder(configFile) {
  run(['buildx', 'rm', '--force', BUILDER]);
  const r = run(['buildx', 'create', '--name', BUILDER, '--driver', 'docker-container', '--driver-opt', `network=${NETWORK}`, '--driver-opt', 'image=moby/buildkit:buildx-stable-1', '--buildkitd-config', configFile, '--bootstrap'], { timeoutMs: 180_000 });
  if (r.code !== 0) throw new Error(`could not create a builder: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' ')}`);
}

function timedBuild(ctx, tokens, { output = ['--output', 'type=cacheonly'] } = {}) {
  const t0 = process.hrtime.bigint();
  const r = run(['buildx', 'build', '--builder', BUILDER, '--progress=plain', '-f', join(ctx, 'Dockerfile'), ...tokens, ...output, ctx], { timeoutMs: 900_000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const out = r.stdout + r.stderr;
  const steps = parseSteps(out);
  const install = steps.find((s) => /npm ci/.test(s.name));
  const from = steps.find((x) => /^FROM /.test(x.name));
  return { ok: r.code === 0, ms, out, steps, installCached: install ? install.cached : false, installSec: install && !install.cached ? install.sec ?? 0 : 0, fromSec: from && !from.cached ? from.sec ?? 0 : 0, cached: steps.filter((x) => x.cached).length };
}

const dirMb = (dir) => {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += statSync(p).size;
    }
  };
  try {
    walk(dir);
  } catch {
    return 0;
  }
  return Math.round((total / 1e6) * 10) / 10;
};

/** Workflow checks: no unpinned actions, cache written only on a trusted event, mode=max. */
function checkWorkflow(file) {
  const text = readFileSync(file, 'utf8');
  const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  const unpinned = uses.filter((u) => !/@[0-9a-f]{40}$/.test(u));
  const cacheTo = text.split(/\r?\n/).find((l) => /^\s*cache-to:/.test(l)) || '';
  return {
    actions: uses.length,
    unpinned: unpinned.length,
    unpinnedList: unpinned,
    cacheFromGha: /cache-from:\s*type=gha/.test(text),
    cacheToGuarded: /github\.event_name/.test(cacheTo),
    cacheToMax: /mode=max/.test(cacheTo),
    pullRequestTarget: /pull_request_target/.test(text),
  };
}

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let ctx, work;
const scenarios = {}; // name -> { times: [], installCached, cached, total }
try {
  cleanup(CHALLENGE);
  run(['buildx', 'rm', '--force', BUILDER]);

  // The workflow comes first: it needs no Docker.
  const wf = checkWorkflow(pick(here, 'workflow/build.yml'));
  facts['c5.p2.workflow_actions'] = wf.actions;
  facts['c5.p2.workflow_unpinned'] = wf.unpinned;
  facts['c5.p2.workflow_cache_from_gha'] = wf.cacheFromGha;
  facts['c5.p2.workflow_cache_to_guarded'] = wf.cacheToGuarded;
  facts['c5.p2.workflow_cache_to_max'] = wf.cacheToMax;
  facts['c5.p2.workflow_uses_pull_request_target'] = wf.pullRequestTarget;
  rec.step(
    'grep -E "uses:|cache-from|cache-to" workflow/build.yml',
    readFileSync(pick(here, 'workflow/build.yml'), 'utf8').split(/\r?\n/).filter((l) => /uses:|cache-from:|cache-to:/.test(l)).map((l) => l.trim().replace(/^- /, '')).join('\n'),
    wf.unpinned === 0 ? `All ${wf.actions} actions are pinned to a full commit SHA. The GitHub run is your own: this machine cannot run Actions.` : `${wf.unpinned} action(s) are not pinned to a commit SHA.`,
  );

  work = mkdtempSync(join(tmpdir(), 'dkr-c5-p2-'));
  ctx = join(work, 'ctx');
  mkdirSync(ctx);
  copyFileSync(join(app, 'package.json'), join(ctx, 'package.json'));
  copyFileSync(join(app, 'package-lock.json'), join(ctx, 'package-lock.json'));
  copyFileSync(join(root, 'daftar-api', 'server.mjs'), join(ctx, 'server.mjs'));
  copyFileSync(join(here, 'Dockerfile'), join(ctx, 'Dockerfile'));
  const cacheDir = join(work, 'cache-local');
  const configFile = join(work, 'buildkitd.toml');
  writeFileSync(configFile, `[registry."${REGISTRY}"]\n  http = true\n  insecure = true\n`);
  const flags = readCacheFlags(pick(here, 'cache-flags.txt'), cacheDir);

  // The registry for the registry and inline backends. It lives on a network with the builder, so no host port is needed.
  run(['network', 'create', ...label(CHALLENGE), NETWORK]);
  run(['volume', 'create', ...label(CHALLENGE), 'dkr-c5-registry-data']);
  const reg = run(['run', '-d', ...safeArgs(CHALLENGE, 'registry', { memory: '256m', pids: 100 }), '--network', NETWORK, '--network-alias', REGISTRY_NAME, '-v', 'dkr-c5-registry-data:/var/lib/registry', 'registry:3']);
  if (reg.code !== 0) throw new Error(`could not start the registry: ${reg.stderr.trim()}`);
  await waitFor(() => run(['exec', 'dkr-c5-registry', 'wget', '-qO-', 'http://localhost:5000/v2/']).code === 0, { timeoutMs: 20_000, what: 'the registry' });

  const edit = (tag) => appendFileSync(join(ctx, 'server.mjs'), `\n// edit ${tag} ${salt}\n`);
  const note = (name, r) => ({ s: secs(r.ms), install: r.installCached ? 'CACHED' : 'ran', cached: r.cached, total: r.steps.length });

  async function runScenario(name, { seedTokens, consumerTokens, output }) {
    const times = [];
    const installs = [];
    const froms = [];
    let last;
    if (seedTokens) {
      freshBuilder(configFile);
      edit(`${name}-seed`);
      const seed = timedBuild(ctx, seedTokens, { output });
      if (!seed.ok) throw new Error(`${name}: the first build (it writes the cache) failed:\n${clip(seed.out.split(/\r?\n/).slice(-12).join('\n'), 12)}`);
    }
    for (let i = 1; i <= 3; i++) {
      freshBuilder(configFile); // a new runner every time: no layers, no cache
      edit(`${name}-${i}`);
      last = timedBuild(ctx, consumerTokens, { output });
      if (!last.ok) throw new Error(`${name}: a build on a cold runner failed:\n${clip(last.out.split(/\r?\n/).slice(-12).join('\n'), 12)}`);
      times.push(last.ms);
      installs.push(last.installSec);
      froms.push(last.fromSec);
    }
    scenarios[name] = { times, last, median: secs(median(times)) };
    facts[`c5.p2.${name}_install_s`] = Math.round(median(installs) * 10) / 10;
    facts[`c5.p2.${name}_base_pull_s`] = Math.round(median(froms) * 10) / 10;
    facts[`c5.p2.${name}_s`] = scenarios[name].median;
    facts[`c5.p2.${name}_install_cached`] = last.installCached;
    facts[`c5.p2.${name}_steps_cached`] = last.cached;
    facts[`c5.p2.steps_total`] = last.steps.length;
    return scenarios[name];
  }

  // 1. No cache at all: the 14-minute pipeline in small.
  await runScenario('none', { consumerTokens: [] });
  const n = scenarios.none;
  rec.step('docker buildx build --builder <fresh> .   (no cache flags, new runner each time)', `${n.last.steps.map((s) => `[${s.stage ? `${s.stage} ` : ''}${s.index}/${s.of}] ${s.cached ? 'CACHED' : `${s.sec ?? '?'} s`}  ${s.name.slice(0, 50)}`).join('\n')}\nthree runs: ${n.times.map((t) => secs(t)).join(', ')} s (median ${n.median} s)`, 'A cold runner reinstalls everything on every push.');

  // 2. Local cache folder
  await runScenario('local', { seedTokens: onlyCacheTo(flags.local), consumerTokens: flags.local });
  facts['c5.p2.local_cache_mb'] = dirMb(cacheDir);
  const l = scenarios.local;
  rec.step(`docker buildx build --builder <fresh> ${flags.local.join(' ').replaceAll(fwd(cacheDir), '<dir>')} .`, `${l.last.steps.map((s) => `[${s.stage ? `${s.stage} ` : ''}${s.index}/${s.of}] ${s.cached ? 'CACHED' : `${s.sec ?? '?'} s`}  ${s.name.slice(0, 50)}`).join('\n')}\nthree runs: ${l.times.map((t) => secs(t)).join(', ')} s (median ${l.median} s). Cache folder: ${facts['c5.p2.local_cache_mb']} MB`, l.last.installCached ? 'The install step comes from the imported cache.' : 'The install step still ran. This cache did not help.');

  // 3. Registry cache
  await runScenario('registry', { seedTokens: onlyCacheTo(flags.registry), consumerTokens: flags.registry });
  const kb = Number(run(['exec', 'dkr-c5-registry', 'sh', '-c', 'du -sk /var/lib/registry | cut -f1']).stdout.trim() || 0);
  facts['c5.p2.registry_cache_mb'] = Math.round((kb / 1024) * 10) / 10;
  const g = scenarios.registry;
  rec.step(`docker buildx build --builder <fresh> ${flags.registry.join(' ').replaceAll(REGISTRY, '<registry>')} .`, `${g.last.steps.map((s) => `[${s.stage ? `${s.stage} ` : ''}${s.index}/${s.of}] ${s.cached ? 'CACHED' : `${s.sec ?? '?'} s`}  ${s.name.slice(0, 50)}`).join('\n')}\nthree runs: ${g.times.map((t) => secs(t)).join(', ')} s (median ${g.median} s). Registry holds ${facts['c5.p2.registry_cache_mb']} MB`, g.last.installCached ? 'The install step comes from the registry cache.' : 'The install step still ran. Is the cache being read from the same reference it was written to?');

  // 4. Inline cache: the cache rides inside the pushed image. Always min mode.
  const inlineRef = `${REGISTRY}/dkr-c5-inline:main`;
  await runScenario('inline', {
    seedTokens: ['--push', '-t', inlineRef, '--cache-to', 'type=inline'],
    consumerTokens: ['--push', '-t', inlineRef, '--cache-from', `type=registry,ref=${inlineRef}`, '--cache-to', 'type=inline'],
    output: [],
  });
  const i = scenarios.inline;
  rec.step('docker buildx build --push -t <registry>/dkr-c5-inline:main --cache-from type=registry,ref=<same image> --cache-to type=inline .', `${i.last.steps.map((s) => `[${s.stage ? `${s.stage} ` : ''}${s.index}/${s.of}] ${s.cached ? 'CACHED' : `${s.sec ?? '?'} s`}  ${s.name.slice(0, 50)}`).join('\n')}\nthree runs: ${i.times.map((t) => secs(t)).join(', ')} s (median ${i.median} s)`, i.last.installCached ? 'The inline cache kept the install step.' : 'Inline cache only keeps the layers of the final image, so the install stage ran again. Use a registry cache with mode=max to keep it.');

  // 5. A runner that keeps its disk: the same builder, three pushes in a row.
  freshBuilder(configFile);
  edit('warm-seed');
  const warmSeed = timedBuild(ctx, []);
  if (!warmSeed.ok) throw new Error('warm builder: the first build failed');
  const warmTimes = [];
  const warmInstalls = [];
  let warmLast;
  for (let k = 1; k <= 3; k++) {
    edit(`warm-${k}`);
    warmLast = timedBuild(ctx, []);
    if (!warmLast.ok) throw new Error('warm builder: a rebuild failed');
    warmTimes.push(warmLast.ms);
    warmInstalls.push(warmLast.installSec);
  }
  facts['c5.p2.warm_install_s'] = Math.round(median(warmInstalls) * 10) / 10;
  facts['c5.p2.warm_s'] = secs(median(warmTimes));
  facts['c5.p2.warm_install_cached'] = warmLast.installCached;
  rec.step('docker buildx build --builder <same builder> .   (a runner that keeps its disk)', `three rebuilds: ${warmTimes.map((t) => secs(t)).join(', ')} s (median ${facts['c5.p2.warm_s']} s)`, 'Upper bound: layers on a disk that stays. Cache backends try to give a fresh runner this.');

  const sum = ['none', 'local', 'registry', 'inline'].map((k) => `${k.padEnd(10)} whole build ${String(facts[`c5.p2.${k}_s`]).padStart(5)} s   base image ${String(facts[`c5.p2.${k}_base_pull_s`]).padStart(4)} s   npm install ${facts[`c5.p2.${k}_install_cached`] ? '  CACHED' : `${String(facts[`c5.p2.${k}_install_s`]).padStart(4)} s  `}`);
  sum.push(`${'warm disk'.padEnd(10)} whole build ${String(facts['c5.p2.warm_s']).padStart(5)} s   base image    0 s   npm install ${facts['c5.p2.warm_install_cached'] ? '  CACHED' : `${String(facts['c5.p2.warm_install_s']).padStart(4)} s  `}`);
  rec.step('summary of the medians', sum.join('\n'), 'The whole build also pulls the base image into a fresh builder, and that time moves a lot from run to run. The npm install column is the part a cache can save.');

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Time of the npm install step on a cold runner (median of 3)',
        unit: 's',
        bars: [
          { label: 'No cache', value: facts['c5.p2.none_install_s'] },
          { label: 'Inline', value: facts['c5.p2.inline_install_s'] },
          { label: 'Local folder', value: facts['c5.p2.local_install_s'] },
          { label: 'Registry', value: facts['c5.p2.registry_install_s'] },
          { label: 'Warm disk', value: facts['c5.p2.warm_install_s'] },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nNo cache ${facts['c5.p2.none_s']} s, local ${facts['c5.p2.local_s']} s, registry ${facts['c5.p2.registry_s']} s, inline ${facts['c5.p2.inline_s']} s.`);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 16)}`);
  process.exitCode = 1;
} finally {
  run(['buildx', 'rm', '--force', BUILDER]);
  cleanup(CHALLENGE);
  if (work) rmSync(work, { recursive: true, force: true });
}
