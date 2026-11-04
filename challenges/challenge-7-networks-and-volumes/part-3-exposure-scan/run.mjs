// Challenge 7, part 3: scan what your stack exposes.
// Run: node challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to use the fixed compose.yaml in reference/ instead of yours.
//
// Starts a three-tier stack (web, api, db) from compose.yaml, then checks three things:
//   1. which ports Docker published, and on which address;
//   2. which of them answer on 127.0.0.1 and on this computer's other addresses (your wifi or cable address);
//   3. which containers can reach the database from inside.
// The scan only ever connects to the ports of the containers this script started.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, run, waitFor } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { CHALLENGE, compose, composeOk, docker, exec, filesDir, formatScan, freePort, lanAddresses, scanPorts, waitTcp } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 7, part 3: scan what your stack exposes');

const PROJECT = 'dkr-c7-p3';
const IMAGE = 'dkr-c7-daftar-api:1';
const file = join(filesDir(here), 'compose.yaml');

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}


try {
  cleanup(CHALLENGE);

  // The api image is built once from the shared daftar-api folder.
  docker(['build', '-q', '-t', IMAGE, '--label', `dkr.challenge=${CHALLENGE}`, join(root, 'daftar-api')]);

  const env = { WEB_PORT: String(await freePort()), API_PORT: String(await freePort()), DB_PORT: String(await freePort()) };
  composeOk(PROJECT, file, ['up', '-d'], env, { timeoutMs: 180_000 });
  const web = `${PROJECT}-web-1`;
  const api = `${PROJECT}-api-1`;
  const db = `${PROJECT}-db-1`;
  await waitFor(() => exec(db, ['pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).ok, { timeoutMs: 60_000, intervalMs: 500, what: 'Postgres to accept connections' });

  // 1. What did Docker publish?
  const ps = docker(['ps', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', 'table {{.Names}}\t{{.Ports}}']);
  const published = []; // { service, containerPort, hostIp, hostPort }
  for (const service of ['web', 'api', 'db']) {
    const info = JSON.parse(docker(['inspect', `${PROJECT}-${service}-1`, '--format', '{{json .NetworkSettings.Ports}}']));
    for (const [cp, binds] of Object.entries(info)) {
      for (const b of binds ?? []) published.push({ service, containerPort: cp, hostIp: b.HostIp, hostPort: Number(b.HostPort) });
    }
  }
  const wildcard = (p) => p.hostIp === '0.0.0.0' || p.hostIp === '::' || p.hostIp === '';
  const uniq0 = new Set(published.map((p) => p.hostPort)).size;
  const wild0 = new Set(published.filter(wildcard).map((p) => p.hostPort)).size;
  rec.step(
    `docker ps --filter label=com.docker.compose.project=${PROJECT} --format "table {{.Names}}\\t{{.Ports}}"`,
    ps.split('\n').map((l) => l.replace(/\s{2,}/g, '   ')).join('\n'),
    uniq0 === 0 ? 'Nothing is published.' : `${wild0} of ${uniq0} published ports are open on every address (0.0.0.0 or ::). Only a binding to 127.0.0.1 keeps a port to your own computer.`,
  );

  // 2. Which published ports answer, and where from?
  const lan = lanAddresses();
  const t0 = process.hrtime.bigint();
  const uniq = [...new Map(published.map((p) => [`${p.service}:${p.hostPort}`, p])).values()];
  const scanned = await scanPorts(uniq.map((p) => p.hostPort), lan);
  const rows = uniq.map((p, i) => ({ ...p, onLoopback: scanned[i].loopback, onLan: scanned[i].others }));
  const scanS = round(Number(process.hrtime.bigint() - t0) / 1e9, 1);
  const lanReachable = rows.filter((r) => r.onLan.includes('open'));
  const table = formatScan(scanned, lan);
  rec.step(
    `node challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/scan.mjs ${uniq.map((p) => p.hostPort).join(' ')}`,
    table,
    lanReachable.length ? `${lanReachable.length} of your containers' ports answer on your ${lan.length > 1 ? 'network addresses' : 'network address'}. Anyone on that network can try them.` : 'No published port answers on your network addresses. Only your own computer can use them.',
  );

  // 3. Who can reach the database from inside?
  const dbPublished = published.some((p) => p.service === 'db');
  const dbOnLan = rows.some((r) => r.service === 'db' && r.onLan.includes('open'));
  const webToDb = exec(web, ['nc', '-z', '-w', '2', 'db', '5432']);
  rec.step(`docker exec ${web} nc -z -w 2 db 5432`, webToDb.ok ? 'db:5432 -> open' : webToDb.out || 'not reachable', webToDb.ok ? 'The web tier can open the database directly. If someone breaks into web, the database is one step away.' : 'The web tier cannot even find the database. It sits on another network.');
  const apiToDb = exec(api, ['nc', '-z', '-w', '2', 'db', '5432']);
  rec.step(`docker exec ${api} nc -z -w 2 db 5432`, apiToDb.ok ? 'db:5432 -> open' : apiToDb.out || 'not reachable', apiToDb.ok ? 'The api tier reaches the database. It must, that is its job.' : 'The api cannot reach its own database. The stack is broken.');

  // The stack must still work end to end through the web tier.
  const webPort = Number(env.WEB_PORT);
  await waitTcp('127.0.0.1', webPort, 20_000);
  let e2e = false;
  let body = '';
  for (let i = 0; i < 20 && !e2e; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${webPort}/`);
      body = await res.text();
      e2e = res.status === 200 && body.includes('daftar-api');
    } catch (err) {
      body = String(err.cause?.code ?? err.message);
    }
    if (!e2e) await new Promise((r) => setTimeout(r, 300));
  }
  rec.step(`node -e "fetch('http://127.0.0.1:${webPort}/')"  (web proxies to api)`, body.slice(0, 120), e2e ? 'The page still loads through web and api. Closing doors did not break the stack.' : 'The page does not load. The stack is broken.');

  const nets = docker(['network', 'ls', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.Name}}']).split('\n').filter(Boolean);

  setFact('c7.p3.published_ports_count', uniq.length);
  setFact('c7.p3.wildcard_bound_count', new Set(published.filter(wildcard).map((p) => p.hostPort)).size);
  setFact('c7.p3.lan_reachable_count', lanReachable.length);
  setFact('c7.p3.db_published', dbPublished);
  setFact('c7.p3.db_reachable_from_lan', dbOnLan);
  setFact('c7.p3.web_reaches_db', webToDb.ok);
  setFact('c7.p3.api_reaches_db', apiToDb.ok);
  setFact('c7.p3.end_to_end_ok', e2e);
  setFact('c7.p3.networks_count', nets.length);
  setFact('c7.p3.lan_addresses_count', lan.length);
  setFact('c7.p3.scan_s', scanS);

  composeOk(PROJECT, file, ['down', '-v', '--remove-orphans'], env, { timeoutMs: 120_000 });
  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Compose ${run(['compose', 'version', '--short']).stdout.trim()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Ports of the stack that answer from each place',
        unit: 'ports',
        bars: [
          { label: 'Published by Docker', value: new Set(published.map((p) => p.hostPort)).size },
          { label: 'Answer on 127.0.0.1', value: rows.filter((r) => r.onLoopback === 'open').length },
          { label: 'Answer on your network', value: lanReachable.length },
          { label: 'Database port on network', value: dbOnLan ? 1 : 0 },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c7.p3');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  compose(PROJECT, file, ['down', '-v', '--remove-orphans'], { WEB_PORT: '1', API_PORT: '1', DB_PORT: '1' }, { timeoutMs: 120_000 });
  cleanup(CHALLENGE);
  run(['image', 'rm', IMAGE]);
}
