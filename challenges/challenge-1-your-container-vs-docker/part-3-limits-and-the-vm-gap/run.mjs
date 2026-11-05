// Challenge 1, part 3: your cgroup, Docker's limit, and the machine under both.
// Run: node challenges/challenge-1-your-container-vs-docker/part-3-limits-and-the-vm-gap/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// 1. The same 128 MB limit two ways: memory.max written by your script, and docker run --memory.
// 2. Which memory number is real: memory.current, the working set, and what docker stats shows.
// 3. Hit the limit in both and read the evidence each leaves.
// 4. The gap: a container limit that is bigger than the machine under it. The host container
//    stands in for Docker Desktop's virtual machine (256 MB). Your limit.json decides who is killed.

import { readFileSync, writeFileSync } from 'node:fs';
import { totalmem, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, leftovers, name, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import {
  N, IMAGE, HOST, docker, workDir, buildImage, removeImage, startHost, miniStart, miniWaitHealthy, miniGet, miniScript, miniStop,
  probeDocker, publishedPort, dockerWaitHealthy,
} from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 1, part 3: limits and the gap under them');

const MIB = 1048576;
const MINI = 'daftar-mini';
const GAP = 'daftar-gap';
const APP = name(N, 'app');
const VM_MB = 256; // the memory of the host container: our stand-in for the Docker Desktop virtual machine
const LIMIT = { memory: '128m', bytes: 128 * MIB, pids: 64 };

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const mib = (bytes) => round(bytes / MIB, 1);
const keyvals = (text) => Object.fromEntries(text.trim().split('\n').map((l) => l.split(/\s+/)).map(([k, v]) => [k, Number(v)]));
const dx = (...cmd) => run(['exec', APP, ...cmd]);
const mx = (...cmd) => miniScript(['exec', MINI, ...cmd]);
const hostCat = (path) => docker(['exec', HOST, 'cat', path]).trim();

/** memory.max, memory.current and memory.stat numbers, read with `read(path)` from inside a container. */
function cgroupNumbers(read) {
  const stat = keyvals(read('/sys/fs/cgroup/memory.stat'));
  return {
    max: Number(read('/sys/fs/cgroup/memory.max')),
    current: Number(read('/sys/fs/cgroup/memory.current')),
    anon: stat.anon,
    file: stat.file,
    inactiveFile: stat.inactive_file,
  };
}

/** "45.6MiB" or "1.2GiB" to a number of MiB. */
const toMib = (text) => {
  const m = text.match(/^([0-9.]+) ?([KMG]?i?B)$/);
  const f = { B: 1 / MIB, KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]];
  return round(Number(m[1]) * f, 1);
};

