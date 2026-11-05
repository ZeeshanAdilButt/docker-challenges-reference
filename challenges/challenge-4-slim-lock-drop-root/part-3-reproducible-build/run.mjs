// Challenge 4, part 3: make the build reproducible.
// Run: node challenges/challenge-4-slim-lock-drop-root/part-3-reproducible-build/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).

import { copyFileSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { CHALLENGE, clip, ociExport, pick, removeImages, saveFacts, short } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 4, part 3: a reproducible build');
const facts = {};

/** build-flags.txt: comments dropped, split on spaces. Returns { output, flags }. */
function readFlags(file) {
  const tokens = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .flatMap((l) => l.split(/\s+/));
  const flags = [];
  let output = 'type=oci';
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--output' || tokens[i] === '-o') output = tokens[++i];
    else flags.push(tokens[i]);
  }
  if (!/^type=oci(,|$)/.test(output)) throw new Error('build-flags.txt must have an --output line that starts with type=oci');
  // --build-arg KEY=VALUE pairs go through buildArgs so ociExport can print them
  const buildArgs = {};
  const rest = [];
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--build-arg') {
      const [k, ...v] = flags[++i].split('=');
      buildArgs[k] = v.join('=');
    } else rest.push(flags[i]);
  }
  return { output, buildArgs, flags: rest };
}

const FIXED = { output: 'type=oci,rewrite-timestamp=true', buildArgs: { SOURCE_DATE_EPOCH: '1700000000' }, flags: [] };

