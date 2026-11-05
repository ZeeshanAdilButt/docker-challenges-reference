// Challenge 1, part 1: the same app in your container and in Docker.
// Run: node challenges/challenge-1-your-container-vs-docker/part-1-same-app-two-ways/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It runs daftar-api twice. Once in a container made by hand (mini-container.sh, inside a
// throw-away host container) and once with `docker run`. Then it asks both containers what
// they can see, from the inside, and prints the two answers side by side.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, leftovers, name, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round, timed } from '../../../toolkit/stats.js';
import {
  N, IMAGE, HOST, docker, workDir, buildImage, removeImage, startHost, miniStart, miniWaitHealthy, miniGet, miniStop,
  probeMini, probeDocker, hostNamespaces, newNamespaces, publishedPort, dockerWaitHealthy, popcountHex,
} from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 1, part 1: the same app in your container and in Docker');

const MINI = 'daftar-mini';
const APP = name(N, 'app');
const LIMIT = { memory: '128m', bytes: 134217728, pids: 64 };

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

async function dockerStart() {
  const args = ['run', '-d', ...safeArgs(N, 'app', { memory: LIMIT.memory, pids: LIMIT.pids }), '-p', '127.0.0.1::8080', IMAGE];
  const t = await timed(async () => {
    docker(args);
    await dockerWaitHealthy(APP);
  });
  return { ms: t.ms, args };
}

