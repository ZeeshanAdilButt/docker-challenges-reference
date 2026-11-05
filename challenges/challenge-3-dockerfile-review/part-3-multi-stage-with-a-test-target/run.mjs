// Challenge 3, part 3: multi-stage builds with a test target.
// Run: node challenges/challenge-3-dockerfile-review/part-3-multi-stage-with-a-test-target/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
//
// It builds the single-stage Dockerfile.single (the "before"), then your Dockerfile three ways:
//   --target test           must run the tests
//   --target test, failing  must stop when a test fails (it uses a copy of the code with one failing test)
//   default target          the runtime image: what ships
// and compares what is inside each.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { N, workDir, tmp, rmTree, removeImages, mb, build } from '../lib/common.mjs';
import { makeContext, withFailingTest, stagesOf, testsRun, rootBytes, inspectRuntime, healthy } from './checks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 3, part 3: multi-stage builds with a test target');
const work = tmp('p3');
const tags = [];
const tagged = (t) => (tags.push(t), t);

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const tail = (log, n = 6) => log.split('\n').filter(Boolean).slice(-n).join('\n');

try {
  cleanup(N);
  const ctx = makeContext(join(work, 'ctx'));
  const failing = withFailingTest(ctx);
  const dockerfile = join(workDir(here), 'Dockerfile');

  // Step 1: the single-stage image.
  const single = tagged('dkr-c3-p3-single:1');
  const b0 = build({ tag: single, dockerfile: join(here, 'Dockerfile.single'), context: ctx });
  if (b0.code !== 0) throw new Error(`build of Dockerfile.single failed:\n${tail(b0.out)}`);
  const singleBytes = rootBytes(single);
  const singleInside = inspectRuntime(single);
  rec.step(
    'docker build -f Dockerfile.single -t dkr-c3-p3-single:1 .   then   look inside',
    [
      `root file system: ${mb(singleBytes, 1)} MB`,
      `/app:  ${singleInside.app.join(' ')}`,
      `/opt:  ${singleInside.opt.join(' ')}`,
      `user id: ${singleInside.uid}`,
    ].join('\n'),
    'One stage, so the tests and the 30 MB toolchain that only the build needed are in the image that ships.',
  );

  // Step 2: your stages.
  const st = stagesOf(dockerfile);
  const testTag = tagged('dkr-c3-p3-test:1');
  const bt = build({ tag: testTag, dockerfile, context: ctx, target: 'test', args: ['--no-cache-filter', 'test'] });
  const ran = testsRun(bt.out);
  rec.step(
    'docker build --target test -f Dockerfile .',
    [
      `stages: ${st.count} (${st.names.map((n) => n ?? '(unnamed)').join(', ')}); last stage: ${st.last ?? '(unnamed)'}`,
      bt.code === 0 ? `build ok in ${round(bt.ms / 1000, 1)} s; node --test reported ${ran} tests` : `build failed: ${tail(bt.out, 3)}`,
    ].join('\n'),
    'A target builds only the stages it needs and stops there. Building the test stage runs the tests, and nothing is pushed.',
  );

  // Step 3: a failing test must stop the build.
  const bf = build({ tag: 'dkr-c3-p3-never:1', dockerfile, context: failing, target: 'test' });
  const blocked = bf.code !== 0 && /forced failure/.test(bf.out);
  rec.step(
    'docker build --target test -f Dockerfile <copy of the code with one failing test>',
    [`exit code ${bf.code}`, ...bf.out.split('\n').filter((l) => /forced failure|ERROR|failed to solve/.test(l)).slice(0, 3)].join('\n'),
    blocked ? 'The failing test failed the build. A CI job that runs this target stops here: nothing broken is built or pushed.' : 'The build did not stop for the failing test. Does the test stage RUN the tests?',
  );

  // Step 4: the runtime image.
  const runtimeTag = tagged('dkr-c3-p3-runtime:1');
  const br = build({ tag: runtimeTag, dockerfile, context: ctx });
  if (br.code !== 0) throw new Error(`build of the default target failed:\n${tail(br.out)}`);
  const rtBytes = rootBytes(runtimeTag);
  const inside = inspectRuntime(runtimeTag);
  const ok = await healthy(runtimeTag);
  rec.step(
    'docker build -f Dockerfile .   then   look inside',
    [
      `root file system: ${mb(rtBytes, 1)} MB (single stage: ${mb(singleBytes, 1)} MB)`,
      `/app:  ${inside.app.join(' ')}`,
      `/opt:  ${inside.opt.join(' ') || '(empty)'}`,
      `user id: ${inside.uid}   answers /health: ${ok}`,
    ].join('\n'),
    'The default target is the last stage. It has the service and nothing else. The toolchain and the tests stayed in the test stage.',
  );

  setFact('c3.p3.stage_count', st.count);
  setFact('c3.p3.has_test_stage', st.names.includes('test'));
  setFact('c3.p3.single_root_mb', mb(singleBytes, 1));
  setFact('c3.p3.runtime_root_mb', mb(rtBytes, 1));
  setFact('c3.p3.saved_mb', mb(singleBytes - rtBytes, 1));
  setFact('c3.p3.single_has_tests', singleInside.app.includes('test.mjs'));
  setFact('c3.p3.single_has_toolchain', singleInside.opt.includes('toolchain'));
  setFact('c3.p3.runtime_has_tests', inside.app.includes('test.mjs'));
  setFact('c3.p3.runtime_has_toolchain', inside.opt.includes('toolchain'));
  setFact('c3.p3.runtime_user_id', Number(inside.uid));
  setFact('c3.p3.runtime_healthy', ok);
  setFact('c3.p3.test_target_builds', bt.code === 0);
  setFact('c3.p3.test_target_tests_run_count', ran);
  setFact('c3.p3.test_target_build_s', round(bt.ms / 1000, 1));
  setFact('c3.p3.failing_test_blocks_build', blocked);

  removeImages(...tags.filter((t) => t !== 'dkr-c3-p3-never:1'));
  const left = leftovers(N);
  const leftCount = left.containers + left.networks + left.volumes;
  setFact('c3.p3.leftover_count', leftCount);
  rec.step(`node toolkit/cleanup.mjs ${N}  and  docker image rm <the images this part built>`, `Still labelled dkr.challenge=${N}: ${left.containers} containers, ${left.networks} networks, ${left.volumes} volumes.`, 'Everything this part made is gone, including the image tags.');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Root file system of the image that ships',
        unit: 'MB',
        bars: [
          { label: 'single stage', value: mb(singleBytes, 1) },
          { label: 'multi-stage runtime', value: mb(rtBytes, 1) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c3.p3');
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
