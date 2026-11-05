// Challenge 7, part 2: the localhost trap.
// Run: node challenges/challenge-7-networks-and-volumes/part-2-the-localhost-trap/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to use the fixed api.env in reference/ instead of yours.
//
// One database (Postgres) and one "api" container on a user-defined network. The api tries to open a
// TCP connection to DB_HOST:DB_PORT. We ask the same question from several places and compare the answers.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, label, name, safeArgs, waitFor } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, docker, exec, filesDir, freePort, probeTcp, sleep } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 7, part 2: the localhost trap');

const PG = 'postgres:18-alpine';
const NODE = 'node:24-alpine';
const NET = name(CHALLENGE, 'p2-app');
const DB = name(CHALLENGE, 'p2-db');
const API = name(CHALLENGE, 'p2-api');

// The api's connection check. It prints one JSON line: which host, what happened, how long it took.
const PROBE = `
const net = require('net');
const host = process.env.DB_HOST, port = Number(process.env.DB_PORT || 5432);
const t0 = Date.now();
const out = (result) => { console.log(JSON.stringify({ host, port, result, ms: Date.now() - t0 })); process.exit(result === 'open' ? 0 : 1); };
const s = net.connect({ host, port });
s.setTimeout(2000, () => out('timeout'));
s.on('connect', () => out('open'));
s.on('error', (e) => out(e.code || (e.errors && e.errors[0] && e.errors[0].code) || 'error'));
`.trim();

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** Run the api's check three times (with optional DB_HOST / DB_PORT overrides). Returns { result, host, port, ms }. */
function ask(overrides) {
  const runs = [0, 1, 2].map(() => {
    const r = exec(API, ['node', '-e', PROBE], { containerEnv: overrides });
    const found = r.out.split('\n').filter((l) => l.startsWith('{')).pop() ?? '{"result":"error","ms":0}';
    return JSON.parse(found);
  });
  // the answer that most runs agree on, so one slow moment on a busy machine does not decide
  const counts = {};
  for (const x of runs) counts[x.result] = (counts[x.result] ?? 0) + 1;
  const result = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return { result, host: runs[0].host, port: runs[0].port, ms: median(runs.map((x) => x.ms)) };
}
const text = (r) => `${r.host}:${r.port} -> ${r.result} (${r.ms} ms)`;

