// Challenge 6, part 3: a tag that moves under a second server, and a deploy by digest.
// Run: node challenges/challenge-6-registry-and-tags/part-3-a-tag-that-moves/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).
//
// deploy.mjs is the file you fix. "Server A" and "server B" are two containers on this machine.
// They pull from a registry that this script starts. Think of them as two different servers.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertDocker, cleanup, run, safeArgs, waitFor } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median } from '../../../toolkit/stats.js';
import { CHALLENGE, clip, pick, removeImages, saveFacts, secs, short, startRegistry } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 6, part 3: a tag that moves');
const facts = {};
const REPO = 'dkr-c6/daftar-api';
const ACCEPT = 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
const lastLines = (r, n) => (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-n).join('\n');

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

try {
  cleanup(CHALLENGE);
  const { imageRef, rollbackTarget } = await import(pathToFileURL(pick(here, 'deploy.mjs')).href);
  const reg = await startRegistry({ flags: ['-e', 'REGISTRY_STORAGE_DELETE_ENABLED=true'] });

  /** Build daftar-api with a version and a revision, push it under a tag, return the release record. */
  function release(tag, version, revision) {
    const ref = `${reg.host}/${REPO}:${tag}`;
    const b = run(['build', '--provenance=false', '--sbom=false', '--label', `dkr.challenge=${CHALLENGE}`, '-f', join(here, 'Dockerfile'), '--build-arg', `APP_VERSION=${version}`, '--build-arg', `REVISION=${revision}`, '-t', ref, join(root, 'daftar-api')], { timeoutMs: 300_000 });
    if (b.code !== 0) throw new Error(`build failed:\n${lastLines(b, 8)}`);
    const p = run(['push', ref], { timeoutMs: 300_000 });
    if (p.code !== 0) throw new Error(`push failed:\n${lastLines(p, 6)}`);
    const digest = /digest: (sha256:[0-9a-f]{64})/.exec(p.stdout + p.stderr)?.[1];
    return { registry: reg.host, repo: REPO, tag, digest, version, revision };
  }
  const tagDigest = async (tag) => (await fetch(`${reg.base}/v2/${REPO}/manifests/${tag}`, { method: 'HEAD', headers: { accept: ACCEPT } })).headers.get('docker-content-digest');

  /** Start (or replace) a server from a release. Returns the published port once /health answers. */
  async function deploy(name, rel) {
    run(['rm', '-f', `dkr-c6-${name}`]);
    const ref = imageRef(rel);
    const r = run(['run', '-d', '--pull', 'always', ...safeArgs(CHALLENGE, name, { memory: '128m' }), '-p', '127.0.0.1::8080', ref], { timeoutMs: 300_000 });
    if (r.code !== 0) throw new Error(`could not start ${name} from ${ref.replace(reg.host, '<registry>')}:\n${lastLines(r, 4)}`);
    const port = await waitFor(() => run(['port', `dkr-c6-${name}`, '8080/tcp']).stdout.match(/:(\d+)\s*$/m)?.[1], { timeoutMs: 8000, intervalMs: 50, what: 'a published port' });
    await waitFor(() => fetch(`http://127.0.0.1:${port}/health`).then((x) => x.status === 200).catch(() => false), { timeoutMs: 15_000, intervalMs: 50, what: `${name} /health` });
    return port;
  }
  const versionOf = async (port) => (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.json())).version;
  const inspect = (name, fmt) => run(['inspect', '--format', fmt, `dkr-c6-${name}`]).stdout.trim();

  // Step 1 and 2: release 1.4 and server A.
  const r1 = release('1.4', '1.4.0', 'aaa1111');
  const portA = await deploy('server-a', r1);
  const vA = await versionOf(portA);
  facts['c6.p3.deploys_by_digest'] = imageRef(r1).includes('@sha256:');
  rec.step(`docker push <registry>/${REPO}:1.4   then on server A:  docker run ${imageRef(r1).replace(reg.host, '<registry>').replace(/(sha256:[0-9a-f]{12})[0-9a-f]+/, '$1...')}`, `tag 1.4 -> ${short(r1.digest)}\nserver A answers version ${vA}`, 'Server A runs release 1.4.');

  // Step 3: somebody pushes a hotfix under the same tag.
  const before = await tagDigest('1.4');
  const hotfix = release('1.4', '1.4.0-hotfix', 'bbb2222');
  const after = await tagDigest('1.4');
  facts['c6.p3.tag_moved'] = before !== after;
  rec.step(`docker push <registry>/${REPO}:1.4   (a hotfix, same tag)`, `tag 1.4 before: ${short(before)}\ntag 1.4 after:  ${short(after)}\nold digest still in the registry: ${(await fetch(`${reg.base}/v2/${REPO}/manifests/${r1.digest}`, { method: 'HEAD', headers: { accept: ACCEPT } })).status === 200}`, 'The tag moved. The old bytes are still stored under their digest.');

  // Step 4: server B is set up an hour later from "release 1.4". Does it run what A runs?
  const portB = await deploy('server-b', r1);
  const vB = await versionOf(portB);
  facts['c6.p3.a_version'] = vA;
  facts['c6.p3.b_version'] = vB;
  facts['c6.p3.same_code'] = vA === vB;
  const idA = inspect('server-a', '{{.Image}}');
  const idB = inspect('server-b', '{{.Image}}');
  facts['c6.p3.same_image_id'] = idA === idB;
  const revA = inspect('server-a', '{{index .Config.Labels "org.opencontainers.image.revision"}}');
  const revB = inspect('server-b', '{{index .Config.Labels "org.opencontainers.image.revision"}}');
  facts['c6.p3.trace_revision_found'] = Boolean(revA && revB && revA !== '<no value>' && revB !== '<no value>');
  rec.step(
    'docker inspect --format ... on both servers, and GET / on both',
    `server A: version ${vA}, image ${short(idA)}, revision ${revA}\nserver B: version ${vB}, image ${short(idB)}, revision ${revB}`,
    vA === vB ? 'Both servers run the same bytes.' : 'Same release name, different code. The label on each container says which commit it really is.',
  );

  // Step 5: release 1.5 is bad. Roll back. Three times, to get a median.
  const r3 = release('1.5', '1.5.0', 'ccc3333');
  const releases = [r1, r3];
  const times = [];
  let healthy = false;
  let rolledVersion;
  for (let i = 0; i < 3; i++) {
    const p = await deploy('server-a', r3);
    await fetch(`http://127.0.0.1:${p}/break`); // from now on this server answers 500
    const broken = (await fetch(`http://127.0.0.1:${p}/health`)).status;
    if (broken !== 500) throw new Error('the bad release did not break as planned');
    const t0 = process.hrtime.bigint();
    const target = rollbackTarget(releases);
    const pr = await deploy('server-a', target);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    rolledVersion = await versionOf(pr);
    healthy = (await fetch(`http://127.0.0.1:${pr}/health`)).status === 200;
  }
  facts['c6.p3.rollback_s'] = secs(median(times));
  facts['c6.p3.rollback_healthy'] = healthy;
  facts['c6.p3.rollback_version'] = rolledVersion;
  facts['c6.p3.rollback_to_previous'] = rolledVersion === r1.version;
  rec.step(
    'deploy 1.5 (it breaks), then roll back to the release before it',
    `rolled back to version ${rolledVersion}, healthy: ${healthy}\nrollback times: ${times.map((t) => secs(t)).join(', ')} s (median ${facts['c6.p3.rollback_s']} s)`,
    rolledVersion === r1.version ? 'Rollback is one deploy of a digest you already know. It does not need a build.' : 'The server runs the bad release again. A rollback must go to the release before it.',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Release 1.4 on two servers: do they run the same code?',
        unit: 'servers',
        bars: [
          { label: 'Running the first 1.4', value: [vA, vB].filter((v) => v === r1.version).length },
          { label: 'Running the hotfix 1.4', value: [vA, vB].filter((v) => v === hotfix.version).length },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nServer A ${vA}, server B ${vB}. Rollback ${facts['c6.p3.rollback_s']} s, to the previous release: ${facts['c6.p3.rollback_to_previous']}.`);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages();
}
