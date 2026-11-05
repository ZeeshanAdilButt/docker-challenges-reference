// Challenge 10, part 1: hit the memory, process and open-file limits on purpose.
// Run:  node challenges/challenge-10-fill-the-box/part-1-hit-the-limits/run.mjs
// Add --record to write results.md and chart.svg. Add --reference to use reference/limits.json.
//
// Every container below has a memory cap of 64 MB, a process cap and a small tmpfs.
// A runaway job can only fill its own cage, never your computer.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, NODE_IMAGE, ALPINE_IMAGE, MEMORY, show, docker, runWorker, verdict, gradeLimits, targetDir, removeByName } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 10, part 1: hit the limits on purpose');

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const limits = JSON.parse(readFileSync(join(targetDir(here), 'limits.json'), 'utf8'));
const NONE = { heap_mb: 0, pids: 50, nofile: 0 }; // the cage only: no tuning of your own
const f = (k, v) => setFact(`c10.p1.${k}`, v);
const cpuBurn =
  'const t=Date.now();let loops=0,n=0;while(Date.now()-t<2000){for(let i=0;i<100000;i++)n+=i%7;loops++}' +
  'console.log(JSON.stringify({loops,stat:require("fs").readFileSync("/sys/fs/cgroup/cpu.stat","utf8")}))';

