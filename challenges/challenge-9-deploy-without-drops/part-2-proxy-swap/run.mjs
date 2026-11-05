// Challenge 9, part 2: swap two copies behind a proxy while load is running.
// Run: node challenges/challenge-9-deploy-without-drops/part-2-proxy-swap/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to use the fixed swap.json in reference/ instead of yours.
//
// nginx sends traffic to "blue" (daftar-api version 1). While load is running, we start "green" (version 2,
// which needs 4 s to boot), point nginx at it, and stop blue. swap.json says whether to wait for green to be
// ready first (healthGate) and how long to let blue finish its requests before stopping it (drainMs).
// The script runs the swap twice over: once with the careless settings (the control) and once with yours.
// Each is tried three times and the median is kept.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, label, leftovers, name, run, safeArgs } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, buildDaftar, daftarDir, docker, filesDir, freePort, get, pollUntil, removeImages, sleep, timedDocker } from '../lib.mjs';
import { startLoad } from '../load.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 9, part 2: swap two copies behind a proxy');
const IMAGE = 'dkr-c9-app:1';
const NGINX = 'nginx:1.27-alpine';
const NET = name(CHALLENGE, 'p2-net');
const BLUE = name(CHALLENGE, 'p2-blue');
const GREEN = name(CHALLENGE, 'p2-green');
const PROXY = name(CHALLENGE, 'p2-proxy');
const template = readFileSync(join(here, 'nginx.conf'), 'utf8');
const settings = JSON.parse(readFileSync(join(filesDir(here), 'swap.json'), 'utf8'));

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const setUpstream = (target) => {
  const conf = template.replaceAll('__UPSTREAM__', target);
  docker(['exec', '-i', PROXY, 'sh', '-c', 'cat > /etc/nginx/conf.d/default.conf'], { input: conf });
  docker(['exec', PROXY, 'nginx', '-s', 'reload']);
};

/** One swap with the given settings. Returns the load result plus how long the swap took. */
async function trial({ healthGate, drainMs }) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  try {
    docker(['network', 'create', ...label(CHALLENGE), NET]);
    docker(['run', '-d', ...safeArgs(CHALLENGE, 'p2-blue', { memory: '128m' }), '--network', NET, '-e', 'APP_VERSION=1', IMAGE]);
    docker(['run', '-d', ...safeArgs(CHALLENGE, 'p2-proxy', { memory: '128m' }), '--network', NET, '-p', `127.0.0.1:${port}:80`, NGINX]);
    await sleep(800);
    setUpstream(BLUE);
    await pollUntil(async () => (await get(`${url}/health`)).status === 200, { timeoutMs: 20_000 });

    const load = startLoad({ url });
    await sleep(2000);

    const t0 = process.hrtime.bigint();
    // green is an app that needs four seconds to boot (it loads things before it listens)
    docker(['run', '-d', ...safeArgs(CHALLENGE, 'p2-green', { memory: '128m' }), '--network', NET, '-e', 'APP_VERSION=2', '--entrypoint', 'sh', IMAGE, '-c', 'sleep 4; exec node server.mjs']);
    if (healthGate) {
      const ready = await pollUntil(() => run(['exec', PROXY, 'wget', '-qO-', '-T', '1', `http://${GREEN}:8080/ready`]).code === 0, { timeoutMs: 20_000, intervalMs: 100 });
      if (!ready.value) throw new Error('green never became ready');
    }
    setUpstream(GREEN);
    if (drainMs) await sleep(drainMs);
    const stop = timedDocker(['stop', BLUE], { timeoutMs: 60_000 });
    const swapS = Number(process.hrtime.bigint() - t0) / 1e9;

    await sleep(2000);
    const r = await load.stop();
    console.error(`  trial: swap ${round(swapS, 1)} s (docker stop blue ${round(stop.ms / 1000, 1)} s), sent ${r.total}, failed ${r.failed} (502/503 ${r.http_5xx}, refused ${r.refused}, reset ${r.reset}, timeout ${r.timeout})`);
    return { ...r, swap_s: swapS, blue_stop_s: stop.ms / 1000 };
  } finally {
    cleanup(CHALLENGE);
  }
}

const med = (list, key) => median(list.map((r) => r[key]));
const row = (list) => ({
  total: med(list, 'total'),
  failed: med(list, 'failed'),
  http_5xx: med(list, 'http_5xx'),
  refused: med(list, 'refused'),
  reset: med(list, 'reset'),
  timeout: med(list, 'timeout'),
  outage_ms: med(list, 'outage_ms'),
  swap_s: round(med(list, 'swap_s'), 1),
  versions: Math.min(...list.map((r) => Object.keys(r.versions).length)),
  v1: med(list, 'versions1'),
  v2: med(list, 'versions2'),
});
const describe = (r) => `requests: ${r.total}   failed: ${r.failed}   (502/503 from the proxy ${r.http_5xx}, refused ${r.refused}, reset ${r.reset}, timeout ${r.timeout})\nswap took ${r.swap_s} s; answers from version 1: ${r.v1}, from version 2: ${r.v2}`;

try {
  cleanup(CHALLENGE);
  buildDaftar(IMAGE, join(daftarDir, 'Dockerfile'));

  const trials = async (opts) => {
    const list = [];
    for (let i = 0; i < 3; i++) {
      const r = await trial(opts);
      r.versions1 = r.versions['1'] ?? 0;
      r.versions2 = r.versions['2'] ?? 0;
      list.push(r);
    }
    return row(list);
  };

  const control = await trials({ healthGate: false, drainMs: 0 });
  rec.step(
    'swap.json: { "healthGate": false, "drainMs": 0 }   (start green, point nginx at it at once, stop blue at once; median of 3)',
    describe(control),
    control.failed > 0
      ? 'nginx was pointed at green before green was listening, so some requests got a 502 from the proxy. The careless swap drops requests even though both copies are healthy.'
      : 'This run happened to lose no request. The careless swap is a race: it may fail, it may not.',
  );

  const yours = await trials({ healthGate: Boolean(settings.healthGate), drainMs: Number(settings.drainMs) || 0 });
  rec.step(
    `swap.json: ${JSON.stringify({ healthGate: Boolean(settings.healthGate), drainMs: Number(settings.drainMs) || 0 })}   (median of 3)`,
    describe(yours),
    yours.failed === 0
      ? `Not one request failed. Green was checked first (/ready answers only once it listens, 4 s after it starts), nginx was reloaded gracefully, and blue got ${settings.drainMs} ms to finish what it was doing before it was stopped. Both versions served traffic, so the swap really happened.`
      : `Your settings still lose ${yours.failed} requests. Is green ready before nginx points at it?`,
  );

  setFact('c9.p2.control_total_count', control.total);
  setFact('c9.p2.control_failed_count', control.failed);
  setFact('c9.p2.control_swap_s', control.swap_s);
  setFact('c9.p2.yours_total_count', yours.total);
  setFact('c9.p2.yours_failed_count', yours.failed);
  setFact('c9.p2.yours_swap_s', yours.swap_s);
  setFact('c9.p2.yours_version1_count', yours.v1);
  setFact('c9.p2.yours_version2_count', yours.v2);
  setFact('c9.p2.yours_health_gate', Boolean(settings.healthGate));
  setFact('c9.p2.yours_drain_ms', Number(settings.drainMs) || 0);

  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Failed requests during one swap (median of 3)',
        unit: 'requests',
        bars: [
          { label: 'No health gate, no drain', value: control.failed },
          { label: 'Your settings', value: yours.failed },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c9.p2');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages([IMAGE]);
}
