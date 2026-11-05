// Challenge 6, part 2: call the registry HTTP API from Node.
// Run: node challenges/challenge-6-registry-and-tags/part-2-call-the-api/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).
//
// client.mjs is the file you fix. This script starts a registry, pushes two images, calls every
// function of client.mjs, and compares the answers with what the registry really holds.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertDocker, cleanup, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { CHALLENGE, buildTiny, clip, mb, pick, registryRequests, removeImages, saveFacts, short, startRegistry } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 6, part 2: call the registry API');
const facts = {};
const REPO = 'dkr-c6/hello';
const lastLines = (r, n) => (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-n).join('\n');
const sha = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`;
const ACCEPT = 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';

/** Run one call of the learner's client. A crash counts as a wrong answer, with the reason. */
async function tryCall(name, fn) {
  try {
    return { value: await fn() };
  } catch (e) {
    return { error: `${name} threw: ${e.message}` };
  }
}

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

try {
  cleanup(CHALLENGE);
  const client = await import(pathToFileURL(pick(here, 'client.mjs')).href);

  const reg = await startRegistry({ flags: ['-e', 'REGISTRY_STORAGE_DELETE_ENABLED=true'] });
  for (const [tag, text, extra] of [['1', 'hello one', ''], ['2', 'hello two', 'RUN head -c 2000000 /dev/urandom > /blob']]) {
    const b = buildTiny({ tag: `${reg.host}/${REPO}:${tag}`, text, dockerfileExtra: extra });
    if (b.code !== 0) throw new Error(`could not build the sample image:\n${lastLines(b, 6)}`);
  }
  const pushed = {};
  for (const tag of ['1', '2']) {
    const p = run(['push', `${reg.host}/${REPO}:${tag}`], { timeoutMs: 300_000 });
    if (p.code !== 0) throw new Error(`push failed:\n${lastLines(p, 6)}`);
    pushed[tag] = /digest: (sha256:[0-9a-f]{64})/.exec(p.stdout + p.stderr)?.[1];
  }
  // The oracle: the digest of a manifest is the SHA-256 of its exact bytes.
  const raw = await fetch(`${reg.base}/v2/${REPO}/manifests/1`, { headers: { accept: ACCEPT } });
  const bytes = Buffer.from(await raw.arrayBuffer());
  const truth = { digest: sha(bytes), body: JSON.parse(bytes.toString('utf8')) };
  facts['c6.p2.oracle_matches_push'] = truth.digest === pushed['1'];
  rec.step(`docker push ${reg.host}/${REPO}:1   and   :2`, `tag 1 -> ${pushed['1']}\ntag 2 -> ${pushed['2']}\nsha256 of the manifest bytes of tag 1: ${truth.digest}`, 'A digest is the SHA-256 of the manifest bytes. The registry and the hash agree.');

  // The calls
  const lines = [];
  const check = (key, label, result, expected, show = (v) => JSON.stringify(v)) => {
    const ok = !result.error && JSON.stringify(result.value) === JSON.stringify(expected);
    facts[`c6.p2.${key}_ok`] = ok;
    lines.push(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(30)} ${result.error ?? show(result.value)}${ok ? '' : `   (expected ${show(expected)})`}`);
  };
  const ping = await tryCall('ping', () => client.ping(reg.base));
  check('ping', 'ping()', ping, { status: 200, apiVersion: 'registry/2.0' });
  const cat = await tryCall('catalog', () => client.catalog(reg.base));
  check('catalog', 'catalog()', cat, [REPO]);
  const tg = await tryCall('tags', () => client.tags(reg.base, REPO));
  check('tags', `tags('${REPO}')`, tg, ['1', '2']);
  const dg = await tryCall('digestOf', () => client.digestOf(reg.base, REPO, '1'));
  check('digest', "digestOf(..., '1')", dg, pushed['1'], (v) => (v ? short(v) : String(v)));
  const mf = await tryCall('manifest', () => client.manifest(reg.base, REPO, '1').then((m) => ({ status: m.status, digest: m.digest, layers: m.layers.length })));
  check('manifest', "manifest(..., '1')", mf, { status: 200, digest: pushed['1'], layers: truth.body.layers.length }, (v) => (v?.digest ? JSON.stringify({ ...v, digest: short(v.digest) }) : JSON.stringify(v)));
  const pb = await tryCall('packedBytes', () => client.packedBytes(reg.base, REPO, '1'));
  const wantBytes = (truth.body.config?.size ?? 0) + truth.body.layers.reduce((s, l) => s + l.size, 0);
  check('packed_bytes', "packedBytes(..., '1')", pb, wantBytes);
  facts['c6.p2.image_packed_mb'] = mb(wantBytes, 2);
  rec.step('node -e "import(\'./client.mjs\')..."  (ping, catalog, tags, digestOf, manifest, packedBytes)', lines.join('\n'), lines.every((l) => l.startsWith('ok')) ? 'Every call matches what the registry holds.' : 'FAIL lines are calls that returned the wrong thing. Fix client.mjs.');

  // What does a pull ask for? Count the requests the registry logged.
  // Part A: docker pull on this machine. It already holds every layer of tag 3 (it built them), so a pull is one question.
  const b3 = buildTiny({ tag: `${reg.host}/${REPO}:3`, text: 'hello three', dockerfileExtra: 'RUN head -c 1000000 /dev/urandom > /blob3' });
  if (b3.code !== 0) throw new Error(`could not build tag 3:\n${lastLines(b3, 6)}`);
  const p3 = run(['push', `${reg.host}/${REPO}:3`], { timeoutMs: 300_000 });
  if (p3.code !== 0) throw new Error(`push failed:\n${lastLines(p3, 6)}`);
  run(['image', 'rm', '--force', `${reg.host}/${REPO}:3`]);
  await new Promise((r) => setTimeout(r, 500));
  const skipA = registryRequests(reg.name).length;
  const pull = run(['pull', `${reg.host}/${REPO}:3`], { timeoutMs: 300_000 });
  if (pull.code !== 0) throw new Error(`pull failed:\n${lastLines(pull, 6)}`);
  await new Promise((r) => setTimeout(r, 500));
  const short_ = (u) => u.replace(/sha256:([0-9a-f]{8})[0-9a-f]+/g, 'sha256:$1...');
  const reqsA = registryRequests(reg.name).slice(skipA).filter((r) => r.uri.startsWith('/v2/'));
  facts['c6.p2.docker_pull_requests_layers_present'] = reqsA.length;
  rec.step(
    `docker pull ${reg.host}/${REPO}:3   (this machine already holds every layer)`,
    reqsA.map((r) => `${r.method.padEnd(5)} ${short_(r.uri)} ${r.status}`).join('\n'),
    `${reqsA.length} request(s). Docker asks the registry which digest the tag has, sees it holds all the blobs, and downloads nothing.`,
  );

  // Part B: a machine with nothing. We pull like a fresh machine does: ping, manifest, config blob, every layer.
  const skipB = registryRequests(reg.name).length;
  const t0 = process.hrtime.bigint();
  await client.ping(reg.base);
  const mf3 = await client.manifest(reg.base, REPO, '3');
  let freshBytes = 0;
  for (const d of [mf3.config?.digest, ...mf3.layers.map((l) => l.digest)].filter(Boolean)) {
    const blob = Buffer.from(await (await fetch(`${reg.base}/v2/${REPO}/blobs/${d}`)).arrayBuffer());
    if (sha(blob) !== d) throw new Error(`a blob does not match its digest: ${d}`);
    freshBytes += blob.length;
  }
  const freshMs = Number(process.hrtime.bigint() - t0) / 1e6;
  await new Promise((r) => setTimeout(r, 500));
  const reqs = registryRequests(reg.name).slice(skipB).filter((r) => r.uri.startsWith('/v2/'));
  const kinds = { ping: 0, manifest: 0, blob: 0 };
  for (const r of reqs) {
    if (/\/manifests\//.test(r.uri)) kinds.manifest++;
    else if (/\/blobs\//.test(r.uri)) kinds.blob++;
    else kinds.ping++;
  }
  facts['c6.p2.pull_requests_total'] = reqs.length;
  facts['c6.p2.pull_manifest_requests'] = kinds.manifest;
  facts['c6.p2.pull_blob_requests'] = kinds.blob;
  facts['c6.p2.pull_ping_requests'] = kinds.ping;
  facts['c6.p2.pull_downloaded_mb'] = mb(freshBytes, 2);
  facts['c6.p2.pull_layers'] = mf3.layers.length;
  rec.step(
    'a fresh machine pulls tag 3: ping, manifest, config blob, each layer (read from the registry log)',
    reqs.map((r) => `${r.method.padEnd(5)} ${short_(r.uri)} ${r.status}`).join('\n') + `\ndownloaded ${mb(freshBytes, 2)} MB in ${Math.round(freshMs)} ms`,
    `A full pull is ${reqs.length} requests: ${kinds.ping} ping, ${kinds.manifest} manifest, ${kinds.blob} blob (the config and ${mf3.layers.length} layers). There is no token step because this registry has no login.`,
  );

  // Delete a tag, then see that the space does not come back until garbage collection.
  const kb = () => Number(run(['exec', reg.name, 'sh', '-c', 'du -sk /var/lib/registry | cut -f1']).stdout.trim() || 0);
  const before = kb();
  const del = await tryCall('deleteTag', () => client.deleteTag(reg.base, REPO, '2'));
  facts['c6.p2.delete_status'] = del.error ? 0 : del.value;
  const afterTags = await tryCall('tags', () => client.tags(reg.base, REPO));
  const gone = !afterTags.error && !afterTags.value.includes('2') && (await fetch(`${reg.base}/v2/${REPO}/manifests/2`, { headers: { accept: ACCEPT } })).status === 404;
  facts['c6.p2.deleted_tag_gone'] = gone;
  const afterDelete = kb();
  const gc = run(['exec', reg.name, 'registry', 'garbage-collect', '/etc/distribution/config.yml']);
  const gcAll = (gc.stdout + gc.stderr).trim().split(/\r?\n/).filter((l) => /eligible|Deleting|deleted/i.test(l));
  const gcLines = (gcAll.length ? gcAll : ['garbage collection: no blob was eligible for deletion']).slice(0, 4).map((l) => l.replace(/time=\S+ level=\S+ /, '').slice(0, 110)).join('\n');
  const afterGc = kb();
  facts['c6.p2.storage_kb_before_delete'] = before;
  facts['c6.p2.storage_kb_after_delete'] = afterDelete;
  facts['c6.p2.storage_kb_after_gc'] = afterGc;
  facts['c6.p2.gc_ok'] = gc.code === 0;
  rec.step(
    `DELETE /v2/${REPO}/manifests/<digest>   then   registry garbage-collect`,
    `delete status: ${facts['c6.p2.delete_status']}   (202 means accepted)\ntag 2 gone from the tag list: ${gone}\nstorage before ${before} KB, after delete ${afterDelete} KB, after garbage collection ${afterGc} KB\n${gcLines}`,
    afterGc < afterDelete ? 'Deleting removes the reference only. The bytes go when garbage collection runs.' : 'Garbage collection freed nothing. The manifest is still there: a delete by tag removes only the tag, not the manifest (delete by digest).',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'HTTP requests when a fresh machine pulls one image',
        unit: 'requests',
        bars: [
          { label: 'Ping (/v2/)', value: kinds.ping },
          { label: 'Manifest', value: kinds.manifest },
          { label: 'Blob (config + layers)', value: kinds.blob },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  const failed = lines.filter((l) => l.startsWith('FAIL'));
  console.log(`\n${lines.length - failed.length} of ${lines.length} client calls are right. Delete status ${facts['c6.p2.delete_status']}.`);
  for (const l of failed) console.log(l);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages();
}
