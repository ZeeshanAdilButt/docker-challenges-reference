// Tests for the toolkit. Run: node --test toolkit/test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run, runAsync, waitFor, label, name, safeArgs, cleanup, leftovers, assertDocker } from './docker.js';
import { barsSvg } from './bars.js';
import { setFact, getFact, factsPath } from './facts.js';
import { median, round } from './stats.js';
import { checkSetup, formatTable } from './check-setup.mjs';

const IMAGE = 'alpine:3.23';

test('label and name build the right strings', () => {
  assert.deepEqual(label(3), ['--label', 'dkr.challenge=3']);
  assert.equal(name(3, 'web'), 'dkr-c3-web');
  assert.throws(() => label('x'));
  assert.throws(() => label(-1));
});

test('safeArgs caps memory, processes and disk, and has no privileged flag', () => {
  const a = safeArgs(0, 'x').join(' ');
  assert.match(a, /--memory 64m/);
  assert.match(a, /--pids-limit 50/);
  assert.match(a, /--tmpfs \/tmp:rw,size=16m/);
  assert.match(a, /max-size=1m/);
  assert.doesNotMatch(a, /privileged|docker\.sock/);
});

test('median and round', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(round(1.2345, 2), 1.23);
});

test('waitFor returns the value, and times out with a clear message', async () => {
  let n = 0;
  const v = await waitFor(() => ++n >= 3 && 'done', { intervalMs: 5, timeoutMs: 2000 });
  assert.equal(v, 'done');
  await assert.rejects(waitFor(() => false, { intervalMs: 5, timeoutMs: 50, what: 'nothing' }), /Timed out after 50 ms waiting for nothing/);
});

test('barsSvg is accessible, uses no hex colours and escapes text', () => {
  const svg = barsSvg({ title: 'Sizes <test>', unit: 'MB', bars: [{ label: 'a & b', value: 12 }, { label: 'c', value: 3.456 }] });
  assert.match(svg, /^<svg /);
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title id="t">Sizes &lt;test&gt;<\/title>/);
  assert.match(svg, /<desc id="d">a &amp; b: 12 MB\. c: 3\.46 MB<\/desc>/);
  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(svg, /currentColor/);
  assert.throws(() => barsSvg({ title: 't', bars: [] }));
  assert.throws(() => barsSvg({ title: 't', bars: [{ label: 'x', value: -1 }] }));
});

test('facts: write, read, sort and reject bad names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dkr-facts-'));
  const old = process.env.DKR_FACTS_PATH;
  process.env.DKR_FACTS_PATH = join(dir, 'facts.json');
  try {
    assert.equal(getFact('c1.p1.x_mb'), undefined);
    setFact('c2.p1.b_mb', 2);
    setFact('c10.p1.a_s', 1.5);
    setFact('c1.p1.a_mb', 7);
    assert.equal(getFact('c1.p1.a_mb'), 7);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(factsPath(), 'utf8'))), ['c1.p1.a_mb', 'c2.p1.b_mb', 'c10.p1.a_s']);
    assert.deepEqual(readdirSync(dir), ['facts.json'], 'no temp file is left behind');
    assert.throws(() => setFact('bad name', 1), /Bad fact name/);
    assert.throws(() => setFact('c1.p1.x_mb', NaN));
  } finally {
    if (old === undefined) delete process.env.DKR_FACTS_PATH;
    else process.env.DKR_FACTS_PATH = old;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkSetup returns rows and facts', () => {
  const { rows, facts, ok } = checkSetup();
  assert.ok(rows.length >= 5);
  assert.ok(facts.node_major >= 22);
  assert.equal(typeof ok, 'boolean');
  assert.match(formatTable(rows), /Node\.js/);
});

test('assertDocker returns the engine version', { skip: run(['version']).code !== 0 && 'Docker is not running' }, () => {
  assert.match(assertDocker(), /^\d+\.\d+/);
  return runAsync(['version', '--format', '{{.Server.Version}}']).then((r) => assert.equal(r.code, 0));
});

test('cleanup removes only objects labelled for that challenge', { skip: run(['version']).code !== 0 && 'Docker is not running' }, () => {
  // Names start with dkr-c0-tk so they are clearly ours. We remove the two we keep by hand.
  const other = name(0, 'tk-other-label'); // labelled for challenge 90, must survive cleanup(0)
  const plain = name(0, 'tk-no-label'); // no label at all, must survive cleanup(0)
  const plainVolume = name(0, 'tk-plain-vol');
  try {
    cleanup(0);
    assert.equal(run(['create', '--name', name(0, 'tk-mine'), ...label(0), IMAGE, 'true']).code, 0);
    assert.equal(run(['create', '--name', other, ...label(90), IMAGE, 'true']).code, 0);
    assert.equal(run(['create', '--name', plain, IMAGE, 'true']).code, 0);
    assert.equal(run(['network', 'create', ...label(0), name(0, 'tk-net')]).code, 0);
    assert.equal(run(['volume', 'create', ...label(0), name(0, 'tk-vol')]).code, 0);
    assert.equal(run(['volume', 'create', plainVolume]).code, 0);

    assert.deepEqual(leftovers(0), { containers: 1, networks: 1, volumes: 1 });
    const removed = cleanup(0);
    assert.equal(removed.containers.length, 1);
    assert.equal(removed.networks.length, 1);
    assert.equal(removed.volumes.length, 1);
    assert.deepEqual(leftovers(0), { containers: 0, networks: 0, volumes: 0 });

    assert.equal(run(['inspect', other]).code, 0, 'container with another label is still there');
    assert.equal(run(['inspect', plain]).code, 0, 'container with no label is still there');
    assert.equal(run(['volume', 'inspect', plainVolume]).code, 0, 'volume with no label is still there');
  } finally {
    run(['rm', '-f', other, plain]);
    run(['volume', 'rm', '-f', plainVolume]);
    cleanup(0);
  }
});
