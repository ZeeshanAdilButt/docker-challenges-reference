// Challenge 3, part 4: build secrets and run secrets.
// Run: node challenges/challenge-3-dockerfile-review/part-4-build-and-run-secrets/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// Two secrets, both made up:
//   a build token  used while the dependencies are installed
//   an API key     used by the running service
// It builds the original Dockerfile.leaky and your Dockerfile, looks for the token in history, config and
// layers, and then starts a container with the flags from your secret-run.mjs.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertDocker, cleanup, leftovers } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { N, workDir, tmp, rmTree, removeImages } from '../lib/common.mjs';
import { BUILD_TOKEN, RUNTIME_KEY, fingerprint, makeContext, writeSecret, buildWithToken, scanImage, buildProof, runtimeCheck } from './checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 3, part 4: build secrets and run secrets');
const work = tmp('p4');
const tags = [];

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const yn = (b) => (b ? 'YES' : 'no');

try {
  cleanup(N);
  const ctx = makeContext(join(work, 'ctx'));
  const tokenFile = writeSecret(join(work, 'secrets'), 'npm_token', BUILD_TOKEN);
  const keyFile = writeSecret(join(work, 'secrets'), 'api_key', RUNTIME_KEY);
  const mine = await import(pathToFileURL(join(workDir(here), 'secret-run.mjs')).href);

  // Step 1 and 2: build both and look for the token.
  const rows = [];
  for (const [label, file] of [['original (Dockerfile.leaky)', join(here, 'Dockerfile.leaky')], ['yours (Dockerfile)', join(workDir(here), 'Dockerfile')]]) {
    const tag = `dkr-c3-p4-${label.startsWith('original') ? 'leaky' : 'mine'}:1`;
    tags.push(tag);
    const b = buildWithToken(file, ctx, tag, tokenFile);
    if (b.code !== 0) throw new Error(`build of ${label} failed:\n${b.out.split('\n').filter(Boolean).slice(-8).join('\n')}`);
    const scan = scanImage(tag, work);
    const proof = buildProof(tag);
    rows.push({ label, tag, scan, proof, proofOk: proof === fingerprint(BUILD_TOKEN) });
  }
  rec.step(
    'docker build --build-arg NPM_TOKEN=<token> --secret id=npm_token,src=<file> -f <Dockerfile> .   (both Dockerfiles, same flags)',
    rows.map((r) => `${r.label}\n   build-proof.txt = ${r.proof}  (fingerprint of the token: ${r.proofOk ? 'matches, so the token WAS available to the build' : 'does not match'})`).join('\n'),
    'Both builds could use the token: build-proof.txt holds its fingerprint, not the token.',
  );
  rec.step(
    'docker history --no-trunc <image> | grep <token>   and   look in the saved image: config and every file of every layer',
    ['                              history   config   layers', ...rows.map((r) => `${r.label.padEnd(30)}${yn(r.scan.history).padEnd(10)}${yn(r.scan.config).padEnd(9)}${yn(r.scan.layers)}`)].join('\n'),
    'An ARG used in RUN is written into the history and the config of the image, in plain text, even though the .npmrc file was deleted. A build secret is a file that exists for one step and leaves no trace.',
  );

  // Step 3: the runtime key.
  const envMode = (await import(pathToFileURL(join(here, 'secret-run.original.mjs')).href)).runArgs;
  const original = runtimeCheck(rows[0].tag, envMode, keyFile);
  const yours = runtimeCheck(rows[1].tag, mine.runArgs, keyFile);
  const show = (label, r) => `${label.padEnd(26)} source ${String(r.source).padEnd(5)} key in docker inspect: ${yn(r.inspectHasKey).padEnd(4)} key in the flags: ${yn(r.flagsHaveKey).padEnd(4)} read-only mount: ${yn(r.mountReadonly)}${r.error ? `  (${r.error})` : ''}`;
  rec.step(
    'docker run -d <flags from secret-run.mjs> <image> sleep 60   then   docker inspect and docker exec node check-secret.mjs',
    [show('original (-e API_KEY=...)', original), show('yours (secret-run.mjs)', yours), `fingerprint read by the app matches: original ${yn(original.fingerprintOk)}, yours ${yn(yours.fingerprintOk)}`].join('\n'),
    'An environment variable is stored in the container config: anyone who can run docker inspect reads it. A file mounted read-only is not in the config. The app reads it either way.',
  );

  // Facts.
  const [leaky, fixed] = rows;
  setFact('c3.p4.original_history_has_token', leaky.scan.history);
  setFact('c3.p4.original_config_has_token', leaky.scan.config);
  setFact('c3.p4.original_layers_have_token', leaky.scan.layers);
  setFact('c3.p4.mine_history_has_token', fixed.scan.history);
  setFact('c3.p4.mine_config_has_token', fixed.scan.config);
  setFact('c3.p4.mine_layers_have_token', fixed.scan.layers);
  setFact('c3.p4.original_build_proof_ok', leaky.proofOk);
  setFact('c3.p4.mine_build_proof_ok', fixed.proofOk);
  setFact('c3.p4.original_run_source', String(original.source));
  setFact('c3.p4.original_inspect_has_key', original.inspectHasKey);
  setFact('c3.p4.mine_run_source', String(yours.source));
  setFact('c3.p4.mine_inspect_has_key', yours.inspectHasKey);
  setFact('c3.p4.mine_flags_have_key', yours.flagsHaveKey);
  setFact('c3.p4.mine_mount_readonly', yours.mountReadonly);
  setFact('c3.p4.mine_app_reads_key', yours.fingerprintOk);
  setFact('c3.p4.where_token_leaks_count', Object.values(leaky.scan).filter(Boolean).length);

  removeImages(...tags);
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c3.p4.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}  and  docker image rm <the images this part built>`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone, including the image tags and the temporary secret files.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    const n = (b) => (b ? 1 : 0);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Places where the build token can be read (out of 3)',
        unit: 'of 3',
        bars: [
          { label: 'original (ARG)', value: n(leaky.scan.history) + n(leaky.scan.config) + n(leaky.scan.layers) },
          { label: 'yours (build secret)', value: n(fixed.scan.history) + n(fixed.scan.config) + n(fixed.scan.layers) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c3.p4');
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