try {
  cleanup(N); // leftovers from an earlier run

  // Step 1: build the image that both containers use.
  const bytes = buildImage();
  const imageMb = round(bytes / 1e6, 1);
  rec.step(`docker build -t ${IMAGE} .   # daftar-api plus probe.mjs on node:24-alpine`, `${IMAGE}: ${bytes} bytes`, `One image, ${imageMb} MB on disk. Both containers use exactly these files.`);

  // Step 2: the throw-away host, and the folder your container will use as its root.
  const hostT = await timed(() => startHost());
  const du = docker(['exec', HOST, 'du', '-sm', '/rootfs']).trim().split(/\s+/)[0];
  rec.step(
    `docker export <image copy> | docker exec -i ${HOST} tar -x -C /rootfs`,
    `/rootfs holds ${du} MB`,
    `The image's files are now a plain folder inside the host. That folder is the root file system of your container. This took ${round(hostT.ms / 1000, 1)} s.`,
  );

  // Step 3: start each container three times for the start time. Keep the last pair running.
  const miniMs = [];
  const dockerMs = [];
  let miniCmd = '';
  let dockerArgs = [];
  for (let i = 0; i < 3; i++) {
    const keep = i === 2;
    const a = await timed(async () => {
      miniStart({ ctr: MINI, memBytes: LIMIT.bytes, pids: LIMIT.pids, num: 1 });
      await miniWaitHealthy(MINI);
    });
    miniMs.push(a.ms);
    if (!keep) miniStop(MINI);
    const b = await dockerStart();
    dockerMs.push(b.ms);
    dockerArgs = b.args;
    if (!keep) run(['rm', '-f', '-v', APP]);
  }
  miniCmd = `docker exec ${HOST} mini-container.sh run ${MINI} /rootfs ${LIMIT.bytes} ${LIMIT.pids} 1 sh -c "cd /app && exec node server.mjs"`;
  const miniS = round(median(miniMs) / 1000, 2);
  const dockerS = round(median(dockerMs) / 1000, 2);
  rec.step(miniCmd, `container ${MINI} answers /health`, `Your container: ready in ${miniS} s (median of 3, including the wait for /health).`);
  rec.step(`docker ${dockerArgs.join(' ')}`, `container ${APP} answers /health on 127.0.0.1:${publishedPort(APP)}`, `Docker: ready in ${dockerS} s (median of 3). Docker adds a bridge network, a published port, DNS files and a writable layer.`);

  // Step 4: it is the same app. Ask both for / and /pid.
  const dockerRoot = await (await fetch(`http://127.0.0.1:${publishedPort(APP)}/`)).json();
  const dockerPid = await (await fetch(`http://127.0.0.1:${publishedPort(APP)}/pid`)).json();
  const miniRoot = JSON.parse(miniGet(MINI, '/').text);
  const miniPid = JSON.parse(miniGet(MINI, '/pid').text);
  rec.step(
    `GET /  and  GET /pid  on both`,
    [`your container: ${JSON.stringify(miniRoot)} ${JSON.stringify(miniPid)}`, `docker:         ${JSON.stringify(dockerRoot)} ${JSON.stringify(dockerPid)}`].join('\n'),
    'Same service, same answers. In both, node is PID 1 and its parent is 0: the process is the first one in its own PID namespace.',
  );

  // Step 5: ask each container what it sees from the inside.
  const mini = probeMini(MINI);
  const dock = probeDocker(APP);
  const base = hostNamespaces();
  const nsMini = newNamespaces(mini.ns, base);
  const nsDocker = newNamespaces(dock.ns, base);
  const capsMini = popcountHex(mini.cap_bnd);
  const capsDocker = popcountHex(dock.cap_bnd);

  const rows = [
    ['hostname', mini.hostname, dock.hostname],
    ['PID 1 is', mini.pid1, dock.pid1],
    ['user id of the app', mini.uid, dock.uid],
    ['namespaces it made', nsMini.join(' '), nsDocker.join(' ')],
    ['capabilities allowed', capsMini, capsDocker],
    ['mounts it sees', mini.mounts, dock.mounts],
    ['root file system', mini.root_fstype, dock.root_fstype],
    ['cgroup path', mini.cgroup_path, dock.cgroup_path],
    ['memory.max', mini.memory_max, dock.memory_max],
    ['node reads its limit (MB)', mini.constrained_mem_mb, dock.constrained_mem_mb],
    ['/proc/sys writable', mini.proc_sys_writable, dock.proc_sys_writable],
    ['DNS servers in resolv.conf', mini.nameservers, dock.nameservers],
    ['eth0 address', mini.eth0_ipv4, dock.eth0_ipv4],
    ['environment variables', mini.env_names.length, dock.env_names.length],
  ];
  const w = Math.max(...rows.map((r) => String(r[0]).length));
  const w2 = Math.max(24, ...rows.map((r) => String(r[1]).length)) + 2;
  const table = [`${'what the process sees'.padEnd(w)}  ${'your container'.padEnd(w2)}docker`, ...rows.map((r) => `${String(r[0]).padEnd(w)}  ${String(r[1]).padEnd(w2)}${r[2]}`)].join('\n');
  rec.step('node /app/probe.mjs   # run inside each container (docker exec, and mini-container.sh exec)', table, 'The probe reads /proc and /sys from the inside. Rows that differ are what Docker adds or decides for you.');

  // Step 6: your answers against what was measured.
  const answers = JSON.parse(readFileSync(join(workDir(here), 'answers.json'), 'utf8'));
  const expected = {
    docker_makes_namespaces: nsDocker,
    your_script_makes_namespaces: nsMini,
    who_runs_the_image_user: dock.uid !== 0 && mini.uid === 0 ? 'docker' : 'your script',
    docker_proc_sys_writable: dock.proc_sys_writable,
    more_mounts: dock.mounts > mini.mounts ? 'docker' : 'your script',
    node_sees_its_limit_in_your_container: mini.constrained_mem_mb > 0,
  };
  const same = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
  const lines = Object.entries(expected).map(([k, v]) => `${same(answers[k], v) ? 'ok  ' : 'DIFF'} ${k}: you said ${JSON.stringify(answers[k] ?? null)}, measured ${JSON.stringify(v)}`);
  rec.step(`compare answers.json with the measurement`, lines.join('\n'), 'Your guesses are checked against the probe output above, not against a fixed list.');

  // Facts.
  setFact('c1.p1.image_mb', imageMb);
  setFact('c1.p1.start_mini_s', miniS);
  setFact('c1.p1.start_docker_s', dockerS);
  setFact('c1.p1.ns_new_mini', nsMini.join(','));
  setFact('c1.p1.ns_new_docker', nsDocker.join(','));
  setFact('c1.p1.ns_new_mini_count', nsMini.length);
  setFact('c1.p1.ns_new_docker_count', nsDocker.length);
  setFact('c1.p1.uid_mini', mini.uid);
  setFact('c1.p1.uid_docker', dock.uid);
  setFact('c1.p1.caps_mini_count', capsMini);
  setFact('c1.p1.caps_docker_count', capsDocker);
  setFact('c1.p1.mounts_mini', mini.mounts);
  setFact('c1.p1.mounts_docker', dock.mounts);
  setFact('c1.p1.root_fstype_mini', mini.root_fstype);
  setFact('c1.p1.root_fstype_docker', dock.root_fstype);
  setFact('c1.p1.memory_max_mini_bytes', mini.memory_max);
  setFact('c1.p1.memory_max_docker_bytes', dock.memory_max);
  setFact('c1.p1.node_limit_seen_mini_mb', mini.constrained_mem_mb);
  setFact('c1.p1.node_limit_seen_docker_mb', dock.constrained_mem_mb);
  setFact('c1.p1.proc_sys_writable_mini', mini.proc_sys_writable);
  setFact('c1.p1.proc_sys_writable_docker', dock.proc_sys_writable);
  setFact('c1.p1.nameservers_mini', mini.nameservers);
  setFact('c1.p1.nameservers_docker', dock.nameservers);
  setFact('c1.p1.pid1_both_node', mini.pid1 === dock.pid1 && dock.pid1 === 'node server.mjs');
  setFact('c1.p1.vm_cpus', dock.cpus);
  setFact('c1.p1.vm_ram_mb', dock.total_mem_mb);
  const answersOk = Object.entries(expected).every(([k, v]) => same(answers[k], v));
  setFact('c1.p1.answers_match', answersOk);

  // Teardown first, then prove nothing is left.
  miniStop(MINI);
  cleanup(N);
  removeImage();
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c1.p1.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone: the host, the volume with your root folder, the Docker container and the image tag.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Time until /health answers',
        unit: 's',
        bars: [
          { label: 'Your container', value: miniS },
          { label: 'docker run', value: dockerS },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c1.p1');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(N);
}
