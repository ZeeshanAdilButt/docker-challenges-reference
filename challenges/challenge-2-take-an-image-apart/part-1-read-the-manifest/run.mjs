// Challenge 2, part 1: read an image's manifest, config and layers with your own code.
// Run: node challenges/challenge-2-take-an-image-apart/part-1-read-the-manifest/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It builds a small image, saves it with `docker save`, and reads the tar with the functions you wrote
// in readimage.mjs. Then it checks your reading against what Docker itself says.

import { statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, assertDocker, cleanup, leftovers } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { readTarFile, openImage, layerBytes } from '../lib/image.mjs';
import { N, docker, workDir, tmp, rmTree, build, save, removeImages, mb, short } from '../lib/common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 2, part 1: read an image with your own code');

const TAG = 'dkr-c2-demo:1';
const work = tmp('p1');

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

try {
  cleanup(N);
  const { readImage, findBadDigests, findBadDiffIds } = await import(pathToFileURL(join(workDir(here), 'readimage.mjs')).href);

  // Step 1: build and save.
  const b = build({ tag: TAG, dockerfile: join(here, 'Dockerfile'), context: here });
  if (b.code !== 0) throw new Error(`build failed:\n${b.out.split('\n').slice(-15).join('\n')}`);
  const tarFile = join(work, 'image.tar');
  save(TAG, tarFile);
  const tarBytes = statSync(tarFile).size;
  const entries = readTarFile(tarFile);
  const names = [...entries.keys()];
  rec.step(
    `docker build -t ${TAG} .  &&  docker save -o image.tar ${TAG}`,
    [`image.tar is ${tarBytes} bytes and holds ${names.length} files:`, ...names.map((n) => `  ${n}  (${entries.get(n).length} bytes)`)].join('\n'),
    'A saved image is just a tar of small files: an index, a manifest, a config and one blob per layer. Blob names are digests.',
  );

  // Step 2: your code reads it.
  const img = readImage(entries);
  const layerLines = img.layers.map((l, i) => `  layer ${i}  ${short(l.digest)}  ${String(l.size).padStart(8)} bytes packed  diffId ${short(l.diffId)}  ${l.mediaType.replace('application/vnd.', '')}`);
  rec.step(
    'readImage(entries)   # your code in readimage.mjs',
    [
      `manifest ${short(img.manifestDigest)}   config ${short(img.configDigest)}   ${img.os}/${img.architecture}`,
      `${img.layers.length} layers:`,
      ...layerLines,
    ].join('\n'),
    'index.json points to the manifest, the manifest to the config and the layers. Each step is a digest, so nothing can change without changing the name.',
  );

  // Step 3: history against layers.
  const hist = img.history.map((h, i) => `  ${String(i).padStart(2)}  ${h.emptyLayer ? 'no layer' : 'LAYER   '}  ${h.createdBy.replace(/\s+/g, ' ').replace(/ # buildkit$/, '').slice(0, 70)}`);
  const emptyCount = img.history.filter((h) => h.emptyLayer).length;
  rec.step(
    'config.history   # one line per Dockerfile step',
    [...hist, `${img.history.length} steps, ${emptyCount} made no layer, ${img.history.length - emptyCount} made a layer`].join('\n'),
    'ENV, LABEL and CMD only change the config. Steps that write files make layers. Layers in the manifest equal steps with LAYER.',
  );

  // Step 4: digests all check out, and a flipped byte is caught.
  const bad = findBadDigests(entries);
  const badDiff = findBadDiffIds(entries);
  const tampered = new Map(entries);
  const victim = img.layers[0];
  const copy = Buffer.from(tampered.get(`blobs/sha256/${victim.digest.slice(7)}`));
  copy[copy.length - 20] ^= 0x01; // flip one bit near the end of the base layer
  tampered.set(`blobs/sha256/${victim.digest.slice(7)}`, copy);
  const caught = findBadDigests(tampered);
  rec.step(
    'findBadDigests(entries)  and  findBadDigests(<one bit flipped in layer 0>)',
    [
      `good image:      ${bad.length} bad digests, ${badDiff.length} bad diffIds`,
      `one bit flipped: ${caught.length} bad digest -> ${caught.map((d) => short(d)).join(', ')}`,
    ].join('\n'),
    `A digest is the hash of the bytes. Change one bit in a ${round(victim.size / 1e6, 1)} MB layer and the name no longer matches.`,
  );

  // Step 5: check against Docker.
  const inspect = JSON.parse(docker(['image', 'inspect', TAG]))[0];
  const sameLayers = JSON.stringify(inspect.RootFS.Layers) === JSON.stringify(img.layers.map((l) => l.diffId));
  const idIsManifest = inspect.Id === img.manifestDigest;
  const idIsConfig = inspect.Id === img.configDigest;
  const packed = img.layers.reduce((s, l) => s + l.size, 0);
  const unpacked = openImage(entries).layers.reduce((s, l) => s + layerBytes(l), 0);
  rec.step(
    `docker image inspect ${TAG} --format "{{.Id}} {{.Size}} {{json .RootFS.Layers}}"`,
    [
      `Id          ${inspect.Id.slice(0, 19)}...  ${idIsManifest ? '= the manifest digest' : idIsConfig ? '= the config digest' : '= neither'}`,
      `RootFS.Layers equal your diffIds: ${sameLayers}`,
      `your layers ${packed} bytes packed (what a pull downloads)`,
      `files in them ${unpacked} bytes unpacked (what the container sees)`,
      `Size field  ${inspect.Size} bytes`,
    ].join('\n'),
    idIsManifest
      ? 'This Docker uses the containerd image store, so the image ID is the manifest digest. With the older store the ID is the config digest. Packed (download) and unpacked differ, and this store reports a Size that counts both the compressed blobs and the unpacked files. Always say which number you mean.'
      : 'This Docker uses the classic image store, so the image ID is the config digest. Packed (download) and unpacked (disk) differ: always say which one you mean.',
  );

  const layersSmall = img.layers.filter((l) => l.size < 1024).length;
  setFact('c2.p1.layer_count', img.layers.length);
  setFact('c2.p1.history_count', img.history.length);
  setFact('c2.p1.history_empty_count', emptyCount);
  setFact('c2.p1.layers_under_1kb_count', layersSmall);
  setFact('c2.p1.manifest_bytes', entries.get(`blobs/sha256/${img.manifestDigest.slice(7)}`).length);
  setFact('c2.p1.config_bytes', entries.get(`blobs/sha256/${img.configDigest.slice(7)}`).length);
  setFact('c2.p1.packed_mb', mb(packed, 2));
  setFact('c2.p1.unpacked_mb', mb(unpacked, 2));
  setFact('c2.p1.docker_size_field_mb', mb(inspect.Size, 2));
  setFact('c2.p1.base_layer_packed_mb', mb(img.layers[0].size, 2));
  setFact('c2.p1.bad_digests_count', bad.length);
  setFact('c2.p1.bad_diffids_count', badDiff.length);
  setFact('c2.p1.tampered_detected_count', caught.length);
  setFact('c2.p1.diffids_match_inspect', sameLayers);
  setFact('c2.p1.image_id_is_manifest_digest', idIsManifest);

  removeImages(TAG);
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c2.p1.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}  and  docker image rm ${TAG}`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone, including the image tag.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Packed size of each layer',
        unit: 'KB',
        bars: img.layers.map((l, i) => ({ label: `layer ${i}`, value: round(l.size / 1000, 1) })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c2.p1');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  removeImages(TAG);
  cleanup(N);
  rmTree(work);
}
