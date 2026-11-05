// Challenge 13, part 1: build, check, push. The pipeline on your machine.
// Run: node challenges/challenge-13-ship-it/part-1-build-check-push/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).
//
// The GitHub run is your own: this machine cannot run Actions and does not log in to GHCR.
// The local equivalent runs the same stages in the same order against a registry on your machine.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { checkWorkflow, clip, kit, pick, plantFault, removeTree, clearFacts, saveFacts, secs, short } from '../kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', 'app');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 13, part 1: build, check, push');
const k = kit(13);
const facts = {};
const REPO = 'dkr-c13/api';
const GOOD = { sha: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', version: '1.0.0' };
const BAD = { sha: 'badbadbadbadbadbadbadbadbadbadbadbadbad0', version: '1.0.1' };

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const table = (res) =>
  res.stages.map((s) => `${s.name.padEnd(6)} ${s.status.padEnd(8)} ${String(secs(s.ms)).padStart(5)} s  ${s.detail}`).join('\n');
const pad = (s, n) => String(s).padEnd(n);

try {
  clearFacts('c13.p1.'); // a failed run must not leave the numbers of an older run behind
  k.teardown(); // leftovers from an earlier run
  k.removeImages();
  const config = JSON.parse(readFileSync(pick(here, 'pipeline.json'), 'utf8'));
  const reg = await k.startRegistry();

  // Step 1: the workflow file, read as text.
  const wfFile = pick(here, 'workflow/ship.yml');
  const wf = checkWorkflow(wfFile);
  Object.entries({
    actions_count: wf.actions,
    unpinned_count: wf.unpinned,
    write_all: wf.writeAll,
    pull_request_target: wf.pullRequestTarget,
    push_guarded: wf.pushGuarded,
    push_always: wf.pushAlways,
    hardcoded_secret: wf.hardcodedSecret,
    uses_github_token: wf.usesGithubToken,
    prints_digest: wf.printsDigest,
    deploy_needs_build: wf.deployNeedsBuild,
    has_test_step: wf.hasTestStep,
    has_scan_sbom_sign: wf.hasScan && wf.hasSbom && wf.hasSign,
    least_privilege_jobs: wf.permissionBlocks >= 2 && !wf.writeAll,
  }).forEach(([key, v]) => (facts[`c13.p1.workflow_${key}`] = v));
  const wfOk = wf.unpinned === 0 && !wf.writeAll && !wf.pullRequestTarget && wf.pushGuarded && wf.usesGithubToken && wf.printsDigest && wf.hasTestStep;
  rec.step(
    'grep -nE "uses:|permissions|pull_request|push:|password:|needs:|target:" workflow/ship.yml',
    clip(
      readFileSync(wfFile, 'utf8')
        .split(/\r?\n/)
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => /^\s*-?\s*(uses:|permissions|push:|password:|needs:|target:)|pull_request/.test(l) && !/^\s*#/.test(l))
        .map(([i, l]) => `${String(i).padStart(3)}: ${l.trim().replace(/^- /, '')}`)
        .join('\n'),
      25,
    ),
    wfOk
      ? 'Every action is pinned to a full commit, permissions are narrow per job, nothing is pushed from a pull request, the built-in token is used and the deploy job gets a digest. The GitHub run is your own.'
      : `The workflow trusts too much: ${wf.unpinned} action(s) not pinned to a commit, write-all ${wf.writeAll}, pull_request_target ${wf.pullRequestTarget}, push guarded ${wf.pushGuarded}.`,
  );

  // Step 2: the pipeline on a good commit.
  const good = await k.runPipeline({ config, dir: app, repo: REPO, ...GOOD });
  facts['c13.p1.good_run_ok'] = good.ok;
  facts['c13.p1.good_stages_ok_count'] = good.stages.filter((s) => s.status === 'ok').length;
  facts['c13.p1.good_stages_skipped_count'] = good.stages.filter((s) => s.status === 'skipped').length;
  facts['c13.p1.good_pushed_tags_count'] = good.pushed.length;
  facts['c13.p1.good_digest'] = good.digest ?? 'none';
  facts['c13.p1.good_pipeline_s'] = secs(good.stages.reduce((a, s) => a + s.ms, 0));
  const order = config.stages;
  const idx = (s) => order.indexOf(s);
  facts['c13.p1.tests_before_push'] = idx('test') >= 0 && idx('push') >= 0 && idx('test') < idx('push');
  facts['c13.p1.scan_before_push'] = idx('scan') >= 0 && idx('push') >= 0 && idx('scan') < idx('push');
  facts['c13.p1.sign_after_push'] = idx('sign') > idx('push') && idx('push') >= 0;
  facts['c13.p1.lint_first'] = order[0] === 'lint';
  rec.step(
    `local pipeline, commit ${GOOD.sha.slice(0, 7)} (good):  stages ${order.join(' > ')}   tags ${JSON.stringify(config.tags)}`,
    table(good),
    good.ok ? (facts['c13.p1.good_stages_skipped_count'] > 0 ? `The commit passed every stage that ran. ${facts['c13.p1.good_stages_skipped_count']} stage(s) say "skipped" because the tool of challenge 12 is not wired in. The image is in the registry as ${short(good.digest)}.` : `The commit passed every stage. scan, sbom and sign ran the tools of challenge 12: the scanner pinned by digest, an SPDX SBOM, and a signature made with a throwaway key and checked before the stage ended. The image is in the registry as ${short(good.digest)}.`) : `The pipeline stopped at ${good.failedAt}.`,
  );

  // Step 3: the same pipeline on a bad commit (a change that breaks /health, so the unit tests fail).
  const before = new Set((await Promise.all((await k.tagsOf(REPO)).map((t) => k.digestOf(REPO, t)))).filter(Boolean));
  const badDir = plantFault(app, 'health-500');
  let bad;
  try {
    bad = await k.runPipeline({ config, dir: badDir, repo: REPO, ...BAD });
  } finally {
    removeTree(badDir);
  }
  const afterTags = await k.tagsOf(REPO);
  const afterDigests = new Map((await Promise.all(afterTags.map(async (t) => [t, await k.digestOf(REPO, t)]))));
  const newDigests = [...new Set(afterDigests.values())].filter((d) => d && !before.has(d));
  facts['c13.p1.bad_run_ok'] = bad.ok;
  facts['c13.p1.bad_failed_at'] = bad.failedAt ?? 'none';
  facts['c13.p1.bad_image_pushed'] = newDigests.length > 0;
  rec.step(
    `local pipeline, commit ${BAD.sha.slice(0, 7)} (bad: /health now answers 500)\n  then: GET /v2/${REPO}/tags/list`,
    `${table(bad)}\n\ntags in the registry: ${afterTags.join(', ') || '(none)'}\nnew images in the registry: ${newDigests.length}${newDigests.length ? ` (${newDigests.map(short).join(', ')})` : ''}`,
    newDigests.length === 0
      ? `The unit tests failed at "${bad.failedAt}" and nothing was pushed. A broken commit never reaches the registry.`
      : `The pipeline failed (at ${bad.failedAt}), but the broken image was already pushed. Anyone who pulls "${config.tags[0] === 'latest' ? 'latest' : 'the new tag'}" now gets a service whose /health answers 500.`,
  );

  // Step 4: what one tag rule does to a tag.
  const goodDigests = await Promise.all((good.tags ?? []).map(async (t) => [t, await k.digestOf(REPO, t)]));
  facts['c13.p1.tags_include_sha'] = (good.tags ?? []).some((t) => /^sha-[0-9a-f]{7}$/.test(t));
  facts['c13.p1.latest_only'] = (config.tags ?? []).length === 1 && config.tags[0] === 'latest';
  rec.step(
    `GET /v2/${REPO}/manifests/<tag>   for each tag of the good commit`,
    goodDigests.map(([t, d]) => `${pad(t, 14)} ${short(d)}`).join('\n') || '(no tags)',
    facts['c13.p1.tags_include_sha'] ? 'One image, several names. The sha tag says exactly which commit built it, and it is never moved.' : goodDigests.some(([, d]) => d !== good.digest) ? '"latest" now points at a different image than the one the good commit pushed. The name moved under you.' : '"latest" is the only name. It says nothing about the commit, and the next push moves it.',
  );

  // Step 5: how long the build takes cold and with the layer cache (median of 3 each).
  const cold = [];
  const warm = [];
  const buildArgs = { APP_VERSION: GOOD.version, GIT_SHA: GOOD.sha };
  for (let i = 0; i < 3; i++) {
    const c = k.build({ dir: app, tag: `${k.REPO_PREFIX}-timing:cold`, args: buildArgs, noCache: true });
    if (c.code !== 0) throw new Error(`timing build failed: ${c.stderr.trim().split('\n').slice(-3).join(' ')}`);
    cold.push(c.ms);
  }
  k.build({ dir: app, tag: `${k.REPO_PREFIX}-timing:warm`, args: buildArgs });
  for (let i = 0; i < 3; i++) warm.push(k.build({ dir: app, tag: `${k.REPO_PREFIX}-timing:warm`, args: buildArgs }).ms);
  facts['c13.p1.build_cold_s'] = round(median(cold) / 1000, 1);
  facts['c13.p1.build_warm_s'] = round(median(warm) / 1000, 1);
  // Count the steps that the cache answered: this does not depend on how fast the machine is today.
  const plain = run(['build', '--progress=plain', '--provenance=false', '--sbom=false', '--target', 'release', '--build-arg', 'APP_VERSION=' + GOOD.version, '--build-arg', 'GIT_SHA=' + GOOD.sha, '--label', 'dkr.challenge=13', '-t', k.REPO_PREFIX + '-timing:warm', app], { timeoutMs: 300_000 });
  facts['c13.p1.build_cache_hits_count'] = ((plain.stdout + plain.stderr).match(/^#\d+ CACHED/gm) ?? []).length;
  rec.step(
    'docker build --target release app   (3 times with --no-cache, 3 times with the layer cache; median of each)',
    `cold (no cache): ${facts['c13.p1.build_cold_s']} s   [${cold.map((m) => secs(m)).join(', ')}]\nwarm (cache):    ${facts['c13.p1.build_warm_s']} s   [${warm.map((m) => secs(m)).join(', ')}]\nsteps answered by the cache in a warm build: ${facts['c13.p1.build_cache_hits_count']}`,
    'Unchanged layers come from the cache, so a build after a one-line change is fast. In GitHub Actions the layer cache is lost between runs unless you ask for one (cache-from and cache-to with type=gha).',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Where the time goes in one pipeline run (seconds)',
        unit: 's',
        bars: [
          ...good.stages.filter((s) => s.status === 'ok').map((s) => ({ label: s.name, value: secs(s.ms) })),
          { label: 'build, no cache', value: facts['c13.p1.build_cold_s'] },
          { label: 'build, cached', value: facts['c13.p1.build_warm_s'] },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nGood commit: ${good.ok ? 'passed' : 'failed'}. Bad commit: failed at ${bad.failedAt ?? '(it passed)'}; bad image pushed: ${facts['c13.p1.bad_image_pushed']}.`);
  console.log('See your numbers with: node toolkit/show-facts.mjs c13.p1');
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
