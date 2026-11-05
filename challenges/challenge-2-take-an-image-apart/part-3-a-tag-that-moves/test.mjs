// Challenge 2, part 3 test.
// Run: node --test challenges/challenge-2-take-an-image-apart/part-3-a-tag-that-moves/test.mjs
// It runs YOUR functions from resolve.mjs against a tiny fake registry made in this file,
// then checks the facts of the last run.mjs run. It fails until the three functions are written.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { workDir } from '../lib/common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

const manifest = JSON.stringify({
  schemaVersion: 2,
  mediaType: 'application/vnd.oci.image.manifest.v1+json',
  layers: [
    { digest: 'sha256:aaaa', size: 10 },
    { digest: 'sha256:bbbb', size: 20 },
  ],
});
const manifestDigest = sha(manifest);
const index = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ digest: manifestDigest, size: manifest.length }] });
const indexDigest = sha(index);

let server;
let base;
let mine;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url, accept: req.headers.accept ?? '' });
    const accept = req.headers.accept ?? '';
    const send = (status, type, body, digest) => {
      res.writeHead(status, { 'content-type': type, ...(digest ? { 'docker-content-digest': digest } : {}) });
      res.end(body);
    };
    const m = req.url.match(/^\/v2\/app\/manifests\/(.+)$/);
    if (m) {
      // Like the real registry: an unknown tag is a 404, and a client that does not accept the type gets nothing useful.
      if (!accept.includes('application/vnd.oci.image.manifest.v1+json') || !accept.includes('application/vnd.oci.image.index.v1+json')) {
        return send(404, 'application/json', '{"errors":[{"code":"MANIFEST_UNKNOWN"}]}');
      }
      if (m[1] === 'stable') return send(200, 'application/vnd.oci.image.index.v1+json', index, indexDigest);
      if (m[1] === manifestDigest || m[1] === 'plain') return send(200, 'application/vnd.oci.image.manifest.v1+json', manifest, manifestDigest);
      return send(404, 'application/json', '{"errors":[{"code":"MANIFEST_UNKNOWN"}]}');
    }
    if (req.url === '/v2/app/tags/list') return send(200, 'application/json', JSON.stringify({ name: 'app', tags: ['stable', '2.0.0', '1.0.0'] }));
    return send(404, 'text/plain', 'no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  mine = await import(pathToFileURL(join(workDir(here), 'resolve.mjs')).href);
});

after(() => server?.close());

test('digestOf returns the digest the registry reports for a tag', async () => {
  assert.equal(await mine.digestOf(base, 'app', 'stable'), indexDigest);
  assert.equal(await mine.digestOf(base, 'app', 'plain'), manifestDigest);
});

test('digestOf sends an Accept header that names the OCI and Docker manifest types', async () => {
  seen.length = 0;
  await mine.digestOf(base, 'app', 'stable');
  const accept = seen.at(-1).accept;
  for (const type of ['application/vnd.oci.image.index.v1+json', 'application/vnd.oci.image.manifest.v1+json']) {
    assert.ok(accept.includes(type), `the Accept header must list ${type}`);
  }
});

test('digestOf throws, naming the status, when the tag does not exist', async () => {
  await assert.rejects(() => mine.digestOf(base, 'app', 'nope'), /404/);
});

test('listTags returns the tags sorted', async () => {
  assert.deepEqual(await mine.listTags(base, 'app'), ['1.0.0', '2.0.0', 'stable']);
});

test('layersOf returns the layers of a manifest', async () => {
  assert.deepEqual(await mine.layersOf(base, 'app', 'plain'), [
    { digest: 'sha256:aaaa', size: 10 },
    { digest: 'sha256:bbbb', size: 20 },
  ]);
});

test('layersOf follows an index to its first manifest', async () => {
  assert.deepEqual(await mine.layersOf(base, 'app', 'stable'), [
    { digest: 'sha256:aaaa', size: 10 },
    { digest: 'sha256:bbbb', size: 20 },
  ]);
});

test('run.mjs saved the facts from the last run', () => {
  const hint = 'Run: node challenges/challenge-2-take-an-image-apart/part-3-a-tag-that-moves/run.mjs';
  assert.equal(getFact('c2.p3.tag_moved'), true, `The tag should have moved. ${hint}`);
  assert.equal(getFact('c2.p3.version_tag_stayed'), true, `The 1.0.0 tag should not have moved. ${hint}`);
  assert.equal(getFact('c2.p3.same_tag_two_versions'), true, `Server A and B should run different versions. ${hint}`);
  assert.equal(getFact('c2.p3.server_c_by_digest_version'), getFact('c2.p3.server_a_version'), `Server C, deployed by digest, should run what A runs. ${hint}`);
  assert.ok(getFact('c2.p3.update_download_bytes') < getFact('c2.p3.full_pull_bytes') / 100, `An update should download a tiny part of a full pull. ${hint}`);
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
