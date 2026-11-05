// Challenge 3, part 1: review and fix five Dockerfiles.
// Run: node challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It reviews the five original Dockerfiles in faults/ and the five you edited in dockerfiles/. For each one it
// lists what the reviewer sees, counts the warnings of `docker build --check`, builds it, and tests the thing
// its fault was about (user, cache, secret, PID 1, ignored files).

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, leftovers } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { N, workDir, tmp, rmTree, removeImages } from '../lib/common.mjs';
import { NAMES, makeContext, checkOne } from './checks.mjs';
import { review } from './review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 3, part 1: review and fix five Dockerfiles');
const work = tmp('p1');
const tags = [];

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

/** Warnings that `docker build --check` reports (it does not build and does not pull layers). */
function buildCheck(dockerfile, ctx) {
  const r = run(['build', '--check', '-f', dockerfile, ctx], { timeoutMs: 120_000 });
  const text = `${r.stdout}\n${r.stderr}`;
  const rules = [...text.matchAll(/WARNING: (\w+) /g)].map((m) => m[1]);
  return { count: rules.length, rules };
}

try {
  cleanup(N);
  const ctx = makeContext(join(work, 'ctx'));
  const before = join(here, 'faults');
  const after = join(workDir(here), 'dockerfiles');

  // Step 1: the reviewer on the originals.
  const reviewBefore = NAMES.map((n) => ({ n, findings: review(join(before, n, 'Dockerfile')) }));
  rec.step(
    'node review.mjs faults/<each Dockerfile>',
    reviewBefore.map((r) => `${r.n}\n${r.findings.map((f) => `   line ${f.line}: ${f.rule}`).join('\n') || '   no problems found'}`).join('\n'),
    'Five Dockerfiles, one main fault each. The reviewer reads the file; it does not run anything.',
  );

  // Step 2: what BuildKit's own checks say.
  const checkBefore = NAMES.map((n) => ({ n, ...buildCheck(join(before, n, 'Dockerfile'), ctx) }));
  rec.step(
    'docker build --check -f faults/<each>/Dockerfile .',
    checkBefore.map((c) => `${c.n.padEnd(20)} ${c.count} warning(s) ${c.rules.join(' ')}`).join('\n'),
    'BuildKit has built-in rules. They catch some faults (a secret in ENV, shell-form CMD) and miss others (a bad COPY order, running as root, an unpinned tag).',
  );

  // Step 3: build and test the originals.
  const resultsBefore = [];
  for (const n of NAMES) {
    const tag = `dkr-c3-p1-before-${n.slice(0, 2)}:1`;
    tags.push(tag);
    resultsBefore.push(await checkOne(n, join(before, n, 'Dockerfile'), ctx, tag));
  }
  rec.step(
    'build each original and test the property its fault was about',
    resultsBefore.map((r) => `${r.name.padEnd(20)} ${r.ok ? 'ok  ' : 'FAIL'} ${r.detail}`).join('\n'),
    'The originals that can be built all run and answer /health. Every one of them works, and every one is a problem waiting for a bad day. (01 is not built: its base image is not on this machine.)',
  );

  // Step 4: your fixes.
  const reviewAfter = NAMES.map((n) => ({ n, findings: review(join(after, n, 'Dockerfile')) }));
  const checkAfter = NAMES.map((n) => ({ n, ...buildCheck(join(after, n, 'Dockerfile'), ctx) }));
  const resultsAfter = [];
  for (const n of NAMES) {
    const tag = `dkr-c3-p1-after-${n.slice(0, 2)}:1`;
    tags.push(tag);
    resultsAfter.push(await checkOne(n, join(after, n, 'Dockerfile'), ctx, tag));
  }
  rec.step(
    'review, docker build --check, build and test, for dockerfiles/<each>/Dockerfile (your fixes)',
    NAMES.map((n, i) => `${n.padEnd(20)} reviewer ${reviewAfter[i].findings.length}  check ${checkAfter[i].count}  ${resultsAfter[i].ok ? 'ok  ' : 'FAIL'} ${resultsAfter[i].detail}`).join('\n'),
    'After the fixes: no reviewer findings, no warnings, and each property holds.',
  );

  // Facts.
  NAMES.forEach((n, i) => {
    const id = n.slice(0, 2);
    setFact(`c3.p1.f${id}_findings_before_count`, reviewBefore[i].findings.length);
    setFact(`c3.p1.f${id}_findings_after_count`, reviewAfter[i].findings.length);
    setFact(`c3.p1.f${id}_check_warnings_before_count`, checkBefore[i].count);
    setFact(`c3.p1.f${id}_check_warnings_after_count`, checkAfter[i].count);
    setFact(`c3.p1.f${id}_fixed_ok`, resultsAfter[i].ok);
    setFact(`c3.p1.f${id}_original_ok`, resultsBefore[i].ok);
  });
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
  setFact('c3.p1.findings_before_total', sum(reviewBefore, (r) => r.findings.length));
  setFact('c3.p1.findings_after_total', sum(reviewAfter, (r) => r.findings.length));
  setFact('c3.p1.check_warnings_before_total', sum(checkBefore, (c) => c.count));
  setFact('c3.p1.check_warnings_after_total', sum(checkAfter, (c) => c.count));
  setFact('c3.p1.fixed_ok_count', resultsAfter.filter((r) => r.ok).length);
  const i2 = NAMES.indexOf('02-cache-buster');
  setFact('c3.p1.rebuild_original_s', round((resultsBefore[i2].rebuildMs ?? 0) / 1000, 1));
  setFact('c3.p1.rebuild_fixed_s', round((resultsAfter[i2].rebuildMs ?? 0) / 1000, 1));
  setFact('c3.p1.pid1_original', resultsBefore[NAMES.indexOf('04-add-and-shell')].pid ?? -1);
  setFact('c3.p1.pid1_fixed', resultsAfter[NAMES.indexOf('04-add-and-shell')].pid ?? -1);

  removeImages(...tags);
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c3.p1.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}  and  docker image rm <the images this part built>`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone, including the image tags.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Problems found per Dockerfile: reviewer, before the fix',
        unit: 'findings',
        bars: NAMES.map((n, i) => ({ label: n, value: reviewBefore[i].findings.length })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c3.p1');
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
