// Challenge 7, part 1: default bridge versus a user-defined bridge.
// Run: node challenges/challenge-7-networks-and-volumes/part-1-default-vs-user-defined-bridge/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run the fixed topology in reference/ instead of your topology.json.
//
// Three fixed experiments (the default bridge, a user-defined bridge, two separate networks),
// then your own topology.json: can the container "api" reach the container "db" by the name "db"?

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, leftovers, label, name, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, docker, exec, filesDir, show } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 7, part 1: default bridge versus user-defined bridge');
const IMAGE = 'alpine:3.23';
const PORT = '8000';
const GREETING = 'hello-from-db';

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const netName = (n) => name(CHALLENGE, `p1-${n}`);
const SERVER = ['nc', '-lk', '-p', PORT, '-e', '/bin/echo', GREETING];

/** Start a container from alpine. role 'server' answers on port 8000, 'client' just sleeps. */
function start(what, network, role, alias) {
  const args = ['run', '-d', ...safeArgs(CHALLENGE, `p1-${what}`), '--network', network];
  if (alias && network !== 'bridge') args.push('--network-alias', alias);
  args.push(IMAGE, ...(role === 'server' ? SERVER : ['sleep', '300']));
  docker(args);
  return name(CHALLENGE, `p1-${what}`);
}

