// Measure what `docker stop` does to a container. Used by run.mjs and test.mjs. Provided, nothing to edit.
//
// The test is the same for every variant: start the container, wait until it answers /health, run
// `docker stop` with no options (the default grace period), and time it. Then read the exit code and
// the service's own log, which prints a "shutdown" line when it receives SIGTERM.

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

import { run, safeArgs } from '../../../toolkit/docker.js';
import { median } from '../../../toolkit/stats.js';
import { N, docker, makeAppContext, waitHealthy } from '../lib/common.mjs';

/** A build context: daftar-api plus the given files copied from `fromDir`. */
export function makeContext(dir, fromDir, files) {
  makeAppContext(dir);
  for (const f of files) copyFileSync(join(fromDir, f), join(dir, f));
  return dir;
}

/** Start, wait, stop, measure. Returns { pid1, stopMs, exitCode, graceful, prepared }. */
export async function measureStop(tag, label, { init = false } = {}) {
  const ctr = `dkr-c3-p2-${label}`;
  try {
    docker(['run', '-d', ...safeArgs(N, `p2-${label}`, { memory: '96m' }), ...(init ? ['--init'] : []), tag]);
    await waitHealthy(ctr);
    const pid1 = run(['exec', ctr, 'sh', '-c', 'tr "\\0" " " < /proc/1/cmdline']).stdout.trim();
    const t0 = process.hrtime.bigint();
    run(['stop', ctr], { timeoutMs: 120_000 });
    const stopMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const exitCode = Number(docker(['inspect', ctr, '--format', '{{.State.ExitCode}}']).trim());
    const logs = run(['logs', ctr]);
    const text = `${logs.stdout}\n${logs.stderr}`;
    return {
      pid1,
      stopMs,
      exitCode,
      graceful: text.includes('"event":"shutdown"') && text.includes('"signal":"SIGTERM"'),
      prepared: text.includes('entrypoint: preparing'),
    };
  } finally {
    run(['rm', '-f', '-v', ctr]);
  }
}

/** The median of `times` measurements. Returns the middle result by stop time. */
export async function measureMedian(tag, label, opts, times = 3) {
  const all = [];
  for (let i = 0; i < times; i++) all.push(await measureStop(tag, label, opts));
  all.sort((a, b) => a.stopMs - b.stopMs);
  const mid = all[Math.floor(all.length / 2)];
  return { ...mid, stopMs: median(all.map((a) => a.stopMs)), all };
}
