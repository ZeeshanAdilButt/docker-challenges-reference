// Shared helpers for challenge 10. Plain Node, no packages.
// Every container is named dkr-c10-... and labelled dkr.challenge=10 (through safeArgs).
// Nothing here fills the host: every container has a memory cap of 64 MB or less,
// a process cap, a small tmpfs and a log cap.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, safeArgs, name } from '../../toolkit/docker.js';

export const CHALLENGE = 10;
export const NODE_IMAGE = 'node:24-alpine';
export const ALPINE_IMAGE = 'alpine:3.23';
export const MEMORY = '64m';

/** True when the caller asked for the reference files (run.mjs --reference, or DKR_TARGET=reference in tests). */
export const wantReference = () => process.argv.includes('--reference') || process.env.DKR_TARGET === 'reference';

/** The folder with the files to use: the part folder itself, or its reference/ folder. */
export const targetDir = (here) => (wantReference() ? join(here, 'reference') : here);

/** Show an argument list the way you would type it. */
export const show = (args) => `docker ${args.map((a) => (/[\s{}"$]/.test(a) ? (/[$"]/.test(a) ? `'${a}'` : `"${a}"`) : a)).join(' ')}`;

/** Run docker and return stdout. Throws with the error text when docker fails. */
export function docker(args, opts) {
  const r = run(args, opts);
  if (r.code !== 0) throw new Error(`${show(args)} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** Remove one container of ours by its full name. Never a wildcard. */
export const removeByName = (what) => run(['rm', '-f', '-v', name(CHALLENGE, what)]);

const workerSource = readFileSync(new URL('./worker.mjs', import.meta.url), 'utf8');
export { workerSource };

/**
 * Run one piece of work from worker.mjs inside a capped node container.
 * limits: { heap_mb, pids, nofile } (a 0 or missing value means "leave Docker's default").
 * Returns what happened, read from the container after it stopped.
 */
export function runWorker(work, limits = {}, { memory = MEMORY, tag = work } = {}) {
  const what = `w-${tag}`;
  removeByName(what);
  const args = ['run', '-i', ...safeArgs(CHALLENGE, what, { memory, pids: limits.pids || 50 }), '-e', `WORK=${work}`];
  if (limits.nofile) args.push('--ulimit', `nofile=${limits.nofile}:${limits.nofile}`);
  if (limits.heap_mb) args.push('-e', `NODE_OPTIONS=--max-old-space-size=${limits.heap_mb}`);
  args.push(NODE_IMAGE, 'node', '-');
  const t0 = process.hrtime.bigint();
  const r = run(args, { input: workerSource, timeoutMs: 120_000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const state = run(['inspect', name(CHALLENGE, what), '--format', '{{.State.ExitCode}} {{.State.OOMKilled}}']).stdout.trim().split(' ');
  removeByName(what);
  const events = r.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('{'))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    });
  const last = (key) => [...events].reverse().find((e) => key in e)?.[key];
  const text = `${r.stdout}\n${r.stderr}`;
  return {
    exit: Number(state[0]),
    oomKilled: state[1] === 'true',
    heapAbort: /JavaScript heap out of memory/.test(text),
    heldMb: last('held_mb'),
    children: last('children'),
    forkError: events.find((e) => 'children' in e)?.error ?? null,
    files: last('files'),
    fileError: events.find((e) => 'files' in e)?.error ?? null,
    legitOk: events.some((e) => e.legit === 'ok') && last('children') === 3 && last('files') === 20 && last('held_mb') === 8,
    ms,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

/** One word for how a run ended. */
export function verdict(r) {
  if (r.oomKilled) return `killed by the kernel (OOMKilled, exit ${r.exit})`;
  if (r.heapAbort) return `stopped by V8 heap limit (exit ${r.exit}), the kernel did not kill it`;
  if (r.exit === 0) return 'finished (exit 0)';
  return `exit ${r.exit}`;
}

/** Limits you must reach in part 1. The numbers are in the README. */
export const GOALS = {
  heapAbortBefore: 'the kernel kills it: the runaway JavaScript job must stop by V8, not by OOMKilled',
  maxChildren: 17, // the fork loop may start at most 17 helper processes
  maxFiles: 256, // the file loop may open at most 256 files
};

/** Run the four checks of part 1 against a limits object. Returns [{ id, ok, text }]. */
export function gradeLimits(limits) {
  const checks = [];
  const add = (id, ok, text) => checks.push({ id, ok, text });

  const legit = runWorker('legit', limits, { tag: 'grade-legit' });
  add('legit job still works', legit.legitOk, legit.legitOk ? 'the real job held 8 MB, started 3 helpers and opened 20 files' : `the real job broke: ${verdict(legit)}; held ${legit.heldMb ?? 0} MB, helpers ${legit.children ?? 0}, files ${legit.files ?? 0}`);

  const leak = runWorker('heap-leak', limits, { tag: 'grade-heap' });
  add('runaway heap stops before the kernel', !leak.oomKilled && leak.heapAbort, `heap leak: ${verdict(leak)} after ${leak.heldMb ?? 0} MB`);

  const fork = runWorker('fork', limits, { tag: 'grade-fork' });
  add('fork loop is contained', fork.forkError === 'EAGAIN' && fork.children <= GOALS.maxChildren, `fork loop started ${fork.children} helpers (error ${fork.forkError}); goal: at most ${GOALS.maxChildren}`);

  const fds = runWorker('fds', limits, { tag: 'grade-fds' });
  add('open-file leak is contained', fds.fileError === 'EMFILE' && fds.files <= GOALS.maxFiles, `file loop opened ${fds.files} files (error ${fds.fileError}); goal: at most ${GOALS.maxFiles}`);
  return checks;
}

// ---------------------------------------------------------------------------
// Part 2 helpers: logs and disk growth
// ---------------------------------------------------------------------------

/** Same cage as safeArgs() but WITHOUT the log options, so a part can choose its own logging. */
export function cageArgs(what, { memory = MEMORY, pids = 50, tmpMb = 16 } = {}) {
  return ['--name', name(CHALLENGE, what), '--label', `dkr.challenge=${CHALLENGE}`, '--memory', memory, '--memory-swap', memory, '--pids-limit', String(pids), '--tmpfs', `/tmp:rw,size=${tmpMb}m`, '--security-opt', 'no-new-privileges'];
}

/** "2m" gives 2097152. Docker reads k, m and g as powers of 1024. Returns NaN for text it does not know. */
export function parseSizeSpec(text) {
  const m = /^(\d+)\s*([kmg]?)b?$/i.exec(String(text).trim());
  if (!m) return NaN;
  return Number(m[1]) * { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase()];
}

export const LOG_LINES = 55000; // 55000 lines of about 220 bytes is about 12 MB
export const LOG_BUDGET_BYTES = 8 * 1024 * 1024;
const PAD = 'x'.repeat(200);
export const lineNo = (i) => `line ${String(i).padStart(7, '0')}`;

/** Build the docker log flags for a settings object { driver, max_size, max_file }. */
export function logFlags(log) {
  const flags = ['--log-driver', log.driver || 'json-file'];
  if (log.max_size) flags.push('--log-opt', `max-size=${log.max_size}`);
  if (log.max_file) flags.push('--log-opt', `max-file=${log.max_file}`);
  return flags;
}

/**
 * Start a container that prints LOG_LINES lines, wait for it to finish, and measure the log.
 * Returns { id, emittedBytes, disk: [{ file, bytes }], diskBytes, keptLines, firstKept, lastKept, newestKept, seconds }.
 * The container is removed before this returns.
 */
export function emitLogs(what, log) {
  removeByName(what);
  const script = `awk 'BEGIN{for(i=1;i<=${LOG_LINES};i++) printf "line %07d ${PAD}\\n", i}'`;
  const t0 = process.hrtime.bigint();
  const id = docker(['run', '-d', ...cageArgs(what), ...logFlags(log), ALPINE_IMAGE, 'sh', '-c', script]).trim();
  run(['wait', id], { timeoutMs: 120_000 });
  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const emittedBytes = LOG_LINES * (`line 0000000 ${PAD}`.length + 1);
  const logs = run(['logs', id], { timeoutMs: 120_000 });
  const kept = `${logs.stdout}${logs.stderr}`.split(/\r?\n/).filter((l) => l.startsWith('line '));
  const lineOf = (l) => (l ? Number(l.slice(5, 12)) : null);
  const disk = logFilesOnDisk(id);
  const result = {
    id,
    emittedBytes,
    disk,
    diskBytes: disk.reduce((s, f) => s + f.bytes, 0),
    keptLines: kept.length,
    firstKept: lineOf(kept[0]),
    lastKept: lineOf(kept[kept.length - 1]),
    newestKept: lineOf(kept[kept.length - 1]) === LOG_LINES,
    seconds,
  };
  removeByName(what);
  return result;
}

/**
 * Size of every log file of one container. We bind-mount that one container's folder, read only,
 * into a throwaway alpine container. On Docker Desktop the path is inside the Linux virtual machine.
 * Returns [] when the folder cannot be read (for example rootless Docker).
 */
export function logFilesOnDisk(id) {
  const r = run(['run', '--rm', ...cageArgs('logsize'), '-v', `/var/lib/docker/containers/${id}:/log:ro`, ALPINE_IMAGE, 'sh', '-c', 'for f in /log/*-json.log* /log/local-logs/*; do [ -f "$f" ] && echo "$(basename $f) $(stat -c %s $f)"; done']);
  removeByName('logsize');
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [file, bytes] = l.split(' ');
      return { file, bytes: Number(bytes) };
    });
}

/**
 * Write to a tmpfs of tmpMb megabytes inside a 64 MB container.
 * mb is how much the writer tries to write. Returns { wrote, enospc, oomKilled, exit, memoryCurrentMb }.
 */
export function tmpfsWriter(what, tmpMb, mb) {
  removeByName(what);
  const script = `dd if=/dev/zero of=/scratch/f bs=1M count=${mb} 2>/dev/null; echo "exit_dd=$?"; echo "wrote=$(stat -c %s /scratch/f)"; echo "mem=$(cat /sys/fs/cgroup/memory.current)"`;
  const r = run(['run', ...cageArgs(what), '--tmpfs', `/scratch:rw,size=${tmpMb}m`, '--log-opt', 'max-size=1m', ALPINE_IMAGE, 'sh', '-c', script]);
  const st = run(['inspect', name(CHALLENGE, what), '--format', '{{.State.ExitCode}} {{.State.OOMKilled}}']).stdout.trim().split(' ');
  removeByName(what);
  const num = (key) => Number((new RegExp(`${key}=([0-9]+)`).exec(r.stdout) ?? [])[1]);
  const ddExit = num('exit_dd');
  return {
    exit: Number(st[0]),
    oomKilled: st[1] === 'true',
    enospc: ddExit > 0,
    wroteMb: Number.isFinite(num('wrote')) ? Math.round(num('wrote') / 1048576) : null,
    memoryCurrentMb: Number.isFinite(num('mem')) ? Math.round(num('mem') / 1048576) : null,
  };
}

/** Check the settings of part 2 against its goals. Returns [{ id, ok, text }]. */
export function gradeSettings(settings) {
  const checks = [];
  const add = (id, ok, text) => checks.push({ id, ok, text });
  const log = settings.log ?? {};

  const per = parseSizeSpec(log.max_size);
  const total = per * Number(log.max_file);
  add('log rotation is set', Number.isFinite(total) && Number(log.max_file) >= 2 && total <= LOG_BUDGET_BYTES, `max_size ${JSON.stringify(log.max_size)} times max_file ${JSON.stringify(log.max_file)} must be at most 8 MiB and max_file at least 2`);

  const e = emitLogs('grade-logs', log);
  add('log disk use stays inside the budget', e.diskBytes > 0 && e.diskBytes <= LOG_BUDGET_BYTES, `the log files hold ${(e.diskBytes / 1048576).toFixed(1)} MiB after about 12 MB of output; budget is 8 MiB${e.diskBytes === 0 ? ' (could not read the log folder)' : ''}`);
  add('newest log line is kept', e.newestKept, `last kept line is ${e.lastKept}; the program printed ${LOG_LINES} lines`);

  const legit = tmpfsWriter('grade-scratch-ok', settings.tmpfs_mb, 10);
  add('scratch space fits the real job', legit.exit === 0 && legit.wroteMb === 10, `a 10 MB scratch file ${legit.wroteMb === 10 ? 'was written' : 'could not be written'} with tmpfs_mb ${settings.tmpfs_mb}`);
  const runaway = tmpfsWriter('grade-scratch-run', settings.tmpfs_mb, 100);
  add('runaway writer gets "no space", not a kill', !runaway.oomKilled && runaway.enospc, `a 100 MB writer ${runaway.oomKilled ? 'was killed by the kernel (OOMKilled)' : runaway.enospc ? `stopped at ${runaway.wroteMb} MB with "no space left"` : 'was not stopped'}`);
  return { checks, emit: e, legit, runaway };
}
