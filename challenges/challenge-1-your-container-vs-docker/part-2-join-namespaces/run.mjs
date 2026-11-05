// Challenge 1, part 2: join two containers into one view of the machine.
// Run: node challenges/challenge-1-your-container-vs-docker/part-2-join-namespaces/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// A "sidecar" is a second container that shares some namespaces with the app. You choose which in
// join.json. Docker does it with --pid, --network and --ipc container:<name>. Your own script does the
// same with nsenter. The run tries five fixed combinations and then yours, in both worlds.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, leftovers, name, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import {
  N, IMAGE, ALPINE, HOST, docker, workDir, buildImage, removeImage, startHost, miniStart, miniWaitHealthy, miniScript, miniStop,
} from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 1, part 2: join two containers into one view of the machine');

const MINI = 'daftar-mini';
const APP = name(N, 'app');
const PRIVATE = name(N, 'private');
const PEEK = name(N, 'peek');

// What the sidecar asks, from the inside. busybox sh, busybox ps, busybox wget.
const PROBE = "wget -q -T 2 -O /dev/null http://127.0.0.1:8080/health && echo reach=1 || echo reach=0; echo node=$(ps | grep -c '[n]ode server.mjs'); echo ipc=$(readlink /proc/self/ns/ipc)";

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const parse = (text) => Object.fromEntries(text.trim().split('\n').map((l) => l.split('=')));
const yn = (b) => (b ? 'yes' : 'no');
const show = (flags) => (flags.length ? flags.join('+') : '(none)');

function dockerSidecar(flags, appIpc) {
  const args = ['run', '--rm'];
  args.push(...safeArgs(N, 'peek'));
  if (flags.includes('pid')) args.push('--pid', `container:${APP}`);
  if (flags.includes('net')) args.push('--network', `container:${APP}`);
  if (flags.includes('ipc')) args.push('--ipc', `container:${APP}`);
  args.push(ALPINE, 'sh', '-c', PROBE);
  const r = run(args);
  if (r.code !== 0) throw new Error(`sidecar failed: ${(r.stderr || r.stdout).trim()}`);
  const p = parse(r.stdout);
  return { reach: p.reach === '1', node: Number(p.node) > 0, ipc: p.ipc === appIpc, args };
}

function miniSidecar(flags, appIpc) {
  const r = miniScript(['sidecar', MINI, '/rootfs', flags.length ? flags.join(',') : 'none', 'sh', '-c', PROBE], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`mini sidecar failed: ${(r.stderr || r.stdout).trim()}`);
  const p = parse(r.stdout);
  return { reach: p.reach === '1', node: Number(p.node) > 0, ipc: p.ipc === appIpc };
}

