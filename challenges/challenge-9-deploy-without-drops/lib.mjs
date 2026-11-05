// Small helpers shared by the three parts of challenge 9. Plain Node, no packages.

import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../toolkit/docker.js';

export const CHALLENGE = 9;
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const daftarDir = join(repoRoot, 'daftar-api');

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

/** Run a docker command and return how long it took in milliseconds, with its result. */
export function timedDocker(args, opts = {}) {
  const t0 = process.hrtime.bigint();
  const r = run(args, opts);
  return { ...r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
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

/** GET a URL and return { status, json, ms }. status is 0 when nothing answered. */
export async function get(url, { timeoutMs = 2000 } = {}) {
  const t0 = process.hrtime.bigint();
  // a timer that keeps the process alive (AbortSignal.timeout does not), so a stuck request cannot end the script
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
  try {
    const res = await fetch(url, { signal: ac.signal });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, ms: ms() };
  } catch (e) {
    return { status: 0, ms: ms() };
  } finally {
    clearTimeout(timer);
  }
}

/** Call fn() every intervalMs until it returns something truthy or timeoutMs passes. Returns { value, ms }. */
export async function pollUntil(fn, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const t0 = process.hrtime.bigint();
  for (;;) {
    const value = await fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (value) return { value, ms };
    if (ms >= timeoutMs) return { value: false, ms };
    await sleep(intervalMs);
  }
}

/** Build an image from daftar-api/ with the given Dockerfile. Labels it so it is clearly ours. */
export function buildDaftar(tag, dockerfile) {
  return docker(['build', '-q', '-t', tag, '-f', dockerfile, '--label', `dkr.challenge=${CHALLENGE}`, daftarDir], { timeoutMs: 240_000 });
}

/** Remove images by tag. They are ours: every tag starts with dkr-c9-. */
export function removeImages(tags) {
  for (const t of tags) run(['image', 'rm', t]);
}
