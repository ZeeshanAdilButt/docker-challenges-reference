// Challenge 12, part 2 test.
// Run: node --test challenges/challenge-12-scan-harden-sign/part-2-hunt-the-secret/test.mjs
// It builds app/ (about a minute the first time), saves the image and looks in EVERY layer and in the image
// configuration for four fake secrets. With DKR_TARGET=reference it tests reference/app instead.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, cleanup, leftovers } from '../../../toolkit/docker.js';
import { targetDir } from '../lib.mjs';
import { VECTORS, build, hunt, check, userOf, removeImage } from './leaks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';
const TAG = 'dkr-c12-leaky:test';
const dir = join(targetDir(here), 'app');

let state;
const prepare = async () => {
  if (!state) {
    const b = build(dir, TAG);
    state = { build: b, hunt: b.ok ? await hunt(TAG) : null };
  }
  return state;
};
after(() => removeImage(TAG));

test('the image builds with BuildKit secrets', { skip: dockerDown }, async () => {
  const s = await prepare();
  assert.ok(s.build.ok, `docker build failed: ${s.build.output.slice(0, 400)}`);
});

for (const v of VECTORS) {
  test(`no secret from ${v.title}`, { skip: dockerDown }, async () => {
    const s = await prepare();
    assert.ok(s.hunt, 'the image did not build');
    assert.deepEqual(s.hunt.found[v.key], [], `The secret from "${v.title}" is still in the image: ${s.hunt.found[v.key].join(', ')}. Fix: ${v.fix}.`);
  });
}

test('the app still works: the API key arrives at run time, and the leaked files are gone', { skip: dockerDown }, async () => {
  const s = await prepare();
  assert.ok(s.build.ok, 'the image did not build');
  const c = check(TAG, 'leak-check');
  assert.equal(c.api_key_configured, true, `the app did not get the key at run time: ${JSON.stringify(c)}`);
  assert.equal(c.env_file_in_image, false, '/app/.env is still in the image');
  assert.equal(c.deploy_key_in_image, false, '/app/deploy.key is still in the image');
});

test('the app still runs as a normal user', { skip: dockerDown }, async () => {
  const s = await prepare();
  assert.ok(s.build.ok, 'the image did not build');
  assert.ok(!['', 'root', '0'].includes(userOf(TAG)), 'keep USER node');
});

test('nothing with the challenge label is left in Docker', { skip: dockerDown }, () => {
  cleanup(12);
  assert.deepEqual(leftovers(12), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});