try {
  cleanup(N); // leftovers from an earlier run

  const join_ = JSON.parse(readFileSync(join(workDir(here), 'join.json'), 'utf8'));
  const yours = ['pid', 'network', 'ipc'].filter((k) => join_[k] === true).map((k) => (k === 'network' ? 'net' : k));

  // Step 1: the app, twice. The Docker app must allow others to join its IPC namespace.
  buildImage();
  await startHost();
  miniStart({ ctr: MINI, num: 1 });
  await miniWaitHealthy(MINI);
  docker(['run', '-d', ...safeArgs(N, 'app', { memory: '128m' }), '--ipc', 'shareable', IMAGE]);
  docker(['exec', APP, 'sh', '-c', 'echo handshake > /dev/shm/token']);
  const appIpcDocker = docker(['exec', APP, 'readlink', '/proc/self/ns/ipc']).trim();
  const miniPid = miniScript(['pid', MINI]).stdout.trim();
  const appIpcMini = docker(['exec', HOST, 'readlink', `/proc/${miniPid}/ns/ipc`]).trim();
  rec.step(
    `docker run -d --name ${APP} --ipc shareable ${IMAGE}`,
    `${APP} is running. Its IPC namespace is ${appIpcDocker}.\n${MINI} is running in the host. Its IPC namespace is ${appIpcMini}.`,
    '`--ipc shareable` tells Docker that other containers may join this container\'s IPC namespace. The default is private.',
  );

  // Step 2: the five fixed combinations, in both worlds.
  const combos = [[], ['net'], ['pid'], ['ipc'], ['pid', 'net', 'ipc']];
  const rows = [];
  for (const flags of combos) {
    const d = dockerSidecar(flags, appIpcDocker);
    const m = miniSidecar(flags, appIpcMini);
    rows.push({ flags, d, m });
  }
  const table = (list) => {
    const head = `${'joined'.padEnd(13)}${'docker: reach / node / ipc'.padEnd(30)}your container: reach / node / ipc`;
    const body = list.map((r) => `${show(r.flags).padEnd(13)}${[r.d.reach, r.d.node, r.d.ipc].map(yn).join(' / ').padEnd(30)}${[r.m.reach, r.m.node, r.m.ipc].map(yn).join(' / ')}`);
    return [head, ...body].join('\n');
  };
  rec.step(
    `docker run --rm [--pid|--network|--ipc container:${APP}] ${ALPINE} sh -c <probe>   # and mini-container.sh sidecar ${MINI} ... [pid,net,ipc]`,
    table(rows),
    'reach = the sidecar can open 127.0.0.1:8080. node = its process list shows "node server.mjs". ipc = it shares the app\'s IPC namespace. Each flag changes exactly one of the three.',
  );

  // Step 3: the shared memory folder, Docker only.
  const withIpc = run(['run', '--rm', ...safeArgs(N, 'peek'), '--ipc', `container:${APP}`, ALPINE, 'sh', '-c', 'cat /dev/shm/token 2>&1']).stdout.trim();
  const withoutIpc = run(['run', '--rm', ...safeArgs(N, 'peek'), ALPINE, 'sh', '-c', 'cat /dev/shm/token 2>&1']).stdout.trim();
  rec.step(
    `docker run --rm ... [--ipc container:${APP}] ${ALPINE} cat /dev/shm/token`,
    `joined:     ${withIpc}\nnot joined: ${withoutIpc}`,
    'Joining the IPC namespace also shares /dev/shm. Only then can the sidecar read a file the app left there.',
  );
  const shmSeen = withIpc === 'handshake';

  // Step 4: a container that did not say "shareable" cannot be joined.
  docker(['run', '-d', ...safeArgs(N, 'private', { memory: '32m' }), ALPINE, 'sleep', '300']);
  const refused = run(['run', '--rm', ...safeArgs(N, 'peek'), '--ipc', `container:${PRIVATE}`, ALPINE, 'true']);
  const refusedMsg = (refused.stderr || refused.stdout).trim().split('\n')[0];
  rec.step(`docker run --rm --ipc container:${PRIVATE} ${ALPINE} true`, `exit ${refused.code}\n${refusedMsg}`, 'The default IPC mode is private. A sidecar can join only a container that started with --ipc shareable.');

  // Step 5: your flags from join.json.
  const d = dockerSidecar(yours, appIpcDocker);
  const m = miniSidecar(yours, appIpcMini);
  rec.step(
    `join.json: ${JSON.stringify(join_)}`,
    table([{ flags: yours, d, m }]),
    'Goal: the sidecar reaches the app and sees its process, but does not share its IPC namespace.',
  );

  // Facts.
  const pick = (flags) => rows.find((r) => r.flags.join('+') === flags.join('+'));
  setFact('c1.p2.join_pid', join_.pid === true);
  setFact('c1.p2.join_network', join_.network === true);
  setFact('c1.p2.join_ipc', join_.ipc === true);
  setFact('c1.p2.docker_reaches_app', d.reach);
  setFact('c1.p2.docker_sees_node', d.node);
  setFact('c1.p2.docker_shares_ipc', d.ipc);
  setFact('c1.p2.mini_reaches_app', m.reach);
  setFact('c1.p2.mini_sees_node', m.node);
  setFact('c1.p2.mini_shares_ipc', m.ipc);
  setFact('c1.p2.none_reaches_app', pick([]).d.reach || pick([]).m.reach);
  setFact('c1.p2.net_only_reaches_app', pick(['net']).d.reach && pick(['net']).m.reach);
  setFact('c1.p2.pid_only_sees_node', pick(['pid']).d.node && pick(['pid']).m.node);
  setFact('c1.p2.shm_file_seen_with_ipc_join', shmSeen);
  setFact('c1.p2.private_ipc_join_refused', refused.code !== 0);

  const left0 = leftovers(N);
  cleanup(N);
  removeImage();
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c1.p2.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}`, `Before: ${left0.containers} containers, ${left0.volumes} volumes. Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    const sees = (r) => Number(r.d.reach) + Number(r.d.node) + Number(r.d.ipc);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'What a sidecar shares with the app (out of 3)',
        unit: 'of 3',
        bars: rows.map((r) => ({ label: `joined: ${show(r.flags)}`, value: sees(r) })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c1.p2');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  miniStop(MINI);
  cleanup(N);
}
