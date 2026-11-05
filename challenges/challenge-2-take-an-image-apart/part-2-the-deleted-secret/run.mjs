// Challenge 2, part 2: a deleted secret is still in the image.
// Run: node challenges/challenge-2-take-an-image-apart/part-2-the-deleted-secret/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It builds an image that copies a made-up secret in and deletes it again, saves it, and uses your
// functions in recover.mjs to find the secret in the layers. Then it builds your Dockerfile.fixed
// and checks that the secret is gone from every layer.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, assertDocker, cleanup, leftovers, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { openImage, layerFiles, layerBytes } from '../lib/image.mjs';
import { N, docker, workDir, tmp, rmTree, build, save, removeImages, mb } from '../lib/common.mjs';
import { makeContext, SECRET, SEED_BYTES } from './context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 2, part 2: a deleted secret is still in the image');

const LEAKY = 'dkr-c2-leaky:1';
const FIXED = 'dkr-c2-fixed:1';
const work = tmp('p2');

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const runImage = (tag, cmd) => run(['run', '--rm', ...safeArgs(N, 'p2'), tag, ...cmd]);

try {
  cleanup(N);
  const { findInLayers, recoverFile, whiteouts } = await import(pathToFileURL(join(workDir(here), 'recover.mjs')).href);
  const ctx = makeContext(join(work, 'context'));

  // Step 1: build the leaky image and use it. It looks clean.
  const b1 = build({ tag: LEAKY, dockerfile: join(here, 'Dockerfile.leaky'), context: ctx });
  if (b1.code !== 0) throw new Error(`build of Dockerfile.leaky failed:\n${b1.out.split('\n').slice(-12).join('\n')}`);
  const out = runImage(LEAKY, []).stdout.trim().replace(/\n/g, ' | ');
  const ls = runImage(LEAKY, ['ls', '/app']).stdout.trim().replace(/\n/g, ' ');
  const cat = runImage(LEAKY, ['cat', '/app/prod.env']);
  rec.step(
    `docker build -f Dockerfile.leaky -t ${LEAKY} context/ && docker run --rm ${LEAKY} ; ls /app ; cat /app/prod.env`,
    [`runs:       ${out}`, `ls /app:    ${ls}`, `cat prod.env: ${(cat.stderr || cat.stdout).trim()} (exit ${cat.code})`].join('\n'),
    'From the outside the secret is gone: the file is not in /app and cat cannot find it. The Dockerfile deleted it on purpose.',
  );

  // Step 2: save it and look in the layers.
  const leakyTar = join(work, 'leaky.tar');
  save(LEAKY, leakyTar);
  const img = openImage(leakyTar);
  const rows = img.layers.map((l) => `  layer ${l.index}  ${String(l.size).padStart(8)} bytes packed  ${String(layerBytes(l)).padStart(8)} bytes unpacked  ${img.history.filter((h) => !h.empty_layer)[l.index]?.created_by?.replace(/\s+/g, ' ').replace(/ # buildkit$/, '').slice(0, 60) ?? ''}`);
  const hits = findInLayers(leakyTar, SECRET);
  const dels = whiteouts(leakyTar);
  rec.step(
    'docker save -o leaky.tar dkr-c2-leaky:1   then   findInLayers(leaky.tar, <the secret>)   and   whiteouts(leaky.tar)',
    [
      `${img.layers.length} layers:`,
      ...rows,
      `findInLayers: ${hits.map((h) => `layer ${h.layerIndex} file ${h.path}`).join('; ') || 'nothing'}`,
      `whiteouts:    ${dels.map((d) => `layer ${d.layerIndex} hides ${d.deleted}`).join('; ') || 'nothing'}`,
    ].join('\n'),
    'The step that copied the file made a layer that still holds it. The step that ran rm made a new, tiny layer with a whiteout note. The old layer was never touched.',
  );
  if (!hits.length) throw new Error('findInLayers found nothing in the leaky image');

  // Step 3: get the secret back.
  const first = hits[0];
  const recovered = recoverFile(leakyTar, first.layerIndex, first.path).toString('utf8').trim().split('\n').pop();
  const seedLayer = findSeedLayer(img);
  const hidden = dels.flatMap((d) => (d.deleted === 'app/seed.bin' ? [layerBytes(img.layers[seedLayer])] : []));
  rec.step(
    `recoverFile(leaky.tar, ${first.layerIndex}, "${first.path}")`,
    [`recovered: ${recovered}`, `the 3 MB file seed.bin was deleted too, and is still shipped: layer ${seedLayer} is ${mb(img.layers[seedLayer].size, 2)} MB packed`].join('\n'),
    'Anyone who can pull the image can do this with tar. The secret is recovered in full, and the deleted data still costs download size.',
  );

  // Step 4: your fix.
  const b2 = build({ tag: FIXED, dockerfile: join(workDir(here), 'Dockerfile.fixed'), context: ctx });
  if (b2.code !== 0) throw new Error(`build of Dockerfile.fixed failed:\n${b2.out.split('\n').slice(-12).join('\n')}`);
  const fixedOut = runImage(FIXED, []).stdout.trim().replace(/\n/g, ' | ');
  const fixedTar = join(work, 'fixed.tar');
  save(FIXED, fixedTar);
  const fixedImg = openImage(fixedTar);
  const fixedHits = findInLayers(fixedTar, SECRET);
  const fixedDels = whiteouts(fixedTar);
  const fixedSeed = fixedImg.layers.some((l) => layerFiles(l).some((f) => f.name.endsWith('seed.bin')));
  const sizeLeaky = img.layers.reduce((s, l) => s + layerBytes(l), 0);
  const sizeFixed = fixedImg.layers.reduce((s, l) => s + layerBytes(l), 0);
  const packedLeaky = img.layers.reduce((s, l) => s + l.size, 0);
  const packedFixed = fixedImg.layers.reduce((s, l) => s + l.size, 0);
  rec.step(
    `docker build -f Dockerfile.fixed -t ${FIXED} context/ && docker run --rm ${FIXED}   then   findInLayers(fixed.tar, <the secret>)`,
    [
      `runs:         ${fixedOut}`,
      `${fixedImg.layers.length} layers, findInLayers: ${fixedHits.map((h) => `layer ${h.layerIndex} ${h.path}`).join('; ') || 'nothing'}`,
      `whiteouts: ${fixedDels.length}   seed.bin shipped: ${fixedSeed}`,
      `packed:   leaky ${mb(packedLeaky, 2)} MB, fixed ${mb(packedFixed, 2)} MB`,
      `unpacked: leaky ${mb(sizeLeaky, 2)} MB, fixed ${mb(sizeFixed, 2)} MB`,
    ].join('\n'),
    'Same behaviour, no secret in any layer, nothing deleted, and the image is smaller by the bytes that were only ever needed to build.',
  );

  setFact('c2.p2.leaky_layer_count', img.layers.length);
  setFact('c2.p2.secret_layer_index', first.layerIndex);
  setFact('c2.p2.secret_found_layers_count', hits.length);
  setFact('c2.p2.whiteout_layer_index', dels.find((d) => d.deleted === 'app/prod.env')?.layerIndex ?? -1);
  setFact('c2.p2.whiteout_count', dels.length);
  setFact('c2.p2.secret_recovered', recovered.includes(SECRET));
  setFact('c2.p2.deleted_file_visible_in_container', cat.code === 0);
  setFact('c2.p2.seed_layer_packed_mb', mb(img.layers[seedLayer].size, 2));
  setFact('c2.p2.seed_deleted_still_shipped_bytes', hidden[0] ?? 0);
  setFact('c2.p2.seed_file_bytes', SEED_BYTES);
  setFact('c2.p2.leaky_packed_mb', mb(packedLeaky, 2));
  setFact('c2.p2.leaky_unpacked_mb', mb(sizeLeaky, 2));
  setFact('c2.p2.fixed_packed_mb', mb(packedFixed, 2));
  setFact('c2.p2.fixed_unpacked_mb', mb(sizeFixed, 2));
  setFact('c2.p2.fixed_secret_hits_count', fixedHits.length);
  setFact('c2.p2.fixed_whiteout_count', fixedDels.length);
  setFact('c2.p2.fixed_runs_same', fixedOut === out);

  removeImages(LEAKY, FIXED);
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c2.p2.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}  and  docker image rm ${LEAKY} ${FIXED}`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone, including both image tags.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Packed size: the deleted file is still shipped',
        unit: 'MB',
        bars: [
          { label: 'leaky image', value: mb(packedLeaky, 2) },
          { label: 'fixed image', value: mb(packedFixed, 2) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c2.p2');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  removeImages(LEAKY, FIXED);
  cleanup(N);
  rmTree(work);
}

// The layer that holds seed.bin: the one that has the biggest file.
function findSeedLayer(img) {
  let best = 0;
  let size = -1;
  for (const l of img.layers) {
    const s = layerFiles(l).filter((f) => f.type === 'file' && f.name.endsWith('seed.bin')).reduce((a, f) => a + f.size, 0);
    if (s > size) {
      size = s;
      best = l.index;
    }
  }
  return best;
}
