// Challenge 3, part 2: who gets SIGTERM? Signals and PID 1.
// Run: node challenges/challenge-3-dockerfile-review/part-2-signals-and-pid1/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It builds six ways to start daftar-api and measures `docker stop` for each (median of three), then does
// the same for your Dockerfile.signals and entrypoint.sh. Everything runs inside capped containers.
// (Windows itself cannot send SIGTERM the way Linux does, so the experiment lives in the container.)

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, leftovers, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { N, docker, workDir, tmp, rmTree, build, removeImages } from '../lib/common.mjs';
import { makeContext, measureMedian } from './stopcheck.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 3, part 2: who gets SIGTERM?');
const work = tmp('p2');
const tags = [];

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** Stop a container whose PID 1 ignores SIGTERM and return how long docker stop took, in ms. */
async function ignoringStop(flags) {
  const ctr = 'dkr-c3-p2-calib';
  try {
    docker(['run', '-d', ...safeArgs(N, 'p2-calib', { memory: '32m' }), 'alpine:3.23', 'sh', '-c', 'sleep 1000; echo x']);
    await new Promise((r) => setTimeout(r, 1000));
    const t0 = process.hrtime.bigint();
    run(['stop', ...flags, ctr], { timeoutMs: 120_000 });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  } finally {
    run(['rm', '-f', '-v', ctr]);
  }
}

const VARIANTS = [
  { key: 'shell_cmd', label: 'CMD node ...; echo', file: 'Dockerfile.shell-cmd', init: false },
  { key: 'shell_plain', label: 'CMD node server.mjs', file: 'Dockerfile.shell-plain', init: false },
  { key: 'npm_shell', label: 'CMD npm start', file: 'Dockerfile.npm-shell', init: false },
  { key: 'npm_exec', label: 'CMD ["npm","start"]', file: 'Dockerfile.npm-exec', init: false },
  { key: 'entry_noexec', label: 'entrypoint.sh, no exec', file: 'Dockerfile.entry-noexec', init: false },
  { key: 'entry_exec', label: 'entrypoint.sh, with exec', file: 'Dockerfile.entry-exec', init: false },
  { key: 'node_exec', label: 'CMD ["node", ...]', file: 'Dockerfile.node-exec', init: false },
  { key: 'init_flag', label: 'CMD node ...; echo +init', file: 'Dockerfile.shell-cmd', init: true },
  { key: 'init_node', label: 'CMD ["node", ...] +init', file: 'Dockerfile.node-exec', init: true },
];

