// Challenge 5, part 3 (stretch): describe a multi-platform build in a bake file.
// Run: node challenges/challenge-5-fast-builds/part-3-multi-platform/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).
//
// This part does NOT build for arm64. An arm64 build on an amd64 machine runs under emulation,
// which is slow and needs extra setup, so it is learner-only and not recorded here.
// What this script checks is cheap and safe: the bake file, the workflow, and what the registry says
// about the platforms of an official image.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { clip, pick, saveFacts } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 5, part 3: multi-platform (check only)');
const facts = {};

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

try {
  const bakeFile = pick(here, 'docker-bake.hcl');
  const shownBake = `challenges/challenge-5-fast-builds/part-3-multi-platform/docker-bake.hcl`;

  // Step 1: does the bake file parse, and what platforms does target "app" have?
  const printed = run(['buildx', 'bake', '--print', '-f', bakeFile, 'app'], { timeoutMs: 60_000 });
  let app;
  try {
    app = JSON.parse(printed.stdout).target.app;
  } catch {
    throw new Error(`docker buildx bake could not read your bake file:\n${clip(printed.stderr || printed.stdout, 10)}`);
  }
  const platforms = app.platforms ?? [];
  facts['c5.p3.bake_platforms'] = platforms.length;
  facts['c5.p3.bake_has_amd64'] = platforms.includes('linux/amd64');
  facts['c5.p3.bake_has_arm64'] = platforms.includes('linux/arm64');
  rec.step(
    `docker buildx bake --print -f ${shownBake} app`,
    clip(JSON.stringify({ context: app.context, dockerfile: app.dockerfile, platforms, tags: app.tags }, null, 2), 20),
    platforms.length >= 2 ? 'One target, two platforms. bake --print shows what would be built and builds nothing.' : 'Only one platform. An arm64 machine cannot run this image.',
  );

  const local = run(['buildx', 'bake', '--print', '-f', bakeFile, 'app-local'], { timeoutMs: 60_000 });
  facts['c5.p3.bake_local_target'] = local.code === 0;
  rec.step(`docker buildx bake --print -f ${shownBake} app-local`, local.code === 0 ? 'target app-local: one platform, output type=docker' : clip((local.stderr || local.stdout).trim().split(/\r?\n/).slice(-3).join('\n'), 5), local.code === 0 ? 'A second target loads one platform into the local Docker for a quick check.' : 'There is no app-local target yet.');

  // Step 2: the workflow
  const wfFile = pick(here, 'workflow/multiplatform.yml');
  const wf = readFileSync(wfFile, 'utf8');
  const uses = [...wf.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  facts['c5.p3.workflow_actions'] = uses.length;
  facts['c5.p3.workflow_unpinned'] = uses.filter((u) => !/@[0-9a-f]{40}$/.test(u)).length;
  facts['c5.p3.workflow_has_qemu'] = uses.some((u) => u.startsWith('docker/setup-qemu-action@'));
  facts['c5.p3.workflow_platforms_arm64'] = /platforms:\s*.*linux\/arm64/.test(wf);
  rec.step(
    'grep -E "uses:|platforms:" workflow/multiplatform.yml',
    wf.split(/\r?\n/).filter((l) => /uses:|platforms:/.test(l)).map((l) => l.trim().replace(/^- /, '')).join('\n'),
    facts['c5.p3.workflow_has_qemu'] && facts['c5.p3.workflow_platforms_arm64'] ? 'QEMU is set up, and the build asks for arm64. The GitHub run is your own and is not recorded here.' : 'The workflow cannot build arm64 yet: it needs the QEMU step and the platform.',
  );

  // Step 3: what does this machine's builder support, and what does an official image ship?
  const inspect = run(['buildx', 'inspect'], { timeoutMs: 60_000 });
  const platformLine = (inspect.stdout.match(/^Platforms:\s*(.+)$/m) || [])[1] || '';
  facts['c5.p3.builder_platforms'] = platformLine ? platformLine.split(',').length : 0;
  const index = run(['buildx', 'imagetools', 'inspect', '--raw', 'node:24-alpine'], { timeoutMs: 60_000 });
  let shipped = [];
  try {
    shipped = JSON.parse(index.stdout).manifests.map((m) => m.platform).filter((p) => p && p.os === 'linux' && p.architecture !== 'unknown').map((p) => `${p.os}/${p.architecture}${p.variant ? `/${p.variant}` : ''}`);
  } catch {
    /* no network: the fact is simply not saved */
  }
  if (shipped.length) facts['c5.p3.node_alpine_platforms'] = shipped.length;
  rec.step(
    'docker buildx inspect | grep Platforms    and    docker buildx imagetools inspect --raw node:24-alpine',
    `this builder can build for ${facts['c5.p3.builder_platforms']} platforms\nnode:24-alpine ships for ${shipped.length}: ${shipped.join(', ')}`,
    'One tag, many platforms: the tag points at an index, and each platform has its own manifest.',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Platforms: your bake file, this builder, the official Node image',
        unit: 'platforms',
        bars: [
          { label: 'Your bake file', value: facts['c5.p3.bake_platforms'] },
          { label: 'Official node:24-alpine', value: shipped.length },
          { label: 'This builder can build', value: facts['c5.p3.builder_platforms'] },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nBake file: ${platforms.join(', ')}. Workflow: ${facts['c5.p3.workflow_unpinned']} unpinned action(s).`);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  process.exitCode = 1;
}
