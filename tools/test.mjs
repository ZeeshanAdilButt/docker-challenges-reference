// Tests for tools/make_starter.mjs. Run: node --test tools/test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'make_starter.mjs');

function put(root, rel, text = 'x') {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function starter(source, target) {
  return spawnSync(process.execPath, [script, target], { encoding: 'utf8', env: { ...process.env, DKR_SOURCE_ROOT: source } });
}

test('make_starter leaves out reference folders, facts.json, .git and node_modules', () => {
  const base = mkdtempSync(join(tmpdir(), 'dkr-starter-'));
  const source = join(base, 'src');
  const target = join(base, 'out');
  try {
    put(source, 'README.md', 'hello');
    put(source, 'facts.json', '{"c1.p1.a_mb": 1}');
    put(source, '.git/config');
    put(source, 'node_modules/x/index.js');
    put(source, 'toolkit/docker.js');
    put(source, 'challenges/challenge-1-a/part-1-b/README.md');
    put(source, 'challenges/challenge-1-a/part-1-b/test.mjs');
    put(source, 'challenges/challenge-1-a/part-1-b/reference/Dockerfile', 'FROM scratch');
    put(source, 'challenges/challenge-2-a/part-1-b/reference/deep/solution.txt');
    put(source, 'challenges/challenge-2-a/part-1-b/results.md');

    const r = starter(source, target);
    assert.equal(r.status, 0, r.stderr);

    assert.equal(readFileSync(join(target, 'README.md'), 'utf8'), 'hello');
    assert.ok(existsSync(join(target, 'toolkit/docker.js')));
    assert.ok(existsSync(join(target, 'challenges/challenge-1-a/part-1-b/test.mjs')));
    assert.ok(existsSync(join(target, 'challenges/challenge-2-a/part-1-b/results.md')));

    assert.ok(!existsSync(join(target, 'facts.json')), 'facts.json must not be copied');
    assert.ok(!existsSync(join(target, '.git')), '.git must not be copied');
    assert.ok(!existsSync(join(target, 'node_modules')), 'node_modules must not be copied');
    assert.ok(!existsSync(join(target, 'challenges/challenge-1-a/part-1-b/reference')), 'reference must not be copied');
    assert.ok(!existsSync(join(target, 'challenges/challenge-2-a/part-1-b/reference')), 'nested reference must not be copied');
    assert.ok(existsSync(join(source, 'challenges/challenge-1-a/part-1-b/reference/Dockerfile')), 'the source is untouched');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('make_starter refuses a target that is not empty, or inside the source', () => {
  const base = mkdtempSync(join(tmpdir(), 'dkr-starter-'));
  const source = join(base, 'src');
  try {
    put(source, 'README.md');
    put(base, 'full/file.txt');
    assert.equal(starter(source, join(base, 'full')).status, 2);
    assert.equal(starter(source, join(source, 'inside')).status, 2);
    assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 2);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
