// Challenge 2, part 1 test.
// Run: node --test challenges/challenge-2-take-an-image-apart/part-1-read-the-manifest/test.mjs
// It builds a small image, saves it, and runs YOUR functions from readimage.mjs on it.
// It fails until the three functions are written. That is on purpose.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { readTarFile, openImage, sha256 } from '../lib/image.mjs';
import { workDir, tmp, rmTree, build, save, removeImages, docker } from '../lib/common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TAG = 'dkr-c2-test-p1:1';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const work = tmp('p1t');
let entries;
let truth; // what the independent reader in lib/image.mjs says
let mine; // the learner's module

before(async () => {
  if (dockerDown) return;
  const b = build({ tag: TAG, dockerfile: join(here, 'Dockerfile'), context: here });
  assert.equal(b.code, 0, b.out);
  const tarFile = join(work, 'image.tar');
  save(TAG, tarFile);
  entries = readTarFile(tarFile);
  truth = openImage(entries);
  mine = await import(pathToFileURL(join(workDir(here), 'readimage.mjs')).href);
});

after(() => {
  if (!dockerDown) removeImages(TAG);
  rmTree(work);
});

test('readImage finds the manifest, the config and the platform', { skip: dockerDown }, () => {
  const img = mine.readImage(entries);
  assert.equal(img.manifestDigest, truth.manifestDigest, 'manifestDigest: index.json -> manifests[0].digest');
  assert.equal(img.configDigest, truth.configDigest, 'configDigest: manifest.config.digest');
  assert.equal(img.os, 'linux');
  assert.equal(img.architecture, truth.config.architecture);
});

test('readImage lists the layers in order with digest, size, media type and diffId', { skip: dockerDown }, () => {
  const img = mine.readImage(entries);
  assert.equal(img.layers.length, truth.layers.length, 'wrong number of layers');
  img.layers.forEach((l, i) => {
    assert.equal(l.digest, truth.layers[i].digest, `layer ${i}: digest`);
    assert.equal(l.size, truth.layers[i].blob.length, `layer ${i}: size must be the size of the blob in bytes`);
    assert.equal(l.diffId, truth.config.rootfs.diff_ids[i], `layer ${i}: diffId comes from config.rootfs.diff_ids at the same position`);
    assert.match(l.mediaType, /layer/, `layer ${i}: mediaType`);
  });
});

test('the layer diffIds match what Docker reports', { skip: dockerDown }, () => {
  const img = mine.readImage(entries);
  const docker_ = JSON.parse(docker(['image', 'inspect', TAG]))[0];
  assert.deepEqual(img.layers.map((l) => l.diffId), docker_.RootFS.Layers);
});

test('readImage lists the history, and the steps without a layer are marked', { skip: dockerDown }, () => {
  const img = mine.readImage(entries);
  assert.equal(img.history.length, truth.history.length, 'one history entry per Dockerfile step');
  const withLayer = img.history.filter((h) => !h.emptyLayer).length;
  assert.equal(withLayer, img.layers.length, 'steps that made a layer must equal the number of layers');
  assert.ok(img.history.some((h) => h.emptyLayer && /ENV|LABEL|CMD/.test(h.createdBy)), 'ENV, LABEL and CMD make no layer: emptyLayer must be true for them');
});

test('findBadDigests is empty for a good image and names the blob that was changed', { skip: dockerDown }, () => {
  assert.deepEqual(mine.findBadDigests(entries), []);
  const tampered = new Map(entries);
  const victim = truth.layers[0];
  const path = `blobs/sha256/${victim.digest.slice(7)}`;
  const copy = Buffer.from(tampered.get(path));
  copy[10] ^= 0xff;
  tampered.set(path, copy);
  assert.deepEqual(mine.findBadDigests(tampered), [victim.digest]);
  assert.notEqual(sha256(copy), victim.digest);
});

test('findBadDiffIds is empty for a good image and catches a layer that does not match its diffId', { skip: dockerDown }, () => {
  assert.deepEqual(mine.findBadDiffIds(entries), []);
  const tampered = new Map(entries);
  const config = JSON.parse(truth && entries.get(`blobs/sha256/${truth.configDigest.slice(7)}`).toString('utf8'));
  config.rootfs.diff_ids[1] = `sha256:${'0'.repeat(64)}`;
  const changed = Buffer.from(JSON.stringify(config));
  // keep the structure consistent: new config blob, manifest points to it
  const manifest = JSON.parse(entries.get(`blobs/sha256/${truth.manifestDigest.slice(7)}`).toString('utf8'));
  manifest.config = { ...manifest.config, digest: sha256(changed), size: changed.length };
  const newManifest = Buffer.from(JSON.stringify(manifest));
  const index = JSON.parse(entries.get('index.json').toString('utf8'));
  index.manifests[0] = { ...index.manifests[0], digest: sha256(newManifest), size: newManifest.length };
  tampered.set(`blobs/sha256/${sha256(changed).slice(7)}`, changed);
  tampered.set(`blobs/sha256/${sha256(newManifest).slice(7)}`, newManifest);
  tampered.set('index.json', Buffer.from(JSON.stringify(index)));
  assert.deepEqual(mine.findBadDiffIds(tampered), [`sha256:${'0'.repeat(64)}`]);
});

test('run.mjs saved the facts from the last run', () => {
  const hint = 'Run: node challenges/challenge-2-take-an-image-apart/part-1-read-the-manifest/run.mjs';
  assert.ok(getFact('c2.p1.layer_count') > 1, `c2.p1.layer_count is missing. ${hint}`);
  assert.ok(getFact('c2.p1.packed_mb') > 0 && getFact('c2.p1.unpacked_mb') > getFact('c2.p1.packed_mb'), `Packed must be smaller than unpacked. ${hint}`);
  assert.equal(getFact('c2.p1.bad_digests_count'), 0, hint);
  assert.equal(getFact('c2.p1.tampered_detected_count'), 1, hint);
  assert.equal(getFact('c2.p1.diffids_match_inspect'), true, hint);
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
