// Challenge 6, part 1: run your own registry, push, pull, and see shared layers.
// Run: node challenges/challenge-6-registry-and-tags/part-1-run-a-registry/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

import { assertDocker, cleanup, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median } from '../../../toolkit/stats.js';
import { CHALLENGE, REGISTRY_IMAGE, buildTiny, freePort, clip, createVolume, mb, pick, readFlags, removeImages, saveFacts, secs, startRegistry } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 6, part 1: run your own registry');
const facts = {};
const VOLUME = 'dkr-c6-registry-data';

const storage = (name) => {
  const blobs = Number(run(['exec', name, 'sh', '-c', 'find /var/lib/registry -path "*blobs*" -name data | wc -l']).stdout.trim() || 0);
  const kb = Number(run(['exec', name, 'sh', '-c', 'du -sk /var/lib/registry | cut -f1']).stdout.trim() || 0);
  return { blobs, kb };
};
const lastLines = (r, n) => (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-n).join('\n');

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

try {
  cleanup(CHALLENGE);
  createVolume(VOLUME);
  // {PORT} in the flags file becomes a free port. Docker Desktop cannot push to a port that Docker picks by itself.
  const hostPort = await freePort();
  const flags = readFlags(pick(here, 'registry-flags.txt')).map((t) => t.replaceAll('{PORT}', String(hostPort)));

  // Step 1: start the registry with your flags and ask it who it is.
  let reg = await startRegistry({ flags });
  const size = Number(run(['image', 'inspect', '--format', '{{.Size}}', REGISTRY_IMAGE]).stdout.trim());
  facts['c6.p1.registry_image_mb'] = mb(size);
  const ping = await fetch(`${reg.base}/v2/`);
  const bound = run(['port', reg.name, '5000/tcp']).stdout.trim().split(/\r?\n/)[0];
  facts['c6.p1.bound_host'] = bound.replace(/:\d+$/, '');
  rec.step(
    `docker run -d ${flags.join(' ')} ${REGISTRY_IMAGE}   then   curl -i http://127.0.0.1:<port>/v2/`,
    `published as ${bound}\nHTTP ${ping.status}\ndocker-distribution-api-version: ${ping.headers.get('docker-distribution-api-version')}\nimage ${REGISTRY_IMAGE}: ${facts['c6.p1.registry_image_mb']} MB unpacked`,
    facts['c6.p1.bound_host'] === '127.0.0.1' ? 'A registry is one container that answers HTTP on /v2/. It listens only on this machine.' : 'The registry listens on every network interface and has no password. Anyone who can reach this machine can push to it.',
  );

  // Step 2: two small images that share a base layer.
  const a = buildTiny({ tag: `${reg.host}/dkr-c6/hello:1`, text: 'hello one' });
  const b = buildTiny({ tag: `${reg.host}/dkr-c6/hello:2`, text: 'hello two' });
  if (a.code !== 0 || b.code !== 0) throw new Error(`could not build the sample images:\n${lastLines(a.code ? a : b, 6)}`);

  // Step 3: push the first image, then the second.
  const t1 = process.hrtime.bigint();
  const push1 = run(['push', `${reg.host}/dkr-c6/hello:1`], { timeoutMs: 300_000 });
  facts['c6.p1.push1_s'] = secs(Number(process.hrtime.bigint() - t1) / 1e6);
  if (push1.code !== 0) throw new Error(`push failed:\n${lastLines(push1, 6)}`);
  const s1 = storage(reg.name);
  const t2 = process.hrtime.bigint();
  const push2 = run(['push', `${reg.host}/dkr-c6/hello:2`], { timeoutMs: 300_000 });
  facts['c6.p1.push2_s'] = secs(Number(process.hrtime.bigint() - t2) / 1e6);
  if (push2.code !== 0) throw new Error(`push failed:\n${lastLines(push2, 6)}`);
  const s2 = storage(reg.name);
  const reused = ((push2.stdout + push2.stderr).match(/already exists/gi) || []).length;
  facts['c6.p1.blobs_after_push1'] = s1.blobs;
  facts['c6.p1.blobs_after_push2'] = s2.blobs;
  facts['c6.p1.push2_layers_reused'] = reused;
  facts['c6.p1.storage_kb_after_push1'] = s1.kb;
  facts['c6.p1.storage_kb_after_push2'] = s2.kb;
  rec.step(`docker push ${reg.host}/dkr-c6/hello:1   then   docker push ${reg.host}/dkr-c6/hello:2`, `first push:  ${s1.blobs} blobs stored, ${s1.kb} KB on disk\n--- second push output ---\n${clip(push2.stdout.replaceAll(reg.host, '<registry>') + push2.stderr, 10)}\nafter the second push: ${s2.blobs} blobs, ${s2.kb} KB`, `The second image reused ${reused} layer(s) that the registry already had. Shared layers are stored once.`);

  // Step 4: pull. Remove the local copies first, so the pull is real. Median of three.
  const pulls = [];
  let pullOut;
  for (let i = 0; i < 3; i++) {
    run(['image', 'rm', '--force', `${reg.host}/dkr-c6/hello:1`]);
    const t = process.hrtime.bigint();
    pullOut = run(['pull', `${reg.host}/dkr-c6/hello:1`], { timeoutMs: 300_000 });
    pulls.push(Number(process.hrtime.bigint() - t) / 1e6);
    if (pullOut.code !== 0) throw new Error(`pull failed:\n${lastLines(pullOut, 6)}`);
  }
  facts['c6.p1.pull_s'] = secs(median(pulls));
  rec.step(`docker image rm ${reg.host}/dkr-c6/hello:1   then   docker pull ${reg.host}/dkr-c6/hello:1`, `${clip(pullOut.stdout.replaceAll(reg.host, '<registry>'), 8)}\npull times: ${pulls.map((p) => secs(p)).join(', ')} s (median ${facts['c6.p1.pull_s']} s)`, 'A pull from a registry on this machine is fast. The numbers show the steps, not the speed of the internet.');

  // Step 5: remove the registry container and make a new one with the same flags. Is the data still there?
  const envBefore = run(['inspect', '--format', '{{json .Config.Env}}', reg.name]).stdout;
  facts['c6.p1.delete_enabled'] = /REGISTRY_STORAGE_DELETE_ENABLED=true/i.test(envBefore);
  run(['rm', '-f', reg.name]);
  reg = await startRegistry({ flags });
  const cat = await fetch(`${reg.base}/v2/_catalog`).then((r) => r.json());
  facts['c6.p1.survives_recreate'] = (cat.repositories ?? []).includes('dkr-c6/hello');
  rec.step('docker rm -f <registry>   then start a new container with the same flags   then   curl http://127.0.0.1:<port>/v2/_catalog', JSON.stringify(cat), facts['c6.p1.survives_recreate'] ? 'The images are still there: the data lives in a volume, not in the container.' : 'The catalog is empty. The data lived inside the container, and the container is gone.');

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    const first = s1.kb;
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Registry storage on disk',
        unit: 'KB',
        bars: [
          { label: 'After image 1', value: first },
          { label: 'After image 2 (shares a layer)', value: s2.kb },
          { label: 'If nothing were shared', value: first * 2 },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nBound to ${facts['c6.p1.bound_host']}. Survives recreate: ${facts['c6.p1.survives_recreate']}. Delete enabled: ${facts['c6.p1.delete_enabled']}. Second push reused ${reused} layer(s).`);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages();
}
