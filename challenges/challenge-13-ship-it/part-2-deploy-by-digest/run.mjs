// Challenge 13, part 2: deploy by digest to a production host you can break.
// Run: node challenges/challenge-13-ship-it/part-2-deploy-by-digest/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed compose.prod.yaml in reference/ (for maintainers).
//
// THE ONE PRIVILEGED CONTAINER. The "production host" is a Docker engine inside a container (docker:29-dind).
// A Docker engine needs --privileged to start inside a container. This is the single named exception to the
// "no --privileged" rule of this course. The host is named dkr-c13-prod, labelled, capped (memory, processes, a
// size-capped tmpfs for its disk), reached over TLS on 127.0.0.1 through a Docker context, and removed at the end.
// Nothing mounts the Docker socket of your machine.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { clip, kit, pick, clearFacts, saveFacts, secs, short, sleep, startLoad } from '../kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', 'app');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 13, part 2: deploy by digest');
const k = kit(13);
const facts = {};
const REPO = 'dkr-c13/api';
const TOKEN = 'dkr-c13-demo-token-7f3a91'; // a made-up test value, never a real secret
const SHAS = { 1: '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2: '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 3: '3333333ccccccccccccccccccccccccccccccccc' };
const composeFile = pick(here, 'compose.prod.yaml');
const carelessFile = join(here, 'careless.compose.yaml');
const LOAD_PATHS = ['/ready', '/', '/slow?ms=100']; // /ready answers 503 while a copy is still warming up

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** The digest of the image a container really runs, from the production host. */
function runningDigest(container) {
  const id = k.prodDocker(['inspect', container, '--format', '{{.Image}}']);
  const digests = JSON.parse(k.prodDocker(['image', 'inspect', id, '--format', '{{json .RepoDigests}}']) || '[]').map((d) => d.split('@')[1]);
  return { id, digests };
}

