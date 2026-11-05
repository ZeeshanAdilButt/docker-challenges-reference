// Challenge 13, part 4: three drills on the production host. Kill it, cut the registry, ship a bad release.
// Run: node challenges/challenge-13-ship-it/part-4-three-drills/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed compose.prod.yaml in reference/ (for maintainers).
//
// Uses the single privileged Docker-in-Docker host (dkr-c13-prod) described in part 2. Created now, removed at the end.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { clip, kit, pick, plantFault, removeTree, clearFacts, saveFacts, secs, sleep, startLoad } from '../kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', 'app');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 13, part 4: three drills');
const k = kit(13);
const facts = {};
const REPO = 'dkr-c13/api';
const TOKEN = 'dkr-c13-demo-token-7f3a91';
const composeFile = pick(here, 'compose.prod.yaml');
const LOAD_PATHS = ['/ready', '/', '/slow?ms=100'];
const RECOVER_CAP_MS = 30_000;

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** Poll fn every 100 ms. Returns the milliseconds it took, or null after capMs. */
async function until(fn, capMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    if (await Promise.resolve(fn()).catch(() => false)) return Date.now() - t0;
    await sleep(100);
  }
  return null;
}
const answers = (url) => fetch(url, { signal: AbortSignal.timeout(1500) }).then((r) => r.status === 200).catch(() => false);
const inspect = (c, fmt) => k.prodDocker(['inspect', c, '--format', fmt]);

