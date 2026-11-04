// Small Docker helpers for the challenges. Plain Node, no npm packages.
//
// Rules this file enforces for you:
//  - Everything a challenge creates is named dkr-c<N>-... and labelled dkr.challenge=<N>.
//  - cleanup(N) removes only objects with that label. It never prunes.

import { spawn, spawnSync } from 'node:child_process';

export const LABEL_KEY = 'dkr.challenge';

function defaults(opts) {
  return {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    windowsHide: true,
  };
}

/** Run `docker <args>` and wait. Returns { code, stdout, stderr }. Never throws. */
export function run(args, opts = {}) {
  const r = spawnSync('docker', args, {
    ...defaults(opts),
    encoding: 'utf8',
    input: opts.input,
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    const code = r.error.code === 'ETIMEDOUT' ? 124 : 127;
    return { code, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}${r.error.message}` };
  }
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Same as run(), but returns a promise. Never rejects. */
export function runAsync(args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (code, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr + extra });
    };
    const child = spawn('docker', args, { ...defaults(opts), stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      done(124, 'timed out');
    }, opts.timeoutMs ?? 120_000);
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('error', (e) => done(127, e.message));
    child.on('close', (code) => done(code ?? 1));
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input ?? '');
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Call fn() until it returns something truthy. Returns that value.
 * fn can be sync or async. Throws if timeoutMs passes first.
 */
export async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 200, what = 'condition' } = {}) {
  const start = Date.now();
  let lastError;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() - start >= timeoutMs) {
      const why = lastError ? ` Last error: ${lastError.message}` : '';
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.${why}`);
    }
    await sleep(intervalMs);
  }
}

function checkNumber(n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Challenge number must be a whole number, got ${JSON.stringify(n)}`);
  }
}

/** The label arguments to add to docker run, docker network create and docker volume create. */
export function label(n) {
  checkNumber(n);
  return ['--label', `${LABEL_KEY}=${n}`];
}

/** The name for something in challenge N: name(3, 'web') gives dkr-c3-web. */
export function name(n, what) {
  checkNumber(n);
  return `dkr-c${n}-${what}`;
}

/**
 * Flags that cap memory, processes and disk for one container.
 * Use them on every experiment: docker run ...safeArgs(0, 'hello') alpine:3.23 ...
 */
export function safeArgs(n, what, { memory = '64m', pids = 50, tmpMb = 16 } = {}) {
  return [
    '--name', name(n, what),
    ...label(n),
    '--memory', memory,
    '--memory-swap', memory,
    '--pids-limit', String(pids),
    '--tmpfs', `/tmp:rw,size=${tmpMb}m`,
    '--log-opt', 'max-size=1m',
    '--log-opt', 'max-file=2',
    '--security-opt', 'no-new-privileges',
  ];
}

const lines = (s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// Remove only ids whose label value really is n. The --filter already does this,
// the inspect check is a second lock on the door.
function labelled(listArgs, inspectArgs, labelPath, n) {
  const ids = lines(run(listArgs).stdout);
  if (ids.length === 0) return [];
  const fmt = `{{index ${labelPath} "${LABEL_KEY}"}}`;
  const out = lines(run([...inspectArgs, '--format', fmt, ...ids]).stdout);
  return ids.filter((_, i) => out[i] === String(n));
}

/**
 * Remove containers, networks and volumes labelled dkr.challenge=<n>. Nothing else.
 * Returns { containers, networks, volumes }: the ids that were removed.
 */
export function cleanup(n) {
  checkNumber(n);
  const filter = `label=${LABEL_KEY}=${n}`;
  const removed = { containers: [], networks: [], volumes: [] };

  const containers = labelled(['ps', '-a', '-q', '--filter', filter], ['inspect'], '.Config.Labels', n);
  if (containers.length) {
    run(['rm', '-f', '-v', ...containers]);
    removed.containers = containers;
  }

  const networks = labelled(['network', 'ls', '-q', '--filter', filter], ['network', 'inspect'], '.Labels', n);
  if (networks.length) {
    run(['network', 'rm', ...networks]);
    removed.networks = networks;
  }

  const volumes = labelled(['volume', 'ls', '-q', '--filter', filter], ['volume', 'inspect'], '.Labels', n);
  if (volumes.length) {
    run(['volume', 'rm', '-f', ...volumes]);
    removed.volumes = volumes;
  }
  return removed;
}

/** Count what is still labelled dkr.challenge=<n>. Useful to prove cleanup worked. */
export function leftovers(n) {
  checkNumber(n);
  const filter = `label=${LABEL_KEY}=${n}`;
  return {
    containers: lines(run(['ps', '-a', '-q', '--filter', filter]).stdout).length,
    networks: lines(run(['network', 'ls', '-q', '--filter', filter]).stdout).length,
    volumes: lines(run(['volume', 'ls', '-q', '--filter', filter]).stdout).length,
  };
}

/** Throw a friendly error if the Docker engine is not reachable. Returns the engine version. */
export function assertDocker() {
  const r = run(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 30_000 });
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  const first = (r.stderr || r.stdout).trim().split(/\r?\n/)[0] || 'no output';
  throw new Error(
    `Docker is not ready: ${first}\n` +
      'Start Docker Desktop (or the docker service), wait until it says running, then try again.',
  );
}
