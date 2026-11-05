// Challenge 4, part 1: build one app on five bases and compare them.
// Run: node challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, run, safeArgs, waitFor } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, build, clip, imageBytes, mb, ociExport, pick, removeImages, saveFacts, useReference } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const context = join(root, 'daftar-api');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 4, part 1: five bases for one app');

// key: used in fact names. node: where the node binary lives in that image.
const BASES = [
  { key: 'full', file: 'Dockerfile.full', label: 'node:24 (Debian, full)', node: '/usr/local/bin/node' },
  { key: 'slim', file: 'Dockerfile.slim', label: 'node:24-slim (Debian, slim)', node: '/usr/local/bin/node' },
  { key: 'alpine', file: 'Dockerfile.alpine', label: 'node:24-alpine (musl)', node: '/usr/local/bin/node' },
  { key: 'alpine_os', file: 'Dockerfile.alpine-os', label: 'alpine:3.23 + apk nodejs', node: '/usr/bin/node' },
  { key: 'distroless', file: 'Dockerfile.distroless', label: 'distroless nodejs24', node: '/nodejs/bin/node' },
];

// Runs inside every image, using the image's own node. One line of JSON comes back.
const PROBE = [
  "const fs=require('fs');",
  "const o={node:process.version,musl:fs.readdirSync('/lib').some(f=>f.startsWith('ld-musl')),shell:fs.existsSync('/bin/sh')};",
  'let n=0;',
  "try{n=fs.readFileSync('/var/lib/dpkg/status','utf8').split('\\n').filter(l=>l.startsWith('Package:')).length}catch{}",
  "if(!n)try{n=fs.readdirSync('/var/lib/dpkg/status.d').filter(f=>!f.endsWith('.md5sums')).length}catch{}",
  "if(!n)try{n=fs.readFileSync('/lib/apk/db/installed','utf8').split('\\n').filter(l=>l.startsWith('P:')).length}catch{}",
  'o.packages=n;',
  'let kb=0;',
  "try{for(const f of fs.readdirSync('/var/cache/apk'))kb+=fs.statSync('/var/cache/apk/'+f).size}catch{}",
  'o.apk_cache_kb=Math.round(kb/1024);',
  'console.log(JSON.stringify(o));',
].join('');

