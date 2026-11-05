// Challenge 2, part 3: a tag that moves, and a digest that does not.
// Run: node challenges/challenge-2-take-an-image-apart/part-3-a-tag-that-moves/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It starts a small private registry, pushes version 1 of daftar-api as :stable, starts "server A",
// then releases version 2 under the same tag, starts "server B", and asks the registry (with your
// functions in resolve.mjs) what the tag points to before and after.

import { cpSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, assertDocker, cleanup, leftovers, label, name, safeArgs, waitFor } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { N, docker, workDir, tmp, rmTree, build, removeImages, mb, short } from '../lib/common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 2, part 3: a tag that moves, and a digest that does not');

const REGISTRY_IMAGE = 'registry:3';
const VOLUME = name(N, 'registry-data');
const REG_CTR = name(N, 'registry');
const REPO = 'dkr-c2-app';
const work = tmp('p3');

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** True when nothing on this computer listens on the port. */
const portIsFree = (p) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(true)));
  });

const version = (ctr) => {
  const r = run(['exec', ctr, 'node', '-e', "fetch('http://127.0.0.1:8080/').then((r) => r.json()).then((j) => console.log(j.version))"]);
  return r.code === 0 ? r.stdout.trim() : null;
};
const waitVersion = (ctr) => waitFor(() => version(ctr), { timeoutMs: 30_000, intervalMs: 300, what: `${ctr} to answer` });
const imageId = (ctr) => docker(['inspect', ctr, '--format', '{{.Image}}']).trim().replace('sha256:', '').slice(0, 12);