function compare(a, b) {
  const n = Math.max(a.layers.length, b.layers.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const step = (a.steps[i] || b.steps[i] || '').replace(/^\/bin\/sh -c #\(nop\)\s*/, '').replace(/\s+/g, ' ').slice(0, 52);
    rows.push({ same: a.layers[i] === b.layers[i], step });
  }
  return rows;
}

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let ctx;
try {
  cleanup(CHALLENGE);
  const dockerfile = pick(here, 'Dockerfile');
  const { output, buildArgs, flags } = readFlags(pick(here, 'build-flags.txt'));
  const text = readFileSync(dockerfile, 'utf8');
  const fromLine = text.split(/\r?\n/).find((l) => /^\s*FROM\s/i.test(l)) || '';
  facts['c4.p3.base_pinned'] = /@sha256:[0-9a-f]{64}/.test(fromLine);

  // Source folder: the sample service. We rebuild from this same folder twice.
  ctx = mkdtempSync(join(tmpdir(), 'dkr-c4-p3-'));
  for (const f of ['package.json', 'server.mjs']) copyFileSync(join(root, 'daftar-api', f), join(ctx, f));

  // Step 1 and 2: build, then build again after the files get a new modified time (what a fresh git checkout does).
  const one = ociExport({ dockerfile, context: ctx, buildArgs, flags, output, noCache: true });
  if (!one.ok) throw new Error(`first build failed:\n${clip(one.out, 12)}`);
  rec.step(`docker buildx build --no-cache --output ${output},dest=a.tar .`, `image digest ${one.digest}\nlayers ${one.layers.length}`, 'First build.');

  const later = new Date(Date.now() + 90_000);
  for (const f of ['package.json', 'server.mjs']) utimesSync(join(ctx, f), later, later);
  await new Promise((r) => setTimeout(r, 1100)); // so a build clock shows a different second
  const two = ociExport({ dockerfile, context: ctx, buildArgs, flags, output, noCache: true });
  if (!two.ok) throw new Error(`second build failed:\n${clip(two.out, 12)}`);
  rec.step(`touch package.json server.mjs && docker buildx build --no-cache --output ${output},dest=b.tar .`, `image digest ${two.digest}\nlayers ${two.layers.length}`, 'Second build: same content, files touched, a second later.');

  // Step 3: compare
  const rows = compare(one, two);
  const differing = rows.filter((r) => !r.same).length;
  const lines = [
    `image digest   ${one.digest === two.digest ? 'SAME' : 'DIFFERENT'}   ${short(one.digest)} ${short(two.digest)}`,
    `config         ${one.config === two.config ? 'same' : 'different'}`,
    ...rows.map((r, i) => `layer ${i + 1}        ${r.same ? 'same     ' : 'DIFFERENT'}   ${r.step}`),
  ];
  rec.step('compare the two images (digest, config, layers)', lines.join('\n'), one.digest === two.digest ? 'Same files in, same image out.' : `${differing} layer(s) and the config differ. Same source, two different images.`);
  facts['c4.p3.digest_equal'] = one.digest === two.digest;
  facts['c4.p3.config_equal'] = one.config === two.config;
  facts['c4.p3.layers_total'] = one.layers.length;
  facts['c4.p3.layers_differ'] = differing;

  // Step 4: a base tag that moves. Uses a local base so it needs no network. Fixed flags, so only the base can change the result.
  run(['tag', 'node:24-alpine', 'dkr-c4-base:moving']);
  run(['tag', 'node:24-alpine', 'dkr-c4-base:v1']);
  const v1 = run(['image', 'inspect', '--format', '{{.Id}}', 'dkr-c4-base:v1']).stdout.trim();
  const drift = (base) => ociExport({ dockerfile: join(here, 'Dockerfile.drift'), context: ctx, buildArgs: { ...FIXED.buildArgs, BASE: base }, output: FIXED.output, noCache: true });
  const tag1 = drift('dkr-c4-base:moving');
  const pin1 = drift(`dkr-c4-base@${v1}`);
  if (!tag1.ok || !pin1.ok) throw new Error(`drift build failed:\n${clip(tag1.ok ? pin1.out : tag1.out, 12)}`);
  // Someone publishes a patched base under the same tag.
  const patch = run(['build', '-t', 'dkr-c4-base:moving', '--label', 'dkr.challenge=4', '-'], { input: 'FROM node:24-alpine\nRUN echo patch-2 > /etc/base-patch\n' });
  if (patch.code !== 0) throw new Error(`could not build the patched base: ${patch.stderr.trim()}`);
  const tag2 = drift('dkr-c4-base:moving');
  const pin2 = drift(`dkr-c4-base@${v1}`);
  if (!tag2.ok || !pin2.ok) throw new Error(`drift rebuild failed:\n${clip(tag2.ok ? pin2.out : tag2.out, 12)}`);
  facts['c4.p3.tag_drift_changed'] = tag1.digest !== tag2.digest;
  facts['c4.p3.pin_drift_changed'] = pin1.digest !== pin2.digest;
  rec.step(
    'FROM dkr-c4-base:moving   versus   FROM dkr-c4-base@sha256:...   (build, move the tag, build again)',
    [
      `FROM tag     before ${short(tag1.digest)}   after ${short(tag2.digest)}   ${tag1.digest === tag2.digest ? 'same' : 'DIFFERENT'}`,
      `FROM digest  before ${short(pin1.digest)}   after ${short(pin2.digest)}   ${pin1.digest === pin2.digest ? 'same' : 'DIFFERENT'}`,
    ].join('\n'),
    'Same Dockerfile, same source, same flags. Only the base under the tag changed. The digest pin did not move.',
  );

  facts['c4.p3.reproducible'] = facts['c4.p3.digest_equal'] && facts['c4.p3.base_pinned'];
  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Layers that differ between two builds of the same source',
        unit: 'layers',
        bars: [
          { label: 'Your Dockerfile', value: differing },
          { label: 'Tag moved, FROM tag', value: tag1.digest === tag2.digest ? 0 : 1 },
          { label: 'Tag moved, FROM digest', value: pin1.digest === pin2.digest ? 0 : 1 },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nImage digest ${one.digest === two.digest ? 'is the same' : 'changed'} between the two builds; ${differing} of ${rows.length} layers differ.`);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 14)}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  run(['image', 'rm', 'dkr-c4-base:moving', 'dkr-c4-base:v1']);
  removeImages();
  if (ctx) rmSync(ctx, { recursive: true, force: true });
}