const tagOf = (b) => `dkr-c${CHALLENGE}-p1-${b.key.replace('_', '-')}:test`;
const facts = {};
const results = []; // one row per base

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let tmp;
try {
  cleanup(CHALLENGE);
  tmp = mkdtempSync(join(tmpdir(), 'dkr-c4-p1-'));

  // Step 1: the uname binary from Ubuntu (glibc). It is the test for "does a glibc program run here".
  run(['create', '--name', 'dkr-c4-ubuntu', '--label', 'dkr.challenge=4', 'ubuntu:24.04']);
  const cp = run(['cp', 'dkr-c4-ubuntu:/usr/bin/uname', join(tmp, 'uname')]);
  if (cp.code !== 0) throw new Error(`could not copy uname from ubuntu:24.04: ${cp.stderr.trim()}`);

  for (const b of BASES) {
    const row = { ...b, built: false, health: false };
    results.push(row);
    const k = `c4.p1.${b.key}`;
    const dockerfile = pick(here, b.file);

    // Step 2: build
    const built = build({ dockerfile, context, tag: tagOf(b) });
    row.built = built.ok;
    facts[`${k}_built`] = built.ok;
    const buildLines = built.out.split(/\r?\n/).filter((l) => /^#\d+ (\[|DONE|ERROR)|ERROR|error:/.test(l)).slice(-8);
    rec.step(`docker build -f ${b.file} -t ${tagOf(b)} daftar-api`, built.ok ? buildLines.join('\n') : built.out.split(/\r?\n/).slice(-12).join('\n'), built.ok ? `Built ${b.label}.` : `The build of ${b.label} failed. Read the last lines above.`);
    if (!built.ok) continue;

    // Step 3: sizes. Unpacked = bytes of the files in all layers. Packed = what a registry stores and a pull downloads.
    // docker image inspect Size is neither: with the containerd image store it adds the packed blobs to the unpacked files.
    // We keep it as its own fact so you can see the difference.
    const oci = ociExport({ dockerfile, context });
    row.fieldMb = mb(imageBytes(tagOf(b)));
    row.sizeMb = oci.ok ? mb(oci.unpackedBytes) : NaN;
    row.packedMb = oci.ok ? mb(oci.packedBytes) : NaN;
    facts[`${k}_docker_size_mb`] = row.fieldMb;
    if (oci.ok) {
      facts[`${k}_unpacked_mb`] = row.sizeMb;
      facts[`${k}_packed_mb`] = row.packedMb;
    }

    // Step 4: what is inside (packages, libc, shell, leftover package cache)
    const probe = run(['run', '--rm', ...safeArgs(CHALLENGE, 'probe'), '--entrypoint', b.node, tagOf(b), '-e', PROBE]);
    let info = {};
    try {
      info = JSON.parse(probe.stdout.trim().split(/\r?\n/).pop());
    } catch {
      throw new Error(`probe failed in ${b.label}: ${(probe.stderr || probe.stdout).trim()}`);
    }
    Object.assign(row, { packages: info.packages, musl: info.musl, nodeVersion: info.node, apkCacheKb: info.apk_cache_kb });
    facts[`${k}_packages`] = info.packages;
    facts[`${k}_node_major`] = Number(info.node.replace(/^v/, '').split('.')[0]);
    if (b.key === 'alpine_os') facts[`${k}_apk_cache_kb`] = info.apk_cache_kb;

    // Step 5: is there a shell? (docker exec ... sh is the first debugging move)
    const sh = run(['run', '--rm', ...safeArgs(CHALLENGE, 'probe'), '--entrypoint', 'sh', tagOf(b), '-c', 'true']);
    row.shell = sh.code === 0;
    facts[`${k}_has_shell`] = row.shell;

    // Step 6: does a program built for glibc run here? (Ubuntu's uname)
    run(['rm', '-f', 'dkr-c4-glibc']);
    run(['create', ...safeArgs(CHALLENGE, 'glibc', { memory: '32m' }), '--entrypoint', '/uname', tagOf(b), '-s']);
    run(['cp', join(tmp, 'uname'), 'dkr-c4-glibc:/uname']);
    const g = run(['start', '-a', 'dkr-c4-glibc']);
    row.glibcOk = g.code === 0 && /Linux/.test(g.stdout);
    row.glibcMsg = row.glibcOk ? 'runs' : (g.stderr || g.stdout).trim().split(/\r?\n/)[0];
    run(['rm', '-f', 'dkr-c4-glibc']);
    facts[`${k}_glibc_ok`] = row.glibcOk;

    // Step 7: start the app, time it to the first answer, read memory. Median of three starts.
    const starts = [];
    let rss;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const r = run(['run', '-d', ...safeArgs(CHALLENGE, 'app'), '-p', '127.0.0.1::8080', tagOf(b)]);
      if (r.code !== 0) break;
      try {
        const port = await waitFor(
          () => {
            const m = run(['port', 'dkr-c4-app', '8080/tcp']).stdout.match(/:(\d+)\s*$/m);
            return m && m[1];
          },
          { timeoutMs: 5000, intervalMs: 50, what: 'a published port' },
        );
        await waitFor(() => fetch(`http://127.0.0.1:${port}/health`).then((x) => x.status === 200).catch(() => false), { timeoutMs: 8000, intervalMs: 25, what: '/health' });
        starts.push(performance.now() - t0);
        if (i === 2) {
          const s = run(['stats', '--no-stream', '--format', '{{.MemUsage}}', 'dkr-c4-app']).stdout.trim();
          const m = s.match(/([\d.]+)\s*(MiB|KiB|GiB)/);
          if (m) rss = Number(m[1]) * { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]];
        }
      } catch {
        row.logs = run(['logs', '--tail', '5', 'dkr-c4-app']);
        row.logs = (row.logs.stdout + row.logs.stderr).trim();
      }
      run(['rm', '-f', 'dkr-c4-app']);
      if (starts.length === 0) break;
    }
    row.health = starts.length === 3;
    facts[`${k}_health_ok`] = row.health;
    if (row.health) {
      row.startMs = Math.round(median(starts));
      facts[`${k}_start_ms`] = row.startMs;
      if (rss !== undefined) {
        row.rssMb = round(rss, 1);
        facts[`${k}_idle_mem_mb`] = row.rssMb;
      }
    }
  }

  // One table for the recorded run
  const lines = ['base                          unpacked  packed  Size field  packages  shell  glibc  start   idle mem', ...results.map((r) =>
    [
      r.label.padEnd(30),
      r.built ? `${r.sizeMb} MB`.padEnd(10) : 'build failed'.padEnd(10),
      Number.isFinite(r.packedMb) ? `${r.packedMb} MB`.padEnd(8) : ''.padEnd(8),
      `${r.fieldMb} MB`.padEnd(12),
      String(r.packages ?? '').padEnd(10),
      (r.shell ? 'yes' : 'no').padEnd(7),
      (r.glibcOk ? 'yes' : 'no').padEnd(7),
      r.health ? `${r.startMs} ms`.padEnd(8) : 'no answer'.padEnd(8),
      r.rssMb !== undefined ? `${r.rssMb} MiB` : '',
    ].join(''),
  )];
  rec.step('node challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/run.mjs   (the table at the end)', lines.join('\n'), 'Same app, five bases. Unpacked and packed sizes (from the layers), packages and tools change a lot. Idle memory is the same. Start time is about one second on all of them and moves from run to run.');

  const failed = results.filter((r) => !r.health);
  for (const r of failed) {
    console.log(`\n${r.label}: the container did not answer /health.${r.logs ? `\n  log: ${r.logs.split('\n').slice(0, 3).join('\n       ')}` : ''}`);
  }

  const apk = results.find((r) => r.key === 'alpine_os');
  if (apk?.built) rec.step('docker run --rm --entrypoint /usr/bin/node dkr-c4-p1-alpine-os:test -e "...du of /var/cache/apk..."', `apk package cache left in the image: ${apk.apkCacheKb} KB`, apk.apkCacheKb === 0 ? 'No package index cache is left behind (apk add --no-cache).' : 'The package index cache is still in the image. Use apk add --no-cache.');

  // Step 8: the hardened-image attempt. One look at the registry, no download.
  const dhi = run(['buildx', 'imagetools', 'inspect', 'dhi.io/node:24'], { timeoutMs: 60_000 });
  facts['c4.p1.dhi_anonymous_ok'] = dhi.code === 0;
  rec.step('docker buildx imagetools inspect dhi.io/node:24', clip((dhi.stderr + dhi.stdout).trim().replace(/https:\/\/dhi\.io\/token\?[^\s:]+/g, 'https://dhi.io/token?...')), dhi.code === 0 ? 'The hardened image is readable without a login on this machine.' : 'Docker Hardened Images need a Docker login (free account). This is why they are not one of the five required bases.');

  // Facts and recorded files
  saveFacts(facts);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) {
    run(['rm', '-f', 'dkr-c4-ubuntu']);
  }

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'daftar-api image size on five bases',
        unit: 'MB',
        bars: results.filter((r) => r.built).map((r) => ({ label: r.label, value: r.sizeMb })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\n${results.filter((r) => r.health).length} of ${results.length} bases answered /health.`);
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