const ipOf = (container, network) =>
  docker(['inspect', container, '--format', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`]);

/** Median of three runs of the same exec. Returns { ok, out, ms }. */
function probe3(container, cmd) {
  const runs = [0, 1, 2].map(() => exec(container, cmd));
  return { ok: runs[0].ok, out: runs[0].out, ms: median(runs.map((r) => r.ms)) };
}

const nameserver = (container) => exec(container, ['sh', '-c', "grep '^nameserver' /etc/resolv.conf | head -1 | cut -d' ' -f2"]).out;
const lines = (s, n) => s.split('\n').slice(0, n).join('\n');

try {
  cleanup(CHALLENGE); // leftovers from an earlier run

  // Experiment 1: the default bridge. Two containers, no network flag.
  const a = start('ctl-a', 'bridge', 'client');
  const b = start('ctl-b', 'bridge', 'server');
  await new Promise((r) => setTimeout(r, 800));
  const defNs = nameserver(a);
  rec.step(`docker exec ${a} grep nameserver /etc/resolv.conf`, `nameserver ${defNs}`, 'On the default bridge the container asks an outside DNS server. That server has never heard of your container names.');
  const defLookup = probe3(a, ['getent', 'hosts', b]);
  rec.step(`docker exec ${a} getent hosts ${b}`, defLookup.ok ? defLookup.out : '(no answer, exit code 2)', `The name does not resolve. The failed lookup took ${round(defLookup.ms / 1000, 1)} s (median of 3) because the outside server had to be asked first.`);
  const bIp = ipOf(b, 'bridge');
  const defIp = probe3(a, ['nc', '-w', '2', bIp, PORT]);
  rec.step(`docker exec ${a} nc -w 2 ${bIp} ${PORT}`, defIp.out, 'By IP address it works. But the address changes every time the container is recreated, so nobody should use it.');

  // Experiment 2: a user-defined bridge.
  const userNet = netName('demo');
  docker(['network', 'create', ...label(CHALLENGE), userNet]);
  const c = start('ctl-c', userNet, 'client');
  const d = start('ctl-d', userNet, 'server');
  await new Promise((r) => setTimeout(r, 800));
  const userNs = nameserver(c);
  rec.step(`docker network create ${userNet}`, userNet, 'A user-defined bridge. Both containers below join it with --network.');
  rec.step(`docker exec ${c} grep nameserver /etc/resolv.conf`, `nameserver ${userNs}`, '127.0.0.11 is Docker\'s own DNS server, inside every container on a user-defined network. It knows every container name on that network.');
  const userLookup = probe3(c, ['getent', 'hosts', d]);
  rec.step(`docker exec ${c} getent hosts ${d}`, userLookup.out, `The name resolves in ${round(userLookup.ms, 0)} ms (median of 3).`);
  const userReach = probe3(c, ['nc', '-w', '2', d, PORT]);
  rec.step(`docker exec ${c} nc -w 2 ${d} ${PORT}`, userReach.out, 'Connecting by name works. The name stays the same when the container is recreated.');

  // Experiment 3: two separate user-defined networks cannot see each other.
  const otherNet = netName('other');
  docker(['network', 'create', ...label(CHALLENGE), otherNet]);
  const e = start('ctl-e', otherNet, 'client');
  const dIp = ipOf(d, userNet);
  await new Promise((r) => setTimeout(r, 500));
  const cross = probe3(e, ['nc', '-w', '2', dIp, PORT]);
  rec.step(`docker exec ${e} nc -w 2 ${dIp} ${PORT}`, cross.out || '(no output, exit code ' + (cross.ok ? 0 : 1) + ')', `Another network cannot reach it, even by IP. It does not get "refused": the packets are dropped, so the client waits for its whole 2 s timeout (${round(cross.ms / 1000, 1)} s).`);

  // Your topology.json
  cleanup(CHALLENGE); // the controls are done; start your own topology from a clean slate
  const dir = filesDir(here);
  const spec = JSON.parse(readFileSync(join(dir, 'topology.json'), 'utf8'));
  const userNets = spec.networks.filter((n) => n !== 'bridge');
  for (const n of userNets) docker(['network', 'create', ...label(CHALLENGE), netName(n)]);
  const netOf = (c1) => (c1.network === 'bridge' ? 'bridge' : netName(c1.network));
  for (const c1 of spec.containers) {
    start(`t-${c1.name}`, netOf(c1), c1.name === 'db' ? 'server' : 'client', c1.name);
  }
  await new Promise((r) => setTimeout(r, 800));
  const api = name(CHALLENGE, 'p1-t-api');
  const mine = probe3(api, ['nc', '-w', '2', spec.api_reaches, PORT]);
  const mineOk = mine.out.includes(GREETING);
  const shown = JSON.stringify({ networks: spec.networks, containers: spec.containers.map((x) => `${x.name} on ${x.network}`) });
  rec.step(`docker exec ${api} nc -w 2 ${spec.api_reaches} ${PORT}`, mine.out, mineOk ? `Your topology works: api reaches ${spec.api_reaches} by name. (${shown})` : `Your topology does not work: the name "${spec.api_reaches}" is not known to api. (${shown})`);

  setFact('c7.p1.default_bridge_nameserver', defNs);
  setFact('c7.p1.default_bridge_name_lookup_ok', defLookup.ok);
  setFact('c7.p1.default_bridge_failed_lookup_s', round(defLookup.ms / 1000, 1));
  setFact('c7.p1.default_bridge_ip_reach_ok', defIp.out.includes(GREETING));
  setFact('c7.p1.user_bridge_nameserver', userNs);
  setFact('c7.p1.user_bridge_name_lookup_ok', userLookup.ok);
  setFact('c7.p1.user_bridge_lookup_ms', round(userLookup.ms, 0));
  setFact('c7.p1.user_bridge_name_reach_ok', userReach.out.includes(GREETING));
  setFact('c7.p1.cross_network_ip_reach_ok', cross.out.includes(GREETING));
  setFact('c7.p1.cross_network_probe_s', round(cross.ms / 1000, 1));
  setFact('c7.p1.topology_name_ok', mineOk);
  setFact('c7.p1.topology_user_networks_count', userNets.length);

  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Seconds until the client gets its answer',
        unit: 's',
        bars: [
          { label: 'User net, by name', value: round(userReach.ms / 1000, 2) },
          { label: 'Default bridge, by IP', value: round(defIp.ms / 1000, 2) },
          { label: 'Default bridge, by name', value: round(defLookup.ms / 1000, 2) },
          { label: 'Other network, by IP', value: round(cross.ms / 1000, 2) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c7.p1');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