try {
  cleanup(CHALLENGE);
  const pull = run(['pull', '--quiet', NODE_IMAGE]);
  if (pull.code !== 0) throw new Error(`docker pull ${NODE_IMAGE} failed: ${pull.stderr.trim()}`);
  console.log(`Using limits from ${join(targetDir(here), 'limits.json')}: ${JSON.stringify(limits)}`);

  // Step 1: what does a new container get by default? Measured, never assumed.
  const probeArgs = ['run', '--rm', ...safeArgs(CHALLENGE, 'defaults'), ALPINE_IMAGE, 'sh', '-c', 'echo nofile=$(ulimit -n); cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max'];
  removeByName('defaults');
  const probe = docker(probeArgs);
  const nofileDefault = Number(/nofile=(\d+)/.exec(probe)[1]);
  rec.step(show(probeArgs), probe, `The memory and process caps are there only because we asked. The open-file limit is ${nofileDefault} without us asking. The release notes imply 1024, so this number is measured, not assumed.`);
  f('default_nofile', nofileDefault);

  // Step 2: four runaway jobs with no tuning at all (only the 64 MB cage).
  const b = {};
  for (const work of ['heap-leak', 'buffer-leak', 'fork', 'fds']) b[work] = runWorker(work, NONE, { tag: `base-${work}` });
  rec.step(`WORK=heap-leak, no tuning (${NODE_IMAGE}, ${MEMORY} cap)`, `last line: {"held_mb":${b['heap-leak'].heldMb}}\nresult: ${verdict(b['heap-leak'])}`, `A JavaScript leak reached ${b['heap-leak'].heldMb} MB of data and the kernel killed the whole container. Node's own heap limit is far above 64 MB, so V8 never gets the chance to stop first.`);
  rec.step('WORK=buffer-leak, no tuning', `last line: {"held_mb":${b['buffer-leak'].heldMb}}\nresult: ${verdict(b['buffer-leak'])}`, 'Buffers live outside the JavaScript heap. The result is the same kill.');
  rec.step('WORK=fork, no tuning (--pids-limit 50)', `{"children":${b.fork.children},"error":"${b.fork.forkError}"}`, `Docker stopped the fork loop at ${b.fork.children} helper processes. Node itself already uses about seven threads, and every thread counts against the limit.`);
  rec.step('WORK=fds, no tuning', `{"files":${b.fds.files},"error":${JSON.stringify(b.fds.fileError)}}`, `No limit was hit: the loop stopped at its own safety cap of 20000. With a limit of ${nofileDefault} a leak like this runs until memory or the kernel gives up.`);
  f('base_heap_held_mb', b['heap-leak'].heldMb);
  f('base_heap_exit_code', b['heap-leak'].exit);
  f('base_heap_oomkilled', b['heap-leak'].oomKilled);
  f('base_buffer_held_mb', b['buffer-leak'].heldMb);
  f('base_buffer_exit_code', b['buffer-leak'].exit);
  f('base_fork_children', b.fork.children);
  f('base_fds_opened', b.fds.files);

  // Step 3: the same jobs with the limits from limits.json, and the real job.
  const m = {};
  for (const work of ['heap-leak', 'fork', 'fds', 'legit']) m[work] = runWorker(work, limits, { tag: `mine-${work}` });
  rec.step(
    `limits.json = ${JSON.stringify(limits)}`,
    `heap-leak: ${verdict(m['heap-leak'])} at ${m['heap-leak'].heldMb} MB\nfork: ${m.fork.children} helpers, error ${m.fork.forkError}\nfds: ${m.fds.files} files, error ${m.fds.fileError}\nlegit job: ${m.legit.legitOk ? 'ok' : 'BROKEN'}`,
    'The same jobs again, now with your limits. The real job must still work.',
  );
  f('mine_heap_exit_code', m['heap-leak'].exit);
  f('mine_heap_oomkilled', m['heap-leak'].oomKilled);
  f('mine_heap_held_mb', m['heap-leak'].heldMb);
  f('mine_heap_abort', m['heap-leak'].heapAbort);
  f('mine_fork_children', m.fork.children);
  f('mine_fds_opened', m.fds.files);
  f('mine_legit_ok', m.legit.legitOk);

  // Step 4: a heap cap does not protect against memory outside the heap.
  const capped = runWorker('buffer-leak', { ...NONE, heap_mb: limits.heap_mb || 28 }, { tag: 'buffer-capped' });
  rec.step(`WORK=buffer-leak with --max-old-space-size=${limits.heap_mb || 28}`, `last line: {"held_mb":${capped.heldMb}}\nresult: ${verdict(capped)}`, 'The heap cap did nothing here. Memory outside the heap is invisible to it, so the container limit still has to leave room for it.');
  f('buffer_capped_exit_code', capped.exit);
  f('buffer_capped_oomkilled', capped.oomKilled);

  // Step 5: CPU. Too little CPU is not a kill, it is a slow-down.
  const burn = (cpus) => {
    const what = `cpu-${cpus || 'free'}`;
    removeByName(what);
    const a = ['run', ...safeArgs(CHALLENGE, what), ...(cpus ? ['--cpus', String(cpus)] : []), NODE_IMAGE, 'node', '-e', cpuBurn];
    const r = JSON.parse(docker(a).trim().split(/\r?\n/).pop());
    removeByName(what);
    return { loops: r.loops, throttled: Number(/nr_throttled (\d+)/.exec(r.stat)[1]), usec: Number(/throttled_usec (\d+)/.exec(r.stat)[1]) };
  };
  const free = [burn(0), burn(0), burn(0)];
  const slow = [burn(0.25), burn(0.25), burn(0.25)];
  const freeLoops = median(free.map((x) => x.loops));
  const slowLoops = median(slow.map((x) => x.loops));
  const ratio = round(slowLoops / freeLoops, 2);
  const lastSlow = slow[2];
  rec.step(
    'docker run --cpus 0.25 ... node -e "<spin for 2 seconds>"  (3 runs each, median)',
    `no cpu limit:   ${freeLoops} loops in 2 s\n--cpus 0.25:    ${slowLoops} loops in 2 s  (${ratio} of full speed)\ncpu.stat nr_throttled=${lastSlow.throttled} throttled_usec=${lastSlow.usec}`,
    'A CPU limit throttles. The process is paused between slices and nothing is killed. That is the opposite of a memory limit.',
  );
  f('cpu_free_loops', freeLoops);
  f('cpu_quarter_loops', slowLoops);
  f('cpu_quarter_ratio', ratio);
  f('cpu_quarter_throttled_periods', lastSlow.throttled);

  // Step 6: the verdict on limits.json.
  const checks = gradeLimits(limits);
  const lines = checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.text}`);
  rec.step('check limits.json against the four goals', lines.join('\n'), checks.every((c) => c.ok) ? 'All four goals are met.' : 'Not yet. Change limits.json and run again. The goals are in the README.');
  f('goals_met_count', checks.filter((c) => c.ok).length);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'How far a runaway job got, with no tuning and with limits',
        bars: [
          { label: 'JS leak, MB held, no tuning', value: b['heap-leak'].heldMb },
          { label: 'JS leak, MB held, limits', value: m['heap-leak'].heldMb },
          { label: 'Fork loop, helpers, no tuning', value: b.fork.children },
          { label: 'Fork loop, helpers, limits', value: m.fork.children },
          { label: 'File loop, files, limits', value: m.fds.files },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c10.p1');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
