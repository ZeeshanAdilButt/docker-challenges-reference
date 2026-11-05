// Small helpers shared by the three parts of challenge 8. Plain Node, no packages.

import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../toolkit/docker.js';

export const CHALLENGE = 8;
export const PROJECT = 'dkr-c8';
export const STACK_IMAGE = 'dkr-c8-stack:1';
export const stackDir = join(dirname(fileURLToPath(import.meta.url)), 'stack');

/** True when the part should use its reference/ folder instead of the files you edit. */
export const useReference = () => process.argv.includes('--reference') || process.env.DKR_USE_REFERENCE === '1';

/** The folder that holds the files being tested: the part folder, or its reference/ folder. */
export const filesDir = (here) => (useReference() ? join(here, 'reference') : here);

/** Show an argument list the way you would type it. */
export const show = (args, bin = 'docker') => `${bin} ${args.map((a) => (/[\s{}"|;&]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run docker and return trimmed stdout. Throws with the error text when it fails. */
export function docker(args, opts = {}) {
  const r = run(args, opts);
  if (r.code !== 0) throw new Error(`${show(args)} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** docker exec in a container. Returns { ok, out, ms }. Never throws. */
export function exec(container, cmd, opts = {}) {
  const t0 = process.hrtime.bigint();
  const r = run(['exec', container, ...cmd], opts);
  return { ok: r.code === 0, out: `${r.stdout}${r.stderr}`.trim(), ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

/** A free TCP port on 127.0.0.1, from the high range. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** `docker compose -p <project> -f <file> <args>` with extra environment variables. Never throws. */
export function compose(file, args, env = {}, opts = {}) {
  return run(['compose', '-p', PROJECT, '-f', file, ...args], { ...opts, env });
}

/** Same as compose() but throws on a non-zero exit and returns trimmed stdout. */
export function composeOk(file, args, env = {}, opts = {}) {
  const r = compose(file, args, env, opts);
  if (r.code !== 0) throw new Error(`docker compose ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** Build the shared stack image from stack/. */
export function buildStackImage() {
  return docker(['build', '-q', '-t', STACK_IMAGE, '--label', `dkr.challenge=${CHALLENGE}`, stackDir], { timeoutMs: 240_000 });
}

/** Remove the stack image. It is ours: we built it with a name that starts with dkr-c8. */
export function removeStackImage() {
  return run(['image', 'rm', STACK_IMAGE]);
}

/** GET a URL and return { status, json, text, ms }. status is 0 when nothing answered. */
export async function get(url, { method = 'GET', timeoutMs = 3000 } = {}) {
  const t0 = process.hrtime.bigint();
  // a timer that keeps the process alive (AbortSignal.timeout does not), so a stuck request cannot end the script
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
  try {
    const res = await fetch(url, { method, signal: ac.signal });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, ms: ms() };
  } catch (e) {
    return { status: 0, text: String(e.cause?.code ?? e.message), ms: ms() };
  } finally {
    clearTimeout(timer);
  }
}

/** Call fn() every intervalMs until it returns something truthy or timeoutMs passes. Returns { value, ms }. */
export async function pollUntil(fn, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const t0 = process.hrtime.bigint();
  for (;;) {
    const value = await fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (value) return { value, ms };
    if (ms >= timeoutMs) return { value: false, ms };
    await sleep(intervalMs);
  }
}

/** Names of the volumes mounted on the containers of the project (so we can remove exactly those at the end). */
export function projectVolumes() {
  const ids = run(['ps', '-a', '-q', '--filter', `label=com.docker.compose.project=${PROJECT}`]).stdout.split('\n').filter(Boolean);
  if (!ids.length) return [];
  const out = run(['inspect', '--format', '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\\n"}}{{end}}{{end}}', ...ids]).stdout;
  return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
}
