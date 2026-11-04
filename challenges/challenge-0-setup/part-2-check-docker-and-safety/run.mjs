// Challenge 0, part 2: check Docker and learn the safety rules.
// Run: node challenges/challenge-0-setup/part-2-check-docker-and-safety/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It pulls a tiny image, runs a container with safety limits, makes a network, a volume and
// a container, then shows that cleanup removes only what carries the label dkr.challenge=0.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { run, assertDocker, cleanup, leftovers, label, name, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round, timed } from '../../../toolkit/stats.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 0, part 2: check Docker and the safety rules');

const IMAGE = 'alpine:3.23';
const CHALLENGE = 0;
const DECOY = name(CHALLENGE, 'unlabelled-demo'); // a volume WITHOUT the label: cleanup must not touch it

// Show an argument list the way you would type it.
const show = (args) => `docker ${args.map((a) => (/[\s{}"]/.test(a) ? `"${a}"` : a)).join(' ')}`;

function docker(args, opts) {
  const r = run(args, opts);
  if (r.code !== 0) throw new Error(`${show(args)} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

try {
  cleanup(CHALLENGE); // leftovers from an earlier run, if any
  run(['volume', 'rm', DECOY]);

  // Step 1: pull a tiny image and time it.
  const pull = await timed(() => run(['pull', IMAGE]));
  if (pull.value.code !== 0) throw new Error(`docker pull failed: ${pull.value.stderr.trim()}`);
  const cached = /up to date/i.test(pull.value.stdout);
  const pullS = round(pull.ms / 1000, 1);
  rec.step(
    `docker pull ${IMAGE}`,
    pull.value.stdout.trim().split(/\r?\n/).slice(-3).join('\n'),
    cached ? `The image was already here, so the check took ${pullS} s. A first download takes longer.` : `The first download took ${pullS} s.`,
  );

  // Step 2: how big is it?
  const bytes = Number(docker(['image', 'inspect', IMAGE, '--format', '{{.Size}}']).trim());
  const imageMb = round(bytes / 1e6, 1);
  rec.step(`docker image inspect ${IMAGE} --format "{{.Size}}"`, String(bytes), `${bytes} bytes is ${imageMb} MB. This is the whole download for this challenge.`);

  // Step 3: run one container with the safety limits, three times for timing.
  const hello = ['--rm', ...safeArgs(CHALLENGE, 'hello'), IMAGE, 'sh', '-c', 'echo hello from a limited container; cat /sys/fs/cgroup/memory.max; cat /sys/fs/cgroup/pids.max'];
  const runs = [];
  let out = '';
  for (let i = 0; i < 3; i++) {
    const t = await timed(() => run(['run', ...hello]));
    if (t.value.code !== 0) throw new Error(`docker run failed: ${t.value.stderr.trim()}`);
    runs.push(t.ms);
    if (i === 0) out = t.value.stdout;
  }
  const [, memLine, pidsLine] = out.trim().split(/\r?\n/);
  const runS = round(median(runs) / 1000, 2);
  rec.step(show(['run', ...hello]), out, `Docker holds this container to ${Number(memLine) / 1048576} MB of memory and ${pidsLine} processes. One run took ${runS} s (median of 3).`);

  // Step 4: make a network, a volume and a container, all labelled. Also make one volume with no label.
  const net = name(CHALLENGE, 'net');
  const vol = name(CHALLENGE, 'data');
  const one = (args, note) => rec.step(show(args), docker(args).trim().slice(0, 64), note);
  one(['network', 'create', ...label(CHALLENGE), net], 'A network with our label. Docker prints its id.');
  one(['volume', 'create', ...label(CHALLENGE), vol], 'A volume with our label. Docker prints its name.');
  one(['run', '-d', ...safeArgs(CHALLENGE, 'sleeper'), '--network', net, '-v', `${vol}:/data`, IMAGE, 'sleep', '300'], 'A container with our label, the safety limits, on our network and with our volume.');
  one(['volume', 'create', DECOY], 'A volume with NO label. It is our test: cleanup must leave it alone.');

  // Step 5: list by label.
  const byLabel = (kind, format) => [...kind, '--filter', `label=dkr.challenge=${CHALLENGE}`, '--format', format];
  const ps = byLabel(['ps', '-a'], 'table {{.Names}}\\t{{.Status}}');
  rec.step(show(ps), docker(ps).trim(), 'The label finds our container.');
  const nl = byLabel(['network', 'ls'], 'table {{.Name}}\\t{{.Driver}}');
  rec.step(show(nl), docker(nl).trim(), 'It finds our network. Docker adds its own networks, but they have no label.');
  const vl = byLabel(['volume', 'ls'], 'table {{.Name}}\\t{{.Driver}}');
  rec.step(show(vl), docker(vl).trim(), 'It finds our volume. The volume with no label is not in this list.');

  // Step 6: cleanup.
  const cleanScript = join(root, 'toolkit', 'cleanup.mjs');
  const cl = await timed(() => spawnSync(process.execPath, [cleanScript, String(CHALLENGE)], { encoding: 'utf8' }));
  const counts = (cl.value.stdout.match(/: (\d+) containers, (\d+) networks, (\d+) volumes/) || []).slice(1).map(Number);
  const removedCount = counts.reduce((a, b) => a + b, 0);
  const cleanS = round(cl.ms / 1000, 1);
  rec.step(`node toolkit/cleanup.mjs ${CHALLENGE}`, cl.value.stdout, `Cleanup removed ${removedCount} objects in ${cleanS} s. It used only the label.`);

  // Step 7: prove nothing is left, and that the unlabelled volume survived.
  const left = leftovers(CHALLENGE);
  const leftCount = left.containers + left.networks + left.volumes;
  const psq = ['ps', '-a', '-q', '--filter', `label=dkr.challenge=${CHALLENGE}`];
  rec.step(show(psq), docker(psq).trim() || '(no container ids)', `Nothing with the label is left (${leftCount} objects in total).`);
  const sv = ['volume', 'ls', '--filter', `name=${DECOY}`, '--format', 'table {{.Name}}\\t{{.Driver}}'];
  const survivor = docker(sv).trim();
  const kept = survivor.split(/\r?\n/).slice(1).filter(Boolean).length;
  rec.step(show(sv), survivor, `The volume with no label is still here (${kept}). Cleanup did not touch it.`);

  // Remove the test volume by its full name. This is the only thing we remove by hand.
  docker(['volume', 'rm', DECOY]);
  rec.step(show(['volume', 'rm', DECOY]), DECOY, 'You remove your own test volume by its full name. No wildcards, no prune.');

  setFact('c0.p2.pull_s', pullS);
  setFact('c0.p2.pull_cached', cached);
  setFact('c0.p2.image_mb', imageMb);
  setFact('c0.p2.run_s', runS);
  setFact('c0.p2.memory_max_bytes', Number(memLine));
  setFact('c0.p2.pids_max', Number(pidsLine));
  setFact('c0.p2.cleanup_s', cleanS);
  setFact('c0.p2.cleanup_removed_count', removedCount);
  setFact('c0.p2.leftover_count', leftCount);
  setFact('c0.p2.unlabelled_kept_count', kept);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'How long each step takes',
        unit: 's',
        bars: [
          { label: cached ? 'Pull check (cached)' : 'Pull alpine', value: pullS },
          { label: 'Run one container', value: runS },
          { label: 'Cleanup by label', value: cleanS },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c0.p2');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  run(['volume', 'rm', DECOY]);
}