try {
  cleanup(N);
  const { digestOf, listTags, layersOf } = await import(pathToFileURL(join(workDir(here), 'resolve.mjs')).href);

  // Step 1: a registry.
  if (run(['image', 'inspect', REGISTRY_IMAGE]).code !== 0) docker(['pull', REGISTRY_IMAGE], { timeoutMs: 300_000 });
  docker(['volume', 'create', ...label(N), VOLUME]);
  // Docker Desktop's daemon can push to 127.0.0.1:<port> only when the port is fixed, not when Docker picks it. So we pick a free one.
  let port = 0;
  for (let attempt = 0; attempt < 8 && !port; attempt++) {
    const candidate = 5100 + Math.floor(Math.random() * 800);
    if (!(await portIsFree(candidate))) continue;
    const r = run(['run', '-d', ...safeArgs(N, 'registry', { memory: '128m', pids: 100 }), '-p', `127.0.0.1:${candidate}:5000`, '-v', `${VOLUME}:/var/lib/registry`, REGISTRY_IMAGE]);
    if (r.code === 0) port = candidate;
    else run(['rm', '-f', REG_CTR]);
  }
  if (!port) throw new Error('could not start the registry on a free port');
  const REG = `127.0.0.1:${port}`;
  const base = `http://${REG}`;
  await waitFor(async () => (await fetch(`${base}/v2/`)).status === 200, { timeoutMs: 30_000, what: 'the registry to answer' });
  const empty = await (await fetch(`${base}/v2/_catalog`)).text();
  rec.step(
    `docker run -d -p 127.0.0.1:${port}:5000 -v ${VOLUME}:/var/lib/registry ${REGISTRY_IMAGE}   then   curl ${base}/v2/_catalog`,
    empty.trim(),
    'A registry is a small web server with a few routes under /v2/. It holds blobs and manifests by digest, and a table of tags. It starts empty.',
  );

  // Step 2: release 1.
  const ctx = join(work, 'ctx');
  cpSync(join(repoRoot, 'daftar-api'), ctx, { recursive: true, filter: (p) => !p.endsWith('test.mjs') && !p.includes('Dockerfile') });
  const buildRelease = (ver, tags) => {
    const b = build({ tag: `${REG}/${REPO}:${tags[0]}`, dockerfile: join(here, 'Dockerfile'), context: ctx, args: ['--build-arg', `APP_VERSION=${ver}`] });
    if (b.code !== 0) throw new Error(`build failed:\n${b.out.split('\n').slice(-12).join('\n')}`);
    for (const t of tags.slice(1)) docker(['tag', `${REG}/${REPO}:${tags[0]}`, `${REG}/${REPO}:${t}`]);
    const out = [];
    for (const t of tags) {
      const p = run(['push', `${REG}/${REPO}:${t}`], { timeoutMs: 300_000 });
      if (p.code !== 0) throw new Error(`push failed: ${(p.stderr || p.stdout).trim()}`);
      out.push(`${p.stdout}\n${p.stderr}`);
    }
    return out.join('\n');
  };
  const push1 = buildRelease('1.0.0', ['stable', '1.0.0']);
  const d1 = await digestOf(base, REPO, 'stable');
  const d1v = await digestOf(base, REPO, '1.0.0');
  const tags1 = await listTags(base, REPO);
  const layers1 = await layersOf(base, REPO, 'stable');
  removeImages(`${REG}/${REPO}:stable`, `${REG}/${REPO}:1.0.0`); // this computer plays the build machine: forget the local tags
  rec.step(
    `docker push ${REG}/${REPO}:stable  (and :1.0.0)   then   digestOf / listTags / layersOf   # your code`,
    [
      `tags:      ${tags1.join(', ')}`,
      `stable  -> ${short(d1, 16)}`,
      `1.0.0   -> ${short(d1v, 16)}`,
      `layers:    ${layers1.length}, ${layers1.reduce((s, l) => s + l.size, 0)} bytes packed`,
    ].join('\n'),
    'Two tags, one digest. A tag is a name in the registry\'s table. The digest is the hash of the manifest.',
  );

  // Step 3: server A deploys by tag. It pulls version 1.
  docker(['run', '-d', ...safeArgs(N, 'server-a', { memory: '96m' }), `${REG}/${REPO}:stable`], { timeoutMs: 300_000 });
  const vA = await waitVersion(name(N, 'server-a'));
  rec.step(`docker run -d --name ${name(N, 'server-a')} ${REG}/${REPO}:stable   # pulls, then GET /`, `server A runs version ${vA} (image ${imageId(name(N, 'server-a'))})`, 'Server A had no copy, so it pulled what stable meant at that moment.');

  // Step 4: release 2 under the same tag.
  const push2 = buildRelease('2.0.0', ['stable', '2.0.0']);
  const d2 = await digestOf(base, REPO, 'stable');
  const d1again = await digestOf(base, REPO, '1.0.0');
  const d2v = await digestOf(base, REPO, '2.0.0');
  const tags2 = await listTags(base, REPO);
  const layers2 = await layersOf(base, REPO, 'stable');
  const have = new Set(layers1.map((l) => l.digest));
  const newLayers = layers2.filter((l) => !have.has(l.digest));
  const newBytes = newLayers.reduce((s, l) => s + l.size, 0);
  const fullBytes = layers2.reduce((s, l) => s + l.size, 0);
  const existsCount = (push2.match(/already exists/gi) ?? []).length;
  removeImages(`${REG}/${REPO}:stable`, `${REG}/${REPO}:2.0.0`);
  rec.step(
    `docker build --build-arg APP_VERSION=2.0.0 -t ${REG}/${REPO}:stable .  &&  docker push ...:stable  (and :2.0.0)`,
    [
      `tags:      ${tags2.join(', ')}`,
      `stable  -> ${short(d2, 16)}   (was ${short(d1, 16)})`,
      `1.0.0   -> ${short(d1again, 16)}   (did not move)`,
      `2.0.0   -> ${short(d2v, 16)}`,
      `layers:    ${layers2.length}, of which ${layers2.length - newLayers.length} are the same as version 1`,
      `the two pushes said "already exists" ${existsCount} times; new layers: ${newLayers.length}, ${newBytes} bytes packed (a full pull is ${fullBytes})`,
    ].join('\n'),
    'The tag moved: same name, new digest. The version tag did not. Almost all layers are shared, so an update downloads only what changed.',
  );

  // Step 5: server B deploys the same tag later. Server A keeps running.
  docker(['run', '-d', ...safeArgs(N, 'server-b', { memory: '96m' }), `${REG}/${REPO}:stable`], { timeoutMs: 300_000 });
  const vB = await waitVersion(name(N, 'server-b'));
  docker(['restart', '-t', '2', name(N, 'server-a')]);
  const vA2 = await waitVersion(name(N, 'server-a'));
  const fmt = (ctr) => docker(['inspect', ctr, '--format', '{{.Config.Image}}']).trim();
  rec.step(
    `docker run -d --name ${name(N, 'server-b')} ${REG}/${REPO}:stable   then   docker restart ${name(N, 'server-a')}`,
    [
      `server A: ${fmt(name(N, 'server-a'))}  ->  version ${vA2} (image ${imageId(name(N, 'server-a'))}), after a restart`,
      `server B: ${fmt(name(N, 'server-b'))}  ->  version ${vB} (image ${imageId(name(N, 'server-b'))})`,
    ].join('\n'),
    'Two servers, the same tag in their config, two different programs running. A restart does not pull, so A stays on 1.0.0. Nobody changed any config.',
  );

  // Step 6: deploy by digest.
  docker(['run', '-d', ...safeArgs(N, 'server-c', { memory: '96m' }), `${REG}/${REPO}@${d1}`], { timeoutMs: 300_000 });
  const vC = await waitVersion(name(N, 'server-c'));
  rec.step(
    `docker run -d --name ${name(N, 'server-c')} ${REG}/${REPO}@${short(d1, 12)}...`,
    `server C: version ${vC} (image ${imageId(name(N, 'server-c'))}), even though stable now means ${vB}`,
    'A digest cannot move: it is the hash of the content. Deploy by digest, keep the tag for humans.',
  );

  setFact('c2.p3.digest_v1', d1);
  setFact('c2.p3.digest_v2', d2);
  setFact('c2.p3.tag_moved', d1 !== d2);
  setFact('c2.p3.version_tag_stayed', d1v === d1again && d1v === d1);
  setFact('c2.p3.tags_count', tags2.length);
  setFact('c2.p3.shared_layers_count', layers2.length - newLayers.length);
  setFact('c2.p3.new_layers_count', newLayers.length);
  setFact('c2.p3.push2_already_exists_count', existsCount);
  setFact('c2.p3.update_download_bytes', newBytes);
  setFact('c2.p3.full_pull_bytes', fullBytes);
  setFact('c2.p3.server_a_version', vA);
  setFact('c2.p3.server_a_after_restart_version', vA2);
  setFact('c2.p3.server_b_version', vB);
  setFact('c2.p3.server_c_by_digest_version', vC);
  setFact('c2.p3.same_tag_two_versions', vA2 !== vB);

  cleanup(N);
  removeOurImages();
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c2.p3.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'The registry, its volume and the three servers are gone, and so are the image tags that started with 127.0.0.1.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Download for version 2 when version 1 is already there',
        unit: 'MB',
        bars: [
          { label: 'full image (new server)', value: mb(fullBytes, 2) },
          { label: 'update (server with v1)', value: mb(newBytes, 4) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c2.p3');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(N);
  removeOurImages();
  rmTree(work);
}

/** Remove the local images of the repository dkr-c2-app that came from our registry (127.0.0.1:<port>/dkr-c2-app). Only ours. */
function removeOurImages() {
  const rows = run(['image', 'ls', '--digests', '--format', '{{.Repository}} {{.Tag}} {{.Digest}}']).stdout.split('\n').map((l) => l.trim().split(' '));
  for (const [repo, tag, digest] of rows) {
    if (!/^127\.0\.0\.1:\d+\/dkr-c2-app$/.test(repo ?? '')) continue;
    run(['image', 'rm', tag && tag !== '<none>' ? `${repo}:${tag}` : `${repo}@${digest}`]);
  }
}