try {
  clearFacts('c13.p4.'); // a failed run must not leave the numbers of an older run behind
  k.teardown();
  k.removeImages();
  const reg = await k.startRegistry();
  const host = await k.startProd({ ports: [8080] });
  const edge = await k.startEdge({ hostPort: 8080 });
  const envFor = (digest) => ({ REGISTRY: reg.inner, DIGEST: digest, API_TOKEN: TOKEN });

  // Images: a good release, and a release that passes its tests but never becomes ready in production.
  const good = await k.runPipeline({ config: { stages: ['build', 'push'], tags: ['sha'] }, dir: app, repo: REPO, sha: '4444444dddddddddddddddddddddddddddddddd', version: '1.0.0' });
  const badDir = plantFault(app, 'never-ready');
  let bad;
  try {
    bad = await k.runPipeline({ config: { stages: ['build', 'push'], tags: ['sha'] }, dir: badDir, repo: REPO, sha: '5555555eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', version: '2.0.0' });
  } finally {
    removeTree(badDir);
  }
  if (!good.ok || !bad.ok) throw new Error('could not build and push the two releases');

  const container = () => `daftar-${edge.current}-api-1`;
  const freshDeploy = async () => {
    edge.reset({ file: composeFile, env: envFor(good.digest) });
    const r = await edge.deploy({ file: composeFile, env: envFor(good.digest) });
    if (!r.ok) throw new Error(`could not deploy the good release before a drill: ${r.error}`);
  };
  const policy = () => inspect(container(), '{{.HostConfig.RestartPolicy.Name}}');

  // Drill 1: kill -9 the only copy of the service. (docker kill would count as a manual stop and skip the restart policy.)
  await freshDeploy();
  const restartPolicy = policy();
  const load1 = startLoad({ url: edge.url, paths: LOAD_PATHS });
  await sleep(1500);
  const c1 = container();
  k.killProcess(c1);
  const recoveryMs = await until(() => answers(`${edge.url}/ready`), RECOVER_CAP_MS);
  await sleep(1000);
  const r1 = await load1.stop();
  const restarts = Number(inspect(c1, '{{.RestartCount}}')) || 0;
  facts['c13.p4.kill_restart_policy'] = restartPolicy;
  facts['c13.p4.kill_recovered'] = recoveryMs !== null;
  facts['c13.p4.kill_recovery_s'] = recoveryMs === null ? secs(RECOVER_CAP_MS) : secs(recoveryMs);
  facts['c13.p4.kill_failed_count'] = r1.failed;
  facts['c13.p4.kill_restart_count'] = restarts;
  rec.step(
    `kill -9 on the main process of ${c1}   (sent from the host side, while load runs)\nthen poll GET /ready through the proxy every 100 ms (give up after ${RECOVER_CAP_MS / 1000} s)`,
    `restart policy: ${restartPolicy}\nrestart count: ${restarts}\n${recoveryMs === null ? `NOT back after ${RECOVER_CAP_MS / 1000} s` : `answering again after ${secs(recoveryMs)} s`}\nrequests during the drill: ${r1.total}   failed: ${r1.failed}`,
    recoveryMs === null
      ? 'Nothing brought the service back. With restart "no" a dead process stays dead until a person notices.'
      : 'Docker started the service again by itself. The outage is the restart plus the warm-up, and the failed requests are what one copy costs: a restart policy bounds an outage, a second copy would remove it.',
  );

  // Drill 2: the registry is down, and the host must still redeploy an image it already has.
  await freshDeploy();
  k.docker(['stop', k.REG]);
  const load2 = startLoad({ url: edge.url, paths: LOAD_PATHS });
  await sleep(1500);
  const t2 = Date.now();
  const redeploy = await edge.deploy({ file: composeFile, env: envFor(good.digest) });
  const redeployMs = Date.now() - t2;
  await sleep(1000);
  const r2 = await load2.stop();
  facts['c13.p4.registry_down_redeploy_ok'] = redeploy.ok;
  facts['c13.p4.registry_down_deploy_s'] = secs(redeployMs);
  facts['c13.p4.registry_down_failed_count'] = r2.failed;
  rec.step(
    `docker stop dkr-c13-registry   then redeploy the same digest with compose up --wait   (pull_policy decides whether it asks the registry)`,
    `pull policy in the file: ${(readFileSync(composeFile, 'utf8').match(/^\s*pull_policy:\s*(\S+)/m) || [0, '(default)'])[1]}\nredeploy: ${redeploy.ok ? `ok in ${secs(redeployMs)} s` : `FAILED after ${secs(redeployMs)} s: ${(redeploy.error ?? '').split(String.fromCharCode(10)).pop().slice(0, 140)}`}\nrequests during the drill: ${r2.total}   failed: ${r2.failed}`,
    redeploy.ok
      ? 'The registry was gone and the deploy did not notice: the image was already on the host, named by digest, and the file did not ask to pull it again.'
      : '"pull_policy: always" made the deploy ask the registry even though the host had the image. An outage of the registry became an outage of your deploys.',
  );
  k.docker(['start', k.REG]);

  // Drill 3: a bad release that never becomes ready.
  await freshDeploy();
  const load3 = startLoad({ url: edge.url, paths: LOAD_PATHS });
  await sleep(1500);
  const servingBefore = edge.current;
  const t3 = Date.now();
  const attempt = await edge.deploy({ file: composeFile, env: envFor(bad.digest), waitS: 60 });
  const detectMs = Date.now() - t3;
  await sleep(1000);
  const root = await fetch(`${edge.url}/`).then((r) => r.json()).catch(() => ({}));
  const r3 = await load3.stop();
  facts['c13.p4.bad_release_rejected'] = attempt.ok === false;
  facts['c13.p4.bad_release_detect_s'] = secs(detectMs);
  facts['c13.p4.bad_release_failed_count'] = r3.failed;
  facts['c13.p4.bad_release_old_still_serving'] = attempt.ok === false && edge.current === servingBefore && root.version === '1.0.0';
  rec.step(
    'deploy a release whose /ready never answers 200 (it passed its unit tests) while load runs, with compose up --wait',
    `deploy result: ${attempt.ok ? 'accepted (the bad copy took traffic)' : `refused after ${secs(detectMs)} s (${(attempt.error ?? '').split(String.fromCharCode(10)).pop().slice(0, 100)})`}\nserving after the attempt: ${edge.current}, version ${root.version ?? '(no answer)'}\nrequests during the drill: ${r3.total}   failed: ${r3.failed}`,
    attempt.ok === false && r3.failed === 0
      ? `The health gate refused the bad copy after ${secs(detectMs)} s, and the old copy never stopped serving. Nobody noticed, which is the point.`
      : attempt.ok === false
        ? `The bad copy was refused after ${secs(detectMs)} s, but ${r3.failed} requests failed meanwhile.`
        : 'The bad copy got traffic.',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, production host engine ${host.engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Seconds to get through each drill',
        unit: 's',
        bars: [
          { label: 'Killed copy is back', value: facts['c13.p4.kill_recovery_s'] },
          { label: 'Redeploy, registry down', value: facts['c13.p4.registry_down_deploy_s'] },
          { label: 'Bad release refused', value: facts['c13.p4.bad_release_detect_s'] },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nKilled copy back: ${facts['c13.p4.kill_recovered']}. Redeploy with the registry down: ${redeploy.ok}. Bad release refused: ${facts['c13.p4.bad_release_rejected']}, old still serving: ${facts['c13.p4.bad_release_old_still_serving']}.`);
  console.log('See your numbers with: node toolkit/show-facts.mjs c13.p4');
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  try {
    saveFacts(facts);
  } catch { /* nothing more to save */ }
  process.exitCode = 1;
} finally {
  run(['start', 'dkr-c13-registry']); // harmless if it is already running
  k.teardown();
  k.removeImages();
}