try {
  clearFacts('c13.p2.'); // a failed run must not leave the numbers of an older run behind
  k.teardown();
  k.removeImages();
  const reg = await k.startRegistry();

  // Step 1: the production host.
  const t0 = Date.now();
  const host = await k.startProd({ ports: [8080] });
  const hostS = secs(Date.now() - t0);
  const edge = await k.startEdge({ hostPort: 8080 });
  facts['c13.p2.host_start_s'] = hostS;
  rec.step(
    `docker run -d --name dkr-c13-prod --privileged --memory 3g --pids-limit 1024 --tmpfs /var/lib/docker:size=2000m docker:29-dind ...\ndocker --context dkr-c13-prod info --format "engine {{.ServerVersion}}, name {{.Name}}, storage {{.Driver}}"`,
    `engine ${host.engine}, name ${k.prodDocker(['info', '--format', '{{.Name}}'])}, storage ${k.prodDocker(['info', '--format', '{{.Driver}}'])}\nprivileged: ${k.docker(['inspect', k.PROD, '--format', '{{.HostConfig.Privileged}}'])}   socket mounted: ${k.docker(['inspect', k.PROD, '--format', '{{json .HostConfig.Binds}}']).includes('docker.sock')}\nstarted in ${hostS} s`,
    'A second Docker engine, in a container, reached through a Docker context over TLS. It is the only privileged container in this course. Everything you deploy lands here, and nothing touches your own containers.',
  );

  // Step 2: the pipeline pushes three versions. Version 3 lands before the deploy of version 2: the tag moves.
  const cfg = { stages: ['build', 'push'], tags: ['sha', 'version', 'latest'] };
  const images = {};
  for (const v of [1, 2, 3]) {
    const r = await k.runPipeline({ config: cfg, dir: app, repo: REPO, sha: SHAS[v], version: `${v}.0.0` });
    if (!r.ok) throw new Error(`pipeline for version ${v} failed at ${r.failedAt}`);
    images[v] = r.digest;
  }
  const latestNow = await k.digestOf(REPO, 'latest');
  facts['c13.p2.latest_moved'] = latestNow === images[3] && latestNow !== images[2];
  rec.step(
    `GET /v2/${REPO}/manifests/<tag>   for 1.0.0, 2.0.0, 3.0.0 and latest`,
    `1.0.0   ${short(images[1])}\n2.0.0   ${short(images[2])}   <- the version you want to deploy\n3.0.0   ${short(images[3])}   <- another merge finished first\nlatest  ${short(latestNow)}`,
    'You tested and approved 2.0.0. While you were getting ready to deploy, another change was pushed. "latest" now names 3.0.0, an image nobody tested together with your change.',
  );

  const envFor = (v, extra = {}) => ({ REGISTRY: reg.inner, DIGEST: images[v], API_TOKEN: TOKEN, ...extra });

  // Step 3: the first deploy (version 1), timed, with the load generator not running yet.
  edge.reset({ file: composeFile, env: envFor(1) });
  const first = await edge.deploy({ file: composeFile, env: envFor(1) });
  if (!first.ok) throw new Error(`the first deploy failed: ${first.error}`);
  facts['c13.p2.first_deploy_s'] = secs(first.deploy_ms);
  rec.step(
    `DIGEST=${short(images[1])}... docker --context dkr-c13-prod compose -p daftar-blue -f compose.prod.yaml up -d --wait\ndocker --context dkr-c13-prod ps --format "{{.Names}}  {{.Image}}  {{.Status}}"`,
    k.prodDocker(['ps', '--format', '{{.Names}}  {{.Image}}  {{.Status}}']),
    `The first deploy took ${secs(first.deploy_ms)} s, including the image pull from the registry. "Up (healthy)" appears only if your compose file has a health check.`,
  );

  // Step 4: the careless rollout (the control): the right image by digest, but no health check.
  const rollout = async (file, version, { trialEnv } = {}) => {
    edge.reset({ file, env: envFor(1) });
    const f = await edge.deploy({ file, env: envFor(1) });
    if (!f.ok) throw new Error(`could not start version 1 before the trial: ${f.error}`);
    await sleep(500);
    const load = startLoad({ url: edge.url, paths: LOAD_PATHS });
    await sleep(1500);
    const r = await edge.deploy({ file, env: envFor(2, trialEnv) });
    await sleep(1500);
    const counts = await load.stop();
    return { ...r, counts, container: r.container };
  };
  const careless = await rollout(carelessFile, 2);
  facts['c13.p2.careless_failed_count'] = careless.counts.failed;
  facts['c13.p2.careless_total_count'] = careless.counts.total;
  rec.step(
    'roll out version 2 while load runs, with a compose file that has NO health check (the control)',
    `rollout took ${secs(careless.deploy_ms)} s\nrequests: ${careless.counts.total}   failed: ${careless.counts.failed}   (503 from a copy still warming up: ${careless.counts.http_5xx}, refused ${careless.counts.refused}, reset ${careless.counts.reset})\nanswers from version 1: ${careless.counts.versions['1.0.0'] ?? 0}, from version 2: ${careless.counts.versions['2.0.0'] ?? 0}`,
    careless.counts.failed > 0
      ? '"up --wait" returned when the container was running, not when it was ready. nginx switched to a copy that was still warming up, and some requests failed.'
      : 'This run happened to lose nothing. Without a health check the swap is a race.',
  );

  // Step 5: your rollout, three trials.
  const trials = [];
  for (let i = 0; i < 3; i++) trials.push(await rollout(composeFile, 2));
  const last = trials[trials.length - 1];
  const failedTotal = trials.reduce((a, t) => a + t.counts.failed, 0);
  const requestsTotal = trials.reduce((a, t) => a + t.counts.total, 0);
  const rolloutS = round(median(trials.map((t) => t.deploy_ms)) / 1000, 1);
  const seenBoth = trials.every((t) => (t.counts.versions['1.0.0'] ?? 0) > 0 && (t.counts.versions['2.0.0'] ?? 0) > 0);
  facts['c13.p2.rollout_s'] = rolloutS;
  facts['c13.p2.rollout_failed_count'] = failedTotal;
  facts['c13.p2.rollout_total_count'] = requestsTotal;
  facts['c13.p2.rollout_both_versions_served'] = seenBoth;
  facts['c13.p2.rollout_ok'] = trials.every((t) => t.ok);
  rec.step(
    `roll out version 2 while load runs, with YOUR compose.prod.yaml   (3 trials, median)`,
    `rollout took ${rolloutS} s (median)\nrequests over 3 trials: ${requestsTotal}   failed: ${failedTotal}\nanswers from version 1: ${last.counts.versions['1.0.0'] ?? 0}, from version 2: ${last.counts.versions['2.0.0'] ?? 0} (last trial)`,
    failedTotal === 0
      ? 'Not one request failed. The new copy had to report healthy before nginx moved to it, and the old copy was stopped only after a short drain. Both versions served traffic, so the swap really happened.'
      : `${failedTotal} requests failed. Is the new copy healthy before nginx points at it?`,
  );

  // Step 6: what is running, and is it what you intended?
  const c = last.container;
  const run = runningDigest(c);
  const intended = images[2];
  const match = run.digests.includes(intended);
  facts['c13.p2.digest_match'] = match;
  facts['c13.p2.intended_digest'] = intended;
  facts['c13.p2.running_digest'] = run.digests[0] ?? run.id;
  rec.step(
    `docker --context dkr-c13-prod inspect ${c} --format "{{.Config.Image}}"\ndocker --context dkr-c13-prod image inspect <image> --format "{{json .RepoDigests}}"`,
    `image reference:  ${k.prodDocker(['inspect', c, '--format', '{{.Config.Image}}']).replace(reg.inner, '<registry>')}\nrunning digest:   ${short(run.digests[0] ?? run.id)}\nintended digest:  ${short(intended)}   (2.0.0)\nlatest digest:    ${short(latestNow)}   (3.0.0)`,
    match ? 'The host runs exactly the image you tested. A digest cannot move, so the tag race could not touch it.' : 'The host runs an image you did not test: the tag moved between the pipeline and the deploy.',
  );

  // Step 7: secrets, limits and the health check.
  const text = readFileSync(composeFile, 'utf8').replace(/^\s*#.*$/gm, '');
  const tokenLine = text.split(/\r?\n/).find((l) => /API_TOKEN\s*:/.test(l)) ?? '';
  const literal = !/\$\{/.test(tokenLine.split(':').slice(1).join(':'));
  facts['c13.p2.secret_literal_in_file'] = literal;
  const runEnv = k.prodDocker(['inspect', c, '--format', '{{json .Config.Env}}']);
  facts['c13.p2.token_from_deploy_env'] = runEnv.includes(`API_TOKEN=${TOKEN}`);
  const hist = k.prodDocker(['image', 'history', '--no-trunc', run.id]);
  const imgCfg = k.prodDocker(['image', 'inspect', run.id, '--format', '{{json .Config}}']);
  facts['c13.p2.image_holds_secret'] = hist.includes(TOKEN) || imgCfg.includes(TOKEN);
  const mem = Number(k.prodDocker(['inspect', c, '--format', '{{.HostConfig.Memory}}'])) || 0;
  const pids = Number(k.prodDocker(['inspect', c, '--format', '{{.HostConfig.PidsLimit}}'])) || 0;
  const health = k.prodDocker(['inspect', c, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}']);
  facts['c13.p2.mem_limit_mb'] = Math.round(mem / 1048576);
  facts['c13.p2.pids_limit_count'] = pids;
  facts['c13.p2.health_status'] = health;
  rec.step(
    `grep API_TOKEN compose.prod.yaml\ndocker --context dkr-c13-prod image history --no-trunc <image> | grep -c <the token>\ndocker --context dkr-c13-prod inspect ${c} --format "mem {{.HostConfig.Memory}} pids {{.HostConfig.PidsLimit}} health {{.State.Health.Status}}"`,
    `compose file:       ${tokenLine.trim() || '(no API_TOKEN line)'}\ntoken in the image: ${facts['c13.p2.image_holds_secret'] ? 'YES' : 'no'}\ntoken in the running container: ${facts['c13.p2.token_from_deploy_env'] ? 'yes, the value the deploy passed in' : 'not the value the deploy passed in'}\nlimits and health:  memory ${facts['c13.p2.mem_limit_mb']} MB, processes ${pids}, health ${health}`,
    !literal && facts['c13.p2.token_from_deploy_env'] && mem > 0 && pids > 0 && health === 'healthy'
      ? 'The secret is written nowhere in the repository or the image. It lives in the environment of whoever deploys, and reaches the container at run time. (docker inspect still shows it to anyone who can talk to the host: an environment variable is not a vault.)'
      : 'Something is still unsafe: a secret written in the file, no memory or process limit, or no health check.',
  );

  // Facts about the host itself.
  const stats = k.docker(['stats', '--no-stream', '--format', '{{.MemUsage}}', k.PROD]);
  const used = /([\d.]+)(MiB|GiB)/.exec(stats);
  facts['c13.p2.host_mem_used_mb'] = used ? Math.round(Number(used[1]) * (used[2] === 'GiB' ? 1024 : 1)) : 0;
  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, production host engine ${host.engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Requests that failed during one rollout under load',
        unit: 'requests',
        bars: [
          { label: 'No health check', value: careless.counts.failed },
          { label: 'Your compose file (3 trials)', value: failedTotal },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nRunning digest matches the one you intended: ${match}. Failed requests in your rollouts: ${failedTotal} of ${requestsTotal}.`);
  console.log('See your numbers with: node toolkit/show-facts.mjs c13.p2');
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  try {
    saveFacts(facts);
  } catch { /* nothing more to save */ }
  process.exitCode = 1;
} finally {
  k.teardown();
  k.removeImages();
}
