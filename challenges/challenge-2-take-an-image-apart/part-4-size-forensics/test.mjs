// Challenge 2, part 4 test.
// Run: node --test challenges/challenge-2-take-an-image-apart/part-4-size-forensics/test.mjs
// It builds Dockerfile.fat and YOUR Dockerfile.slim, runs your forensics.mjs on the fat image,
// and checks the slim image. It fails until forensics.mjs is written and the slim image is slim.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, leftovers, safeArgs } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { openImage, layerFiles, layerBytes } from '../lib/image.mjs';
import { workDir, tmp, rmTree, build, save, removeImages, docker } from '../lib/common.mjs';
import { makeContext, GIT_PACK_BYTES, VIDEO_BYTES, CACHE_BYTES } from './context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FAT = 'dkr-c2-test-p4-fat:1';
const SLIM = 'dkr-c2-test-p4-slim:1';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const work = tmp('p4t');
const fatTar = join(work, 'fat.tar');
const slimTar = join(work, 'slim.tar');
let mine;
let slimBuild;
let fatOut;

// An independent count of wasted bytes, not the learner's code.
function truthWasted(tar) {
  const visible = new Map();
  let wasted = 0;
  for (const layer of openImage(tar).layers) {
    const files = layerFiles(layer);
    for (const f of files) {
      const parts = f.name.split('/');
      const last = parts.pop();
      if (!last.startsWith('.wh.') || last === '.wh..wh..opq') continue;
      const target = [...parts, last.slice(4)].join('/');
      for (const [p, b] of [...visible]) if (p === target || p.startsWith(`${target}/`)) (wasted += b), visible.delete(p);
    }
    for (const f of files) {
      if (f.type !== 'file' || f.name.split('/').pop().startsWith('.wh.')) continue;
      if (visible.has(f.name)) wasted += visible.get(f.name);
      visible.set(f.name, f.size);
    }
  }
  return wasted;
}

before(async () => {
  if (dockerDown) return;
  const ctx = makeContext(join(work, 'context'));
  const b1 = build({ tag: FAT, dockerfile: join(here, 'Dockerfile.fat'), context: ctx });
  assert.equal(b1.code, 0, b1.out);
  save(FAT, fatTar);
  fatOut = run(['run', '--rm', ...safeArgs(2, 'p4test'), FAT]).stdout.trim();
  slimBuild = build({ tag: SLIM, dockerfile: join(workDir(here), 'Dockerfile.slim'), context: ctx });
  if (slimBuild.code === 0) save(SLIM, slimTar);
  mine = await import(pathToFileURL(join(workDir(here), 'forensics.mjs')).href);
});

after(() => {
  if (!dockerDown) removeImages(FAT, SLIM);
  rmTree(work);
});

test('layerReport lists every layer with packed and unpacked bytes and the step that made it', { skip: dockerDown }, () => {
  const truth = openImage(fatTar).layers;
  const rows = mine.layerReport(fatTar);
  assert.equal(rows.length, truth.length);
  rows.forEach((r, i) => {
    assert.equal(r.index, i);
    assert.equal(r.packedBytes, truth[i].size, `layer ${i}: packedBytes is the blob size`);
    assert.equal(r.unpackedBytes, layerBytes(truth[i]), `layer ${i}: unpackedBytes is the size of the files in it`);
    assert.equal(typeof r.createdBy, 'string');
  });
  assert.match(rows.find((r) => r.unpackedBytes === Math.max(...rows.map((x) => x.unpackedBytes))).createdBy, /COPY|chown|ADD/, 'the biggest layer comes from a COPY or the chown after it');
  assert.ok(rows.some((r) => /chown/.test(r.createdBy)), 'one row should be the chown step: match history to layers, skipping empty_layer steps');
});

test('biggestLayers returns the biggest first', { skip: dockerDown }, () => {
  const all = mine.layerReport(fatTar);
  const top = mine.biggestLayers(fatTar, 2);
  assert.equal(top.length, 2);
  const sorted = [...all].sort((a, b) => b.unpackedBytes - a.unpackedBytes);
  assert.deepEqual(top.map((t) => t.index), sorted.slice(0, 2).map((t) => t.index));
});

test('wastedBytes finds the bytes that chown and rm made useless', { skip: dockerDown }, () => {
  const truth = truthWasted(fatTar);
  const got = mine.wastedBytes(fatTar);
  assert.equal(got.wasted, truth, 'total wasted bytes');
  const deleted = got.items.filter((i) => i.reason === 'deleted').reduce((s, i) => s + i.bytes, 0);
  assert.equal(deleted, CACHE_BYTES, 'the 20 MB file written and removed in two steps');
  const replaced = got.items.filter((i) => i.reason === 'replaced').reduce((s, i) => s + i.bytes, 0);
  assert.ok(replaced >= GIT_PACK_BYTES + VIDEO_BYTES, 'chown -R copied every file again, so the first copies are wasted');
  for (const item of got.items) assert.ok(['replaced', 'deleted'].includes(item.reason) && Number.isInteger(item.layerIndex) && item.path, 'item shape');
});

test('Dockerfile.slim builds', { skip: dockerDown }, () => {
  assert.equal(slimBuild.code, 0, slimBuild.out.split('\n').slice(-12).join('\n'));
});

test('the slim image prints the same two lines and runs as user 1000', { skip: dockerDown }, () => {
  const r = run(['run', '--rm', ...safeArgs(2, 'p4test'), SLIM]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), fatOut, 'the output changed');
  const id = run(['run', '--rm', ...safeArgs(2, 'p4test'), SLIM, 'id', '-u']);
  assert.equal(id.stdout.trim(), '1000', 'keep USER 1000');
});

test('the slim image has no .git folder and no test fixtures', { skip: dockerDown }, () => {
  const ls = run(['run', '--rm', ...safeArgs(2, 'p4test'), SLIM, 'ls', '-A', '/app']).stdout.split('\n');
  assert.ok(!ls.includes('.git'), '.git is history, the running app does not need it. Keep it out of the build context.');
  assert.ok(!ls.includes('fixtures'), 'fixtures are test data. Keep them out of the build context.');
});

test('the slim image is less than a quarter of the fat image', { skip: dockerDown }, () => {
  const fat = Number(docker(['image', 'inspect', FAT, '--format', '{{.Size}}']));
  const slim = Number(docker(['image', 'inspect', SLIM, '--format', '{{.Size}}']));
  assert.ok(slim < fat / 4, `slim is ${slim} bytes and fat is ${fat}: slim must be under a quarter of fat`);
});

test('the slim image wastes nothing', { skip: dockerDown }, () => {
  assert.equal(truthWasted(slimTar), 0, 'something was shipped and then replaced or deleted. Copy with the right owner at once, and do not write temporary files into a layer.');
});

test('run.mjs saved the facts from the last run', () => {
  const hint = 'Run: node challenges/challenge-2-take-an-image-apart/part-4-size-forensics/run.mjs';
  assert.ok(getFact('c2.p4.fat_unpacked_mb') > 50, `c2.p4.fat_unpacked_mb is missing. ${hint}`);
  assert.ok(getFact('c2.p4.fat_wasted_mb') > 30, `The fat image should waste about 50 MB. ${hint}`);
  assert.equal(getFact('c2.p4.slim_wasted_mb'), 0, hint);
  assert.equal(getFact('c2.p4.slim_runs_same'), true, hint);
  assert.ok(getFact('c2.p4.slim_saved_percent') > 75, hint);
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(2), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.match(readFileSync(join(here, 'chart.svg'), 'utf8'), /role="img"/);
});
