// Challenge 5, part 1: step order, ignore rules and cache mounts.
// Run: node challenges/challenge-5-fast-builds/part-1-order-ignore-mounts/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).

import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, run, safeArgs } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median } from '../../../toolkit/stats.js';
import { openImage, layerBytes } from '../../challenge-2-take-an-image-apart/lib/image.mjs';
import { CHALLENGE, build, clip, contextMb, imageBytes, mb, pick, removeImages, saveFacts, secs } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const app = join(here, '..', 'app');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 5, part 1: order, ignore rules and cache mounts');
const facts = {};
const TAG = 'dkr-c5-p1-app:test';
const salt = randomBytes(4).toString('hex'); // makes every run of this script start from changed files

/** Write package.json with a note that is different on each run, so no layer is reused from an earlier run. */
function setManifest(ctx, variant, note) {
  const dir = variant ? join(app, 'variants', variant) : app;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  pkg.description = `${pkg.description} (${note})`;
  writeFileSync(join(ctx, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  copyFileSync(join(dir, 'package-lock.json'), join(ctx, 'package-lock.json'));
}

/** The folder of a real project after some weeks: history, dependencies from the laptop, logs, coverage. */
function addProjectClutter(ctx) {
  const files = [
    ['.git/objects/pack/pack-1.bin', 20],
    ['node_modules/.cache/dev.bin', 20],
    ['logs/app.log', 5],
    ['coverage/lcov.info', 1],
  ];
  for (const [rel, size] of files) {
    mkdirSync(dirname(join(ctx, rel)), { recursive: true });
    writeFileSync(join(ctx, rel), Buffer.alloc(size * 1024 * 1024, 7));
  }
}

const stepTable = (steps) => [...steps].sort((a, b) => a.index - b.index).map((s) => `[${s.index}/${s.of}] ${s.cached ? 'CACHED  ' : `${String(s.sec ?? '?').padStart(5)} s `} ${s.name.slice(0, 60)}`).join('\n');
const noMount = (text) => text.replace(/--mount=\S+\s+/g, '');
const hasInstall = (s) => /npm (ci|install)/.test(s.name);

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let ctx;
try {
  cleanup(CHALLENGE);
  const dockerfileText = readFileSync(pick(here, 'Dockerfile'), 'utf8');
  facts['c5.p1.mount_used'] = /RUN\s+--mount=type=cache/.test(dockerfileText);
  facts['c5.p1.copy_all_before_install'] = (() => {
    const lines = dockerfileText.split(/\r?\n/).filter((l) => /^\s*(COPY|ADD|RUN)\s/i.test(l));
    const install = lines.findIndex((l) => /npm (ci|install)/.test(l));
    const copyAll = lines.findIndex((l) => /^\s*COPY\s+(--\S+\s+)*\.\s+\S+/i.test(l));
    return copyAll !== -1 && install !== -1 && copyAll < install;
  })();

  ctx = mkdtempSync(join(tmpdir(), 'dkr-c5-p1-'));
  copyFileSync(join(root, 'daftar-api', 'server.mjs'), join(ctx, 'server.mjs'));
  writeFileSync(join(ctx, 'Dockerfile'), dockerfileText);
  copyFileSync(pick(here, '.dockerignore'), join(ctx, '.dockerignore'));
  addProjectClutter(ctx);
  setManifest(ctx, null, `run ${salt}`);

  // Step 1: the first build. It also shows what the build folder costs.
  const first = build({ dockerfile: join(ctx, 'Dockerfile'), context: ctx, tag: TAG });
  if (!first.ok) throw new Error(`the first build failed:\n${clip(first.out.split(/\r?\n/).slice(-14).join('\n'), 14)}`);
  facts['c5.p1.context_mb'] = Math.round(contextMb(first.out) * 10) / 10;
  // docker image inspect Size is not the size of the files on the containerd image store: add up the layers.
  facts['c5.p1.image_docker_size_mb'] = mb(imageBytes(TAG));
  const saveDir = mkdtempSync(join(tmpdir(), 'dkr-c5-save-'));
  try {
    const saved = run(['save', '-o', join(saveDir, 'image.tar'), TAG], { timeoutMs: 300_000 });
    if (saved.code !== 0) throw new Error(`docker save failed: ${saved.stderr.trim()}`);
    facts['c5.p1.image_unpacked_mb'] = mb(openImage(join(saveDir, 'image.tar')).layers.reduce((sum, l) => sum + layerBytes(l), 0));
  } finally {
    rmSync(saveDir, { recursive: true, force: true });
  }
  const cacheKb = run(['run', '--rm', ...safeArgs(CHALLENGE, 'probe'), '--entrypoint', 'sh', TAG, '-c', 'du -sk /root/.npm 2>/dev/null | cut -f1']).stdout.trim();
  facts['c5.p1.npm_cache_in_image_mb'] = Math.round((Number(cacheKb || 0) / 1024) * 10) / 10;
  const clutter = run(['run', '--rm', ...safeArgs(CHALLENGE, 'probe'), '--entrypoint', 'sh', TAG, '-c', 'ls -d /app/.git /app/logs /app/coverage 2>/dev/null | wc -l']).stdout.trim();
  facts['c5.p1.clutter_in_image'] = Number(clutter || 0);
  rec.step(
    'docker build -t dkr-c5-p1-app:test .',
    `build folder sent to the builder: ${facts['c5.p1.context_mb']} MB\nimage size (files in the layers): ${facts['c5.p1.image_unpacked_mb']} MB\nnpm cache stored inside the image: ${facts['c5.p1.npm_cache_in_image_mb']} MB\nfolders .git, logs, coverage inside the image: ${facts['c5.p1.clutter_in_image']} of 3\nfirst build took ${secs(first.ms)} s`,
    'The build folder holds clutter. Ignore rules decide how much of it is sent, and how much ends up in the image.',
  );

  // Step 2: a code change, three times. This is what happens on every push.
  const codeMs = [];
  let lastCode;
  for (let i = 1; i <= 3; i++) {
    appendFileSync(join(ctx, 'server.mjs'), `\n// edit ${i} ${salt}\n`);
    lastCode = build({ dockerfile: join(ctx, 'Dockerfile'), context: ctx, tag: TAG });
    if (!lastCode.ok) throw new Error(`a rebuild after a code change failed:\n${clip(lastCode.out, 14)}`);
    codeMs.push(lastCode.ms);
  }
  const install = lastCode.steps.find(hasInstall);
  const cachedCount = lastCode.steps.filter((s) => s.cached).length;
  facts['c5.p1.code_change_s'] = secs(median(codeMs));
  facts['c5.p1.code_change_steps_cached'] = cachedCount;
  facts['c5.p1.code_change_steps_total'] = lastCode.steps.length;
  facts['c5.p1.install_reran_on_code_change'] = install ? !install.cached : true;
  rec.step(
    'echo "// a small edit" >> server.mjs && docker build -t dkr-c5-p1-app:test .',
    `${stepTable(lastCode.steps)}\nrebuild times: ${codeMs.map((m) => secs(m)).join(', ')} s (median ${facts['c5.p1.code_change_s']} s)`,
    install?.cached ? 'The install step is CACHED. Only the code layer was rebuilt.' : 'The install step ran again after a one line edit. That is the slow rebuild.',
  );

  // Step 3: a dependency change, three times, with your Dockerfile (the cache mount if you have one).
  // Step 4: the same three changes with the cache mount taken out. The two kinds of build take turns,
  // so a slow moment on the machine hits both of them.
  const plain = join(ctx, 'Dockerfile.nomount');
  writeFileSync(plain, noMount(dockerfileText));
  const withMount = [];
  const withoutMount = [];
  let lastDeps;
  for (let i = 1; i <= 3; i++) {
    setManifest(ctx, `bump-${i}`, `deps ${salt} a${i}`);
    lastDeps = build({ dockerfile: join(ctx, 'Dockerfile'), context: ctx, tag: TAG });
    if (!lastDeps.ok) throw new Error(`a rebuild after a dependency change failed:
${clip(lastDeps.out, 14)}`);
    withMount.push(lastDeps.ms);
    setManifest(ctx, `bump-${i}`, `plain ${salt} b${i}`);
    const r = build({ dockerfile: plain, context: ctx, tag: `${TAG.replace(':test', '')}-plain:test` });
    if (!r.ok) throw new Error(`the build without a cache mount failed:
${clip(r.out, 14)}`);
    withoutMount.push(r.ms);
  }
  const depsInstall = lastDeps.steps.find(hasInstall);
  facts['c5.p1.deps_change_s'] = secs(median(withMount));
  rec.step(
    'npm install eslint@9.20.0 && docker build -t dkr-c5-p1-app:test .   (three different version bumps)',
    `${stepTable(lastDeps.steps)}
rebuild times: ${withMount.map((m) => secs(m)).join(', ')} s (median ${facts['c5.p1.deps_change_s']} s)`,
    depsInstall?.cached ? 'The install step was reused. Did the dependency change reach the build?' : 'A new dependency list must install again. A cache mount only saves the download.',
  );
  facts['c5.p1.deps_change_nomount_s'] = secs(median(withoutMount));
  facts['c5.p1.mount_saving_s'] = Math.round((facts['c5.p1.deps_change_nomount_s'] - facts['c5.p1.deps_change_s']) * 10) / 10;
  rec.step(
    'the same three dependency changes, with the --mount option taken out of the RUN line',
    `with your Dockerfile:      ${withMount.map((m) => secs(m)).join(', ')} s (median ${facts['c5.p1.deps_change_s']} s)
without a cache mount:     ${withoutMount.map((m) => secs(m)).join(', ')} s (median ${facts['c5.p1.deps_change_nomount_s']} s)`,
    facts['c5.p1.mount_used'] ? `The cache mount saved about ${facts['c5.p1.mount_saving_s']} s per dependency change here. It saves the download, not the unpack, so the saving depends on your network.` : 'You have no cache mount yet, so both lines are the same Dockerfile.',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Rebuild time after a change (median of 3)',
        unit: 's',
        bars: [
          { label: 'Code change', value: facts['c5.p1.code_change_s'] },
          { label: 'Dependency change', value: facts['c5.p1.deps_change_s'] },
          { label: 'Dependency change, no mount', value: facts['c5.p1.deps_change_nomount_s'] },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nContext ${facts['c5.p1.context_mb']} MB. Code change ${facts['c5.p1.code_change_s']} s (install ran again: ${facts['c5.p1.install_reran_on_code_change']}). Dependency change ${facts['c5.p1.deps_change_s']} s.`);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 16)}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages();
  if (ctx) rmSync(ctx, { recursive: true, force: true });
}