try {
  cleanup(CHALLENGE);

  const envFile = join(filesDir(here), 'api.env');
  const env = Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => l.split('=').map((x) => x.trim())),
  );

  const hostPort = await freePort();
  docker(['network', 'create', ...label(CHALLENGE), NET]);
  docker([
    'run', '-d', ...safeArgs(CHALLENGE, 'p2-db', { memory: '256m', pids: 100 }), '--network', NET, '--network-alias', 'db',
    '-p', `127.0.0.1:${hostPort}:5432`, '--tmpfs', '/var/lib/postgresql:rw,size=96m',
    '-e', 'POSTGRES_PASSWORD=dkr-demo-only', PG,
  ]);
  await waitFor(() => exec(DB, ['pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).ok, { timeoutMs: 60_000, intervalMs: 500, what: 'Postgres to accept connections' });
  rec.step(
    `docker run -d --name ${DB} --network ${NET} --network-alias db -p 127.0.0.1:${hostPort}:5432 ${PG}`,
    'pg_isready -h 127.0.0.1: accepting connections',
    `The database listens on port 5432 inside its container. Docker also publishes it on 127.0.0.1:${hostPort} of your computer.`,
  );

  docker(['run', '-d', ...safeArgs(CHALLENGE, 'p2-api', { memory: '128m' }), '--network', NET, '--env-file', envFile, NODE, 'sleep', '600']);
  await sleep(500);
  rec.step(
    `docker run -d --name ${API} --network ${NET} --env-file api.env ${NODE} sleep 600`,
    `api.env: DB_HOST=${env.DB_HOST} DB_PORT=${env.DB_PORT}`,
    'The api container gets its settings from your api.env. The check below plays the part of the api opening its database connection.',
  );

  // Place 1: inside the api, the way the api is configured.
  const mine = ask({});
  rec.step(
    `docker exec ${API} node -e "<connect to DB_HOST:DB_PORT>"`,
    text(mine),
    mine.result === 'open' ? 'Your api.env works: the api reaches the database.' : `Your api.env fails with ${mine.result}. The api looked for the database at ${mine.host}, which is the api container itself.`,
  );

  // Place 2: inside the api, to localhost on purpose.
  const local = ask({ DB_HOST: 'localhost', DB_PORT: '5432' });
  rec.step(`docker exec -e DB_HOST=localhost ${API} node -e "<connect>"`, text(local), '"localhost" inside a container means that container. Nothing listens on 5432 in the api container, so the connection is refused at once.');

  // Place 3: inside the api, by the name on the shared network.
  const byName = ask({ DB_HOST: 'db', DB_PORT: '5432' });
  rec.step(`docker exec -e DB_HOST=db ${API} node -e "<connect>"`, text(byName), 'The name "db" is the network alias of the database. Docker\'s DNS (127.0.0.11) turns it into the IP of the database container.');

  // Place 4: inside the database container, to its own localhost.
  const self = exec(DB, ['nc', '-z', '-w', '2', 'localhost', '5432']);
  rec.step(`docker exec ${DB} nc -z -w 2 localhost 5432`, self.ok ? 'localhost:5432 -> open' : 'localhost:5432 -> refused', 'From inside the database container, "localhost" is right: this container is the one that listens.');

  // Place 5: from your computer.
  const t0 = process.hrtime.bigint();
  const hostResult = await probeTcp('127.0.0.1', hostPort);
  const hostMs = Number(process.hrtime.bigint() - t0) / 1e6;
  rec.step(`node -e "<connect to 127.0.0.1:${hostPort}>"`, `127.0.0.1:${hostPort} -> ${hostResult} (${round(hostMs, 0)} ms)`, `From your computer, "localhost" is your computer. The published port 127.0.0.1:${hostPort} leads to the database.`);

  // Place 6: from the api, to the published port of your computer.
  const viaHost = ask({ DB_HOST: 'host.docker.internal', DB_PORT: String(hostPort) });
  rec.step(`docker exec -e DB_HOST=host.docker.internal -e DB_PORT=${hostPort} ${API} node -e "<connect>"`, text(viaHost), 'host.docker.internal is the name Docker Desktop gives to your computer. It is a way out of a container to the host, but a detour, and it only exists on some setups.');

  // Place 7: from the api, to the published port number on localhost.
  const wrongPort = ask({ DB_HOST: '127.0.0.1', DB_PORT: String(hostPort) });
  rec.step(`docker exec -e DB_HOST=127.0.0.1 -e DB_PORT=${hostPort} ${API} node -e "<connect>"`, text(wrongPort), 'A published port is a door on your computer. It does not exist inside the other containers, so using that port number from the api fails too.');

  setFact('c7.p2.api_localhost_result', local.result);
  setFact('c7.p2.api_localhost_ms', local.ms);
  setFact('c7.p2.api_by_name_result', byName.result);
  setFact('c7.p2.api_by_name_ms', byName.ms);
  setFact('c7.p2.db_own_localhost_ok', self.ok);
  setFact('c7.p2.host_published_result', hostResult);
  setFact('c7.p2.api_host_docker_internal_result', viaHost.result);
  setFact('c7.p2.api_published_port_on_localhost_result', wrongPort.result);
  setFact('c7.p2.published_port', hostPort);
  setFact('c7.p2.api_env_db_host', env.DB_HOST);
  setFact('c7.p2.api_env_result', mine.result);

  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Milliseconds to get an answer from the database port',
        unit: 'ms',
        bars: [
          { label: 'api to db (name)', value: byName.ms },
          { label: 'api to localhost', value: local.ms },
          { label: 'api to host.docker.internal', value: viaHost.ms },
          { label: 'your computer to 127.0.0.1', value: round(hostMs, 0) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c7.p2');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
