// Challenge 2, part 4: size forensics. Why is this image big, and what can go?
// Run: node challenges/challenge-2-take-an-image-apart/part-4-size-forensics/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It builds Dockerfile.fat and your Dockerfile.slim from the same build context, saves the fat image,
// and uses your functions in forensics.mjs to say which layers are big and how many bytes are wasted.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, assertDocker, cleanup, leftovers, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { openImage, layerBytes } from '../lib/image.mjs';
import { N, docker, workDir, tmp, rmTree, build, save, removeImages, mb } from '../lib/common.mjs';
import { makeContext } from './context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 2, part 4: size forensics');

const FAT = 'dkr-c2-fat:1';
const SLIM = 'dkr-c2-slim:1';
const work = tmp('p4');

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const runImage = (tag, cmd = []) => run(['run', '--rm', ...safeArgs(N, 'p4'), tag, ...cmd]);

try {
  cleanup(N);
  const { layerReport, biggestLayers, wastedBytes } = await import(pathToFileURL(join(workDir(here), 'forensics.mjs')).href);
  const ctx = makeContext(join(work, 'context'));

  // Step 1: build the fat image.
  const b1 = build({ tag: FAT, dockerfile: join(here, 'Dockerfile.fat'), context: ctx });
  if (b1.code !== 0) throw new Error(`build of Dockerfile.fat failed:\n${b1.out.split('\n').slice(-12).join('\n')}`);
  const fatOut = runImage(FAT).stdout.trim().replace(/\n/g, ' | ');
  const fatTar = join(work, 'fat.tar');
  save(FAT, fatTar);
  const fatUnpacked = openImage(fatTar).layers.reduce((s, l) => s + layerBytes(l), 0);
  const fatSizeField = Number(docker(['image', 'inspect', FAT, '--format', '{{.Size}}']));
  const report = layerReport(fatTar);
  const packed = report.reduce((s, r) => s + r.packedBytes, 0);
  const rows = report.map((r) => `  layer ${r.index}  ${String(mb(r.packedBytes, 2)).padStart(6)} MB packed  ${String(mb(r.unpackedBytes, 2)).padStart(6)} MB unpacked  ${r.createdBy.slice(0, 55)}`);
  rec.step(
    `docker build -f Dockerfile.fat -t ${FAT} context/ && docker save -o fat.tar ${FAT}   then   layerReport(fat.tar)`,
    [`runs: ${fatOut}`, `${report.length} layers, ${mb(packed, 1)} MB packed, ${mb(fatUnpacked, 1)} MB unpacked:`, ...rows].join('\n'),
    'The app is a few hundred bytes of text. The image is dozens of megabytes. Every layer is listed with both sizes: packed is the download, unpacked is the disk.',
  );

  // Step 2: the biggest layers and the waste.
  const top = biggestLayers(fatTar, 3);
  const waste = wastedBytes(fatTar);
  const byReason = (reason) => waste.items.filter((i) => i.reason === reason).reduce((s, i) => s + i.bytes, 0);
  const replacedMb = mb(byReason('replaced'), 1);
  const deletedMb = mb(byReason('deleted'), 1);
  const biggestItems = [...waste.items].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((i) => `  layer ${i.layerIndex} ${i.reason.padEnd(8)} ${String(mb(i.bytes, 1)).padStart(5)} MB  ${i.path}`);
  rec.step(
    'biggestLayers(fat.tar, 3)   and   wastedBytes(fat.tar)',
    [
      `biggest: ${top.map((t) => `layer ${t.index} (${mb(t.unpackedBytes, 1)} MB)`).join(', ')}`,
      `wasted:  ${mb(waste.wasted, 1)} MB of ${mb(fatUnpacked, 1)} MB  (${round((waste.wasted / fatUnpacked) * 100, 0)} percent)`,
      `  replaced in a later layer: ${replacedMb} MB   deleted in a later layer: ${deletedMb} MB`,
      ...biggestItems,
    ].join('\n'),
    'Wasted bytes are shipped and pulled but can never be seen. Two causes: chown -R after COPY copies every file again, and rm in a later step only hides a file.',
  );

  // Step 3: your slim image.
  const b2 = build({ tag: SLIM, dockerfile: join(workDir(here), 'Dockerfile.slim'), context: ctx });
  if (b2.code !== 0) throw new Error(`build of Dockerfile.slim failed:\n${b2.out.split('\n').slice(-12).join('\n')}`);
  const slimOut = runImage(SLIM).stdout.trim().replace(/\n/g, ' | ');
  const ids = runImage(SLIM, ['sh', '-c', 'id -u; ls -A /app']).stdout.trim().split('\n');
  const slimTar = join(work, 'slim.tar');
  save(SLIM, slimTar);
  const slimImg = openImage(slimTar);
  const slimUnpacked = slimImg.layers.reduce((s, l) => s + layerBytes(l), 0);
  const slimPacked = slimImg.layers.reduce((s, l) => s + l.size, 0);
  const slimWaste = wastedBytes(slimTar);
  const savedPct = round((1 - slimUnpacked / fatUnpacked) * 100, 0);
  rec.step(
    `docker build -f Dockerfile.slim -t ${SLIM} context/   then   docker run --rm ${SLIM}   and   wastedBytes(slim.tar)`,
    [
      `runs: ${slimOut}`,
      `user ${ids[0]}, files in /app: ${ids.slice(1).join(' ')}`,
      `packed:   fat ${mb(packed, 1)} MB, slim ${mb(slimPacked, 1)} MB`,
      `unpacked: fat ${mb(fatUnpacked, 1)} MB, slim ${mb(slimUnpacked, 1)} MB  (${savedPct} percent smaller)`,
      `wasted in slim: ${mb(slimWaste.wasted, 2)} MB`,
    ].join('\n'),
    'Same output, same user, a fraction of the size. The big wins came from what was never sent (.dockerignore), not from compressing.',
  );

  const chownLayer = report.find((r) => /chown/.test(r.createdBy));
  setFact('c2.p4.fat_layer_count', report.length);
  setFact('c2.p4.fat_packed_mb', mb(packed, 1));
  setFact('c2.p4.fat_unpacked_mb', mb(fatUnpacked, 1));
  setFact('c2.p4.fat_docker_size_field_mb', mb(fatSizeField, 1));
  setFact('c2.p4.fat_biggest_layer_mb', mb(top[0].unpackedBytes, 1));
  setFact('c2.p4.fat_chown_layer_mb', chownLayer ? mb(chownLayer.unpackedBytes, 1) : 0);
  setFact('c2.p4.fat_wasted_mb', mb(waste.wasted, 1));
  setFact('c2.p4.fat_wasted_replaced_mb', replacedMb);
  setFact('c2.p4.fat_wasted_deleted_mb', deletedMb);
  setFact('c2.p4.fat_wasted_percent', round((waste.wasted / fatUnpacked) * 100, 0));
  setFact('c2.p4.slim_packed_mb', mb(slimPacked, 1));
  setFact('c2.p4.slim_unpacked_mb', mb(slimUnpacked, 1));
  setFact('c2.p4.slim_wasted_mb', mb(slimWaste.wasted, 2));
  setFact('c2.p4.slim_saved_percent', savedPct);
  setFact('c2.p4.slim_runs_same', slimOut === fatOut);
  setFact('c2.p4.slim_user_id', Number(ids[0]));
  setFact('c2.p4.slim_has_git', ids.includes('.git'));

  removeImages(FAT, SLIM);
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c2.p4.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}  and  docker image rm ${FAT} ${SLIM}`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone, including both image tags.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Unpacked size of each layer of the fat image, and the slim image',
        unit: 'MB',
        bars: [
          ...report.map((r) => ({ label: `layer ${r.index}: ${r.createdBy.replace(/^(RUN|COPY|ADD|WORKDIR) /, '$1 ').split(' ').slice(0, 2).join(' ')}`, value: mb(r.unpackedBytes, 1) })),
          { label: 'slim image (total)', value: mb(slimUnpacked, 1) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c2.p4');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  removeImages(FAT, SLIM);
  cleanup(N);
  rmTree(work);
}
