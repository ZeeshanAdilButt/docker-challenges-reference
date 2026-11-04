// Challenge @@N@@, part @@M@@: @@TITLE@@.
// Run: node challenges/@@CHALLENGE_DIR@@/@@PART_DIR@@/run.mjs
// Add --record to also write results.md and chart.svg next to this file.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, leftovers, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round, timed } from '../../../toolkit/stats.js';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge @@N@@, part @@M@@: @@TITLE@@');

const CHALLENGE = @@N@@;
const IMAGE = 'alpine:3.23'; // pin every image to a version tag

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

try {
  cleanup(CHALLENGE); // leftovers from an earlier run

  // TODO: replace this example with the real experiment.
  // Every container uses safeArgs() so it is named, labelled and capped.
  const args = ['run', '--rm', ...safeArgs(CHALLENGE, 'example'), IMAGE, 'echo', 'hello'];
  const times = [];
  let out = '';
  for (let i = 0; i < 3; i++) {
    const t = await timed(() => run(args));
    if (t.value.code !== 0) throw new Error(`docker run failed: ${t.value.stderr.trim()}`);
    times.push(t.ms);
    if (i === 0) out = t.value.stdout;
  }
  const seconds = round(median(times) / 1000, 2);
  rec.step(`docker ${args.join(' ')}`, out, `One run took ${seconds} s (median of 3).`);

  // Name facts c<N>.p<M>.<what>_<unit>.
  setFact('c@@N@@.p@@M@@.example_s', seconds);

  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(join(here, 'chart.svg'), barsSvg({ title: 'Example timing', unit: 's', bars: [{ label: 'One run', value: seconds }] }));
    console.log('\nWrote results.md and chart.svg');
  }
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
