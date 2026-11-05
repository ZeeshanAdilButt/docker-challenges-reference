// Challenge 6, part 2 test.
// Run: node --test challenges/challenge-6-registry-and-tags/part-2-call-the-api/test.mjs
// It fails until every function of client.mjs returns what the registry really holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-6-registry-and-tags/part-2-call-the-api/run.mjs';
const f = (what) => getFact(`c6.p2.${what}`);

test('run.mjs saved its facts', () => {
  assert.notEqual(f('ping_ok'), undefined, `No facts yet. ${hint}`);
});

for (const [key, label] of [
  ['ping', 'ping() returns status 200 and the API version header'],
  ['catalog', 'catalog() lists the repository'],
  ['tags', 'tags() lists the tags (the field is called "tags")'],
  ['digest', 'digestOf() returns the Docker-Content-Digest header of a HEAD request'],
  ['manifest', 'manifest() returns the digest and the layers'],
  ['packed_bytes', 'packedBytes() adds the config and the layers'],
]) {
  test(label, () => {
    assert.equal(f(`${key}_ok`), true, `${label}: wrong answer. Run run.mjs and read the FAIL line for it.`);
  });
}

test('the delete is accepted and the tag is gone afterwards', () => {
  assert.equal(f('delete_status'), 202, `DELETE answered ${f('delete_status')}; expected 202.`);
  assert.equal(f('deleted_tag_gone'), true);
});

test('a pull is a few HTTP requests: one ping, manifests, then blobs', () => {
  assert.ok(f('pull_ping_requests') >= 1);
  assert.ok(f('pull_manifest_requests') >= 1);
  assert.ok(f('pull_blob_requests') >= 2);
});

test('deleting does not free the space, garbage collection does', () => {
  assert.ok(f('storage_kb_after_gc') < f('storage_kb_after_delete'), 'Garbage collection freed nothing. A delete by tag removes only the tag. Look up the digest of the tag first, then delete the manifest by that digest.');
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(6), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