try {
  cleanup(N);
  const ctx = makeContext(join(work, 'ctx'), join(here, 'variants'), ['entrypoint-noexec.sh', 'entrypoint-exec.sh']);

  // Step 1: the engine's default grace period.
  const one = VARIANTS[0];
  const built = new Map();
  for (const v of VARIANTS) {
    if (!built.has(v.file)) {
      const tag = `dkr-c3-p2-${v.file.replace('Dockerfile.', '')}:1`;
      tags.push(tag);
      const b = build({ tag, dockerfile: join(here, 'variants', v.file), context: ctx });
      if (b.code !== 0) throw new Error(`build of ${v.file} failed:\n${b.out.split('\n').slice(-10).join('\n')}`);
      built.set(v.file, tag);
    }
  }
  const stopTimeoutField = String(JSON.parse(docker(['inspect', built.get(one.file), '--format', '{{json .Config}}'])).StopTimeout ?? '<nil>');

  // Step 2: measure all six.
  const results = [];
  for (const v of VARIANTS) {
    const r = await measureMedian(built.get(v.file), v.key.replace(/_/g, '-'), { init: v.init });
    results.push({ ...v, ...r });
  }
  const line = (r) => `${r.label.padEnd(26)} ${r.pid1.slice(0, 34).padEnd(36)} ${String(round(r.stopMs / 1000, 1)).padStart(5)} s   exit ${String(r.exitCode).padEnd(4)} ${r.graceful ? 'shutdown logged' : 'killed, no shutdown line'}`;
  rec.step(
    'docker run -d <image>   then   docker stop <container>   # no -t, median of 3, for each way to start daftar-api',
    [`${'way to start'.padEnd(26)} ${'PID 1 is'.padEnd(36)} ${'stop'.padStart(7)}   exit  graceful`, ...results.map(line)].join('\n'),
    'Read the PID 1 column against the stop column. A container that does not get SIGTERM (or whose PID 1 ignores it) waits for the grace period and is killed: exit 137, no shutdown line. One that does stops in about a second with exit 0.',
  );

  // Step 2b: how long does docker stop wait when nobody answers? A container that ignores SIGTERM, stopped four ways.
  const calib = {};
  for (const [name, flags] of [['default', []], ['t1', ['-t', '1']], ['t3', ['-t', '3']], ['t10', ['-t', '10']]]) {
    const times = [];
    for (let i = 0; i < 3; i++) times.push(await ignoringStop(flags));
    times.sort((x, y) => x - y);
    calib[name] = round(times[1] / 1000, 1);
  }
  const closest = [1, 3, 10].sort((a, b) => Math.abs(calib[`t${a}`] - calib.default) - Math.abs(calib[`t${b}`] - calib.default))[0];
  rec.step(
    'docker run -d alpine:3.23 sh -c "sleep 1000; echo x"   then   docker stop [-t N]   # PID 1 ignores SIGTERM, median of 3',
    [`docker stop           ${calib.default} s`, `docker stop -t 1     ${calib.t1} s`, `docker stop -t 3     ${calib.t3} s`, `docker stop -t 10    ${calib.t10} s`, `the default is closest to -t ${closest}`].join('\n'),
    'The Docker documentation says the default wait is 10 seconds. Here the default behaves like a short wait, not like -t 10 (the command itself adds a second or two on Docker Desktop). Measure it where you run your containers.',
  );

  // Step 3: your Dockerfile.signals.
  const dir = workDir(here);
  const mineCtx = makeContext(join(work, 'mine'), dir, ['entrypoint.sh']);
  const mineTag = 'dkr-c3-p2-mine:1';
  tags.push(mineTag);
  const bm = build({ tag: mineTag, dockerfile: join(dir, 'Dockerfile.signals'), context: mineCtx });
  if (bm.code !== 0) throw new Error(`build of Dockerfile.signals failed:\n${bm.out.split('\n').slice(-10).join('\n')}`);
  const mine = await measureMedian(mineTag, 'mine', {});
  rec.step(
    'docker build -f Dockerfile.signals (your entrypoint.sh)   then   docker stop',
    line({ label: 'your Dockerfile.signals', ...mine }) + `\nentrypoint printed "preparing": ${mine.prepared}`,
    mine.graceful ? 'Your entrypoint hands over to node with exec: node is PID 1, gets SIGTERM, drains and exits 0.' : 'Your container did not shut down gracefully yet. Read the table above: which variants did?',
  );

  // Facts.
  for (const r of results) {
    setFact(`c3.p2.${r.key}_stop_s`, round(r.stopMs / 1000, 1));
    setFact(`c3.p2.${r.key}_exit_code`, r.exitCode);
    setFact(`c3.p2.${r.key}_graceful`, r.graceful);
  }
  for (const r of results) setFact(`c3.p2.${r.key}_pid1_text`, r.pid1.slice(0, 60));
  setFact('c3.p2.default_stop_s', calib.default);
  setFact('c3.p2.stop_t1_s', calib.t1);
  setFact('c3.p2.stop_t3_s', calib.t3);
  setFact('c3.p2.stop_t10_s', calib.t10);
  setFact('c3.p2.default_stop_closest_t_s', closest);
  setFact('c3.p2.container_stop_timeout_field', stopTimeoutField);
  setFact('c3.p2.mine_stop_s', round(mine.stopMs / 1000, 1));
  setFact('c3.p2.mine_exit_code', mine.exitCode);
  setFact('c3.p2.mine_graceful', mine.graceful);
  setFact('c3.p2.mine_prepared', mine.prepared);
  setFact('c3.p2.mine_pid1_is_node', /^node/.test(mine.pid1));

  removeImages(...tags);
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c3.p2.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}  and  docker image rm <the images this part built>`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone, including the image tags.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Time for docker stop to finish (no -t, median of 3)',
        unit: 's',
        bars: [...results.map((r) => ({ label: r.label, value: round(r.stopMs / 1000, 1) })), { label: 'your Dockerfile.signals', value: round(mine.stopMs / 1000, 1) }],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c3.p2');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  try {
    removeImages(...tags);
  } catch {
    /* only our own tags are ever in the list */
  }
  cleanup(N);
  rmTree(work);
}