const alloc = async (port, mb) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/alloc?mb=${mb}`, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.json() : { error: res.status };
  } catch (e) {
    return { error: e.cause?.code ?? e.name };
  }
};

try {
  cleanup(N); // leftovers from an earlier run
  const limitJson = JSON.parse(readFileSync(join(workDir(here), 'limit.json'), 'utf8'));
  const gapLimitMb = limitJson.container_limit_mb;

  buildImage();
  await startHost({ memory: `${VM_MB}m` });

  // Step 1: the same limit, two ways.
  miniStart({ ctr: MINI, memBytes: LIMIT.bytes, pids: LIMIT.pids, num: 1 });
  await miniWaitHealthy(MINI);
  const dockerArgs = ['run', '-d', ...safeArgs(N, 'app', { memory: LIMIT.memory, pids: LIMIT.pids }), '-p', '127.0.0.1::8080', IMAGE];
  docker(dockerArgs);
  await dockerWaitHealthy(APP);
  const port = publishedPort(APP);
  const readD = (p) => dx('cat', p).stdout;
  const readM = (p) => mx('cat', p).stdout;
  const maxD = Number(readD('/sys/fs/cgroup/memory.max'));
  const maxM = Number(readM('/sys/fs/cgroup/memory.max'));
  const pinfo = probeDocker(APP);
  rec.step(
    `echo ${LIMIT.bytes} > /sys/fs/cgroup/mini-${MINI}/memory.max   # your script\ndocker run -d --memory ${LIMIT.memory} --memory-swap ${LIMIT.memory} ...   # Docker`,
    `inside your container:  memory.max = ${maxM}\ninside the docker one:  memory.max = ${maxD}`,
    '`--memory 128m` is one write to memory.max. `--memory-swap` equal to `--memory` also sets memory.swap.max to 0.',
  );

  // Step 2: the three memory numbers. Hold 40 MB in the app and write a 30 MB file so there is page cache.
  await alloc(port, 40);
  miniGet(MINI, '/alloc?mb=40');
  const fill = 'dd if=/dev/zero of=/var/tmp/cache.bin bs=1M count=30 2>/dev/null; sync';
  dx('sh', '-c', fill);
  mx('sh', '-c', fill);
  await new Promise((r) => setTimeout(r, 1500));
  const cD = cgroupNumbers(readD);
  const cM = cgroupNumbers(readM);
  const stats = docker(['stats', '--no-stream', '--format', '{{.MemUsage}}', APP]).trim();
  const statsMib = toMib(stats.split('/')[0].trim());
  const workingD = mib(cD.current - cD.inactiveFile);
  rec.step(
    `cat /sys/fs/cgroup/memory.current  and  grep -E "^(anon|file|inactive_file) " /sys/fs/cgroup/memory.stat   # in each container\ndocker stats --no-stream --format "{{.MemUsage}}" ${APP}`,
    [
      `                        your container   docker`,
      `memory.current (MiB)    ${String(mib(cM.current)).padEnd(17)}${mib(cD.current)}`,
      `  of it anon (MiB)      ${String(mib(cM.anon)).padEnd(17)}${mib(cD.anon)}`,
      `  of it file cache      ${String(mib(cM.file)).padEnd(17)}${mib(cD.file)}`,
      `  inactive_file (MiB)   ${String(mib(cM.inactiveFile)).padEnd(17)}${mib(cD.inactiveFile)}`,
      `current - inactive_file ${String(mib(cM.current - cM.inactiveFile)).padEnd(17)}${workingD}`,
      `docker stats says       -                ${stats}`,
    ].join('\n'),
    'docker stats is not memory.current. It subtracts inactive_file (cache that can be dropped at once). That number, the working set, is the one to watch. memory.current also counts cache.',
  );
  const statsMatch = Math.abs(statsMib - workingD) <= 2;

  // Step 3: hit the limit in both.
  const killD = await alloc(port, 200);
  const killM = miniGet(MINI, '/alloc?mb=200');
  await new Promise((r) => setTimeout(r, 1500));
  const st = docker(['inspect', APP, '--format', '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}']).trim().split(' ');
  const miniEvents = keyvals(docker(['exec', HOST, 'cat', `/sys/fs/cgroup/mini-${MINI}/memory.events`]));
  const miniPid = miniScript(['pid', MINI]).stdout.trim();
  const miniAlive = run(['exec', HOST, 'test', '-d', `/proc/${miniPid}`]).code === 0;
  rec.step(
    `curl "/alloc?mb=200"   # 200 MB asked from a 128 MB limit, in both\ndocker inspect ${APP} --format "{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}"\ncat /sys/fs/cgroup/mini-${MINI}/memory.events`,
    [
      `request in docker:    ${killD.error ? `failed (${killD.error})` : 'answered'}`,
      `docker inspect:       ${st.join(' ')}`,
      `request in yours:     ${killM.code !== 0 || !killM.text ? 'failed' : 'answered'}`,
      `your process alive:   ${miniAlive}`,
      `your memory.events:   ${Object.entries(miniEvents).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    ].join('\n'),
    'Same ending. The kernel kills the process when memory.max is hit. Docker turns that into exit 137 and OOMKilled true. Your script gets only the counter in memory.events: oom_kill goes up by one.',
  );
  const dockerOom = st[2] === 'true';
  const dockerExit = Number(st[1]);
  miniStop(MINI);
  run(['rm', '-f', '-v', APP]);

  // Step 4: the real machine under Docker Desktop.
  const vmRam = Number(docker(['info', '--format', '{{.MemTotal}}']).trim());
  const vmCpus = Number(docker(['info', '--format', '{{.NCPU}}']).trim());
  const kernel = docker(['info', '--format', '{{.KernelVersion}} / {{.OperatingSystem}}']).trim();
  const winRam = totalmem();
  const winCpus = cpus().length;
  rec.step(
    `docker info --format "{{.MemTotal}} {{.NCPU}} {{.KernelVersion}}"   and   node -e "os.totalmem()"   # on your computer\nnode /app/probe.mjs   # in a container`,
    [
      `your computer (node os.totalmem):   ${Math.round(winRam / MIB)} MB, ${winCpus} CPUs`,
      `docker info (the machine Docker runs on): ${Math.round(vmRam / MIB)} MB, ${vmCpus} CPUs, ${kernel}`,
      `inside a container with --memory 128m:    totalmem ${pinfo.total_mem_mb} MB, ${pinfo.cpus} CPUs`,
    ].join('\n'),
    'A container never sees its limit in os.totalmem() or the CPU count. It sees the machine Docker runs on. On Docker Desktop that machine is a virtual machine, smaller than your computer.',
  );

  // Step 5: the gap. A limit bigger than the machine under it.
  miniStart({ ctr: GAP, memBytes: gapLimitMb * MIB, pids: 64, num: 2 });
  await miniWaitHealthy(GAP);
  let held = 0;
  let failed = null;
  for (let i = 0; i < 40 && !failed; i++) {
    const r = miniGet(GAP, '/alloc?mb=10');
    if (r.code !== 0 || !r.text) failed = i;
    else held = JSON.parse(r.text).held_mb;
  }
  await new Promise((r) => setTimeout(r, 1000));
  const inner = keyvals(hostCat(`/sys/fs/cgroup/mini-${GAP}/memory.events`));
  const outer = keyvals(hostCat('/sys/fs/cgroup/memory.events.local')); // local: events of the machine itself, not of the container inside it
  const killedBy = outer.oom > 0 ? 'the machine under it' : 'its own limit';
  rec.step(
    `echo ${gapLimitMb * MIB} > /sys/fs/cgroup/mini-${GAP}/memory.max   # the machine has ${VM_MB} MB\nfor i in 1..40: curl "/alloc?mb=10"; then cat memory.events of the container and memory.events.local of the machine`,
    [
      `limit.json: container_limit_mb = ${gapLimitMb}   machine = ${VM_MB} MB`,
      `app held ${held} MB (plus node itself) before it died`,
      `container memory.events:  ${Object.entries(inner).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      `machine   memory.events.local: ${Object.entries(outer).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      `killed by: ${killedBy}`,
    ].join('\n'),
    gapLimitMb >= VM_MB
      ? 'The container limit is above what the machine has. The machine hits its wall first: its oom counter goes up, the container\'s max counter stays 0. The app dies far below its own limit.'
      : 'The container limit is below the machine\'s memory, so the container hits its own wall first: its max counter goes up and the machine never runs out.',
  );
  miniStop(GAP);

  // Facts.
  setFact('c1.p3.limit_mb', 128);
  setFact('c1.p3.memory_max_mini_bytes', maxM);
  setFact('c1.p3.memory_max_docker_bytes', maxD);
  setFact('c1.p3.docker_current_mib', mib(cD.current));
  setFact('c1.p3.docker_inactive_file_mib', mib(cD.inactiveFile));
  setFact('c1.p3.docker_working_set_mib', workingD);
  setFact('c1.p3.docker_stats_mib', statsMib);
  setFact('c1.p3.stats_is_working_set', statsMatch);
  setFact('c1.p3.mini_current_mib', mib(cM.current));
  setFact('c1.p3.mini_inactive_file_mib', mib(cM.inactiveFile));
  setFact('c1.p3.docker_oom_killed', dockerOom);
  setFact('c1.p3.docker_exit_code', dockerExit);
  setFact('c1.p3.mini_oom_kill_events', miniEvents.oom_kill);
  setFact('c1.p3.mini_alive_after_oom', miniAlive);
  setFact('c1.p3.windows_ram_mb', Math.round(winRam / MIB));
  setFact('c1.p3.vm_ram_mb', Math.round(vmRam / MIB));
  setFact('c1.p3.container_sees_ram_mb', pinfo.total_mem_mb);
  setFact('c1.p3.windows_cpus', winCpus);
  setFact('c1.p3.vm_cpus', vmCpus);
  setFact('c1.p3.container_sees_cpus', pinfo.cpus);
  setFact('c1.p3.gap_vm_mb', VM_MB);
  setFact('c1.p3.gap_container_limit_mb', gapLimitMb);
  setFact('c1.p3.gap_held_mb', held);
  setFact('c1.p3.gap_inner_max_events', inner.max);
  setFact('c1.p3.gap_outer_oom_events', outer.oom);
  setFact('c1.p3.gap_killed_by_own_limit', killedBy === 'its own limit');

  cleanup(N);
  removeImage();
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c1.p3.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Memory: what you set, what Docker shows, what the machine has',
        unit: 'MiB',
        bars: [
          { label: 'docker run --memory', value: 128 },
          { label: 'memory.current', value: mib(cD.current) },
          { label: 'docker stats', value: statsMib },
          { label: 'working set', value: workingD },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c1.p3');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  miniStop(MINI);
  miniStop(GAP);
  cleanup(N);
}
