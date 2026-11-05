// Challenge 2, part 2 test.
// Run: node --test challenges/challenge-2-take-an-image-apart/part-2-the-deleted-secret/test.mjs
// It builds the leaky image and YOUR Dockerfile.fixed, and checks both with recover.mjs and with an
// independent reader. It fails until recover.mjs is written and Dockerfile.fixed no longer leaks.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, leftovers, safeArgs } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { openImage, layerFiles } from '../lib/image.mjs';
import { workDir, tmp, rmTree, build, save, removeImages } from '../lib/common.mjs';
import { makeContext, SECRET } from './context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LEAKY = 'dkr-c2-test-p2-leaky:1';
const FIXED = 'dkr-c2-test-p2-fixed:1';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const work = tmp('p2t');
const leakyTar = join(work, 'leaky.tar');
const fixedTar = join(work, 'fixed.tar');
let mine;
let fixedBuild;

// An independent scan, not the learner's code.
const scan = (tar) =>
  openImage(tar).layers.flatMap((l) => layerFiles(l).filter((f) => f.type === 'file' && f.data.includes(SECRET)).map((f) => ({ layerIndex: l.index, path: f.name })));
const whiteoutsOf = (tar) =>
  openImage(tar).layers.flatMap((l) => layerFiles(l).filter((f) => f.name.split('/').pop().startsWith('.wh.')).map((f) => ({ layerIndex: l.index, name: f.name })));

before(async () => {
  if (dockerDown) return;
  const ctx = makeContext(join(work, 'context'));
  const b1 = build({ tag: LEAKY, dockerfile: join(here, 'Dockerfile.leaky'), context: ctx });
  assert.equal(b1.code, 0, b1.out);
  save(LEAKY, leakyTar);
  fixedBuild = build({ tag: FIXED, dockerfile: join(workDir(here), 'Dockerfile.fixed'), context: ctx });
  if (fixedBuild.code === 0) save(FIXED, fixedTar);
  mine = await import(pathToFileURL(join(workDir(here), 'recover.mjs')).href);
});

after(() => {
  if (!dockerDown) removeImages(LEAKY, FIXED);
  rmTree(work);
});

test('findInLayers finds the secret in the layer that copied it, even though a later layer deleted it', { skip: dockerDown }, () => {
  const truth = scan(leakyTar);
  assert.equal(truth.length, 1, 'setup: the leaky image should hold the secret in exactly one layer');
  const hits = mine.findInLayers(leakyTar, SECRET);
  assert.equal(hits.length, 1, 'findInLayers should report one hit');
  assert.equal(hits[0].layerIndex, truth[0].layerIndex);
  assert.equal(hits[0].path, truth[0].path);
  assert.match(hits[0].layerDigest, /^sha256:[0-9a-f]{64}$/);
});

test('findInLayers finds nothing when the needle is not there', { skip: dockerDown }, () => {
  assert.deepEqual(mine.findInLayers(leakyTar, 'this text is not in the image 8f3a'), []);
});

test('recoverFile returns the bytes of the deleted file', { skip: dockerDown }, () => {
  const [hit] = scan(leakyTar);
  const bytes = mine.recoverFile(leakyTar, hit.layerIndex, hit.path);
  assert.ok(Buffer.isBuffer(bytes), 'recoverFile must return a Buffer');
  assert.ok(bytes.toString('utf8').includes(SECRET), 'the recovered file must contain the secret');
});

test('whiteouts lists what the later layer deleted', { skip: dockerDown }, () => {
  const truth = whiteoutsOf(leakyTar);
  const got = mine.whiteouts(leakyTar);
  assert.equal(got.length, truth.length, 'the leaky image deletes two files');
  const deleted = got.map((g) => g.deleted).sort();
  assert.deepEqual(deleted, ['app/prod.env', 'app/seed.bin']);
  for (const g of got) assert.equal(g.layerIndex, truth[0].layerIndex);
});

test('Dockerfile.fixed builds', { skip: dockerDown }, () => {
  assert.equal(fixedBuild.code, 0, fixedBuild.out.split('\n').slice(-12).join('\n'));
});

test('the fixed image has the secret in no layer', { skip: dockerDown }, () => {
  const hits = scan(fixedTar);
  assert.deepEqual(hits, [], `the secret is still in layer ${hits[0]?.layerIndex} (${hits[0]?.path}). Do not copy it into the image you ship.`);
});

test('the fixed image deletes nothing in a later layer', { skip: dockerDown }, () => {
  assert.deepEqual(whiteoutsOf(fixedTar), [], 'a whiteout means a file was shipped and then hidden. Never put it in a shipped layer at all.');
  const seed = openImage(fixedTar).layers.some((l) => layerFiles(l).some((f) => f.name.endsWith('seed.bin')));
  assert.equal(seed, false, 'seed.bin is only needed to build, it should not be in the final image');
});

test('the fixed image still runs the same', { skip: dockerDown }, () => {
  const r = run(['run', '--rm', ...safeArgs(2, 'p2test'), FIXED]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'config checked: ok\nservice ready');
});

test('run.mjs saved the facts from the last run', () => {
  const hint = 'Run: node challenges/challenge-2-take-an-image-apart/part-2-the-deleted-secret/run.mjs';
  assert.equal(getFact('c2.p2.secret_recovered'), true, hint);
  assert.equal(getFact('c2.p2.deleted_file_visible_in_container'), false, hint);
  assert.equal(getFact('c2.p2.fixed_secret_hits_count'), 0, hint);
  assert.equal(getFact('c2.p2.fixed_whiteout_count'), 0, hint);
  assert.equal(getFact('c2.p2.fixed_runs_same'), true, hint);
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
