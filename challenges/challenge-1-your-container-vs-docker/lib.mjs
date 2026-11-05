// Shared helpers for the three parts of challenge 1.
// A throw-away "host" container stands in for the Linux machine where you built mini-container.sh.
// Your container (made by mini-container.sh) runs inside it, next to a normal Docker container.
//
// Everything is named dkr-c1-... and labelled dkr.challenge=1, so `node toolkit/cleanup.mjs 1` removes it.

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, label, name, safeArgs, waitFor } from '../../toolkit/docker.js';

export const N = 1;
export const IMAGE = 'dkr-c1-daftar:1'; // daftar-api plus probe.mjs, built from node:24-alpine
export const HOST = name(N, 'host');
export const ROOTFS_VOLUME = name(N, 'rootfs');
export const UBUNTU = 'ubuntu:24.04';
export const ALPINE = 'alpine:3.23';

const here = dirname(fileURLToPath(import.meta.url));
const mini = join(here, 'mini');
const repoRoot = join(here, '..', '..');

/** True when the scripts and tests should use each part's reference/ folder instead of the starter files. */
export const useReference = process.env.DKR_TARGET === 'reference';
/** The folder with the files the learner edits (the part folder, or its reference/ folder). */
export const workDir = (partDir) => (useReference ? join(partDir, 'reference') : partDir);

export function docker(args, opts = {}) {
  const r = run(args, opts);
  if (r.code !== 0) throw new Error(`docker ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** Build the image: daftar-api plus the probe, from a temporary folder. Returns the image size in bytes. */
export function buildImage() {
  const ctx = mkdtempSync(join(tmpdir(), 'dkr-c1-'));
  try {
    cpSync(join(repoRoot, 'daftar-api', 'server.mjs'), join(ctx, 'server.mjs'));
    cpSync(join(repoRoot, 'daftar-api', 'package.json'), join(ctx, 'package.json'));
    cpSync(join(mini, 'probe.mjs'), join(ctx, 'probe.mjs'));
    cpSync(join(mini, 'Dockerfile'), join(ctx, 'Dockerfile'));
    docker(['build', '--quiet', '--label', 'dkr.challenge=1', '-t', IMAGE, ctx], { timeoutMs: 300_000 });
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }
  return Number(docker(['image', 'inspect', IMAGE, '--format', '{{.Size}}']).trim());
}

/** Remove the image tag we built. Only this one tag. */
export function removeImage() {
  run(['image', 'rm', IMAGE]);
}

/**
 * Start the throw-away host and fill its root file system folder from the image.
 * The host has two extra capabilities (SYS_ADMIN, NET_ADMIN) and a seccomp profile that also allows
 * pivot_root: Docker's default profile blocks it. It is NOT --privileged, and it has no Docker socket.
 */
export function startHost({ memory = '256m', pids = 200 } = {}) {
  docker(['volume', 'create', ...label(N), ROOTFS_VOLUME]);
  docker([
    'run', '-d',
    ...safeArgs(N, 'host', { memory, pids, tmpMb: 16 }),
    '--cap-add', 'SYS_ADMIN',
    '--cap-add', 'NET_ADMIN',
    '--security-opt', `seccomp=${join(mini, 'seccomp-pivot-root.json')}`,
    '-v', `${ROOTFS_VOLUME}:/rootfs`,
    UBUNTU, 'sleep', '3600',
  ]);
  docker(['cp', join(mini, 'mini-container.sh'), `${HOST}:/usr/local/bin/mini-container.sh`]);
  docker(['exec', HOST, 'mini-container.sh', 'prepare']);
  const ctr = docker(['create', '--label', 'dkr.challenge=1', '--name', name(N, 'export'), IMAGE]).trim();
  return new Promise((resolve, reject) => {
    const exp = spawn('docker', ['export', ctr], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const tar = spawn('docker', ['exec', '-i', HOST, 'tar', '-x', '-C', '/rootfs'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    exp.stdout.pipe(tar.stdin);
    let err = '';
    exp.stderr.on('data', (d) => (err += d));
    tar.stderr.on('data', (d) => (err += d));
    tar.on('close', (code) => {
      run(['rm', '-f', ctr]);
      code === 0 ? resolve() : reject(new Error(`could not fill the root file system: ${err.trim()}`));
    });
  });
}

/** Run mini-container.sh inside the host. */
export function miniScript(args, opts = {}) {
  return run(['exec', HOST, 'mini-container.sh', ...args], opts);
}

/** Start your container: daftar-api in a hand-made container. Returns the host pid of its PID 1. */
export function miniStart({ ctr, memBytes = 134217728, pids = 64, num = 1, env = '' }) {
  const cmd = `${env}cd /app && exec node server.mjs`;
  const r = miniScript(['run', ctr, '/rootfs', String(memBytes), String(pids), String(num), 'sh', '-c', cmd], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`mini-container.sh run failed: ${(r.stderr || r.stdout).trim()}`);
  return Number(r.stdout.trim().split('\n').pop());
}

/** Wait until daftar-api inside your container answers /health. */
export async function miniWaitHealthy(ctr, timeoutMs = 20_000) {
  await waitFor(() => miniScript(['exec', ctr, 'wget', '-qO-', 'http://127.0.0.1:8080/health']).code === 0, {
    timeoutMs,
    intervalMs: 150,
    what: `${ctr} to answer /health`,
  });
}

/** GET a path from inside your container, return the text. */
export function miniGet(ctr, path) {
  const r = miniScript(['exec', ctr, 'wget', '-qO-', `http://127.0.0.1:8080${path}`]);
  return { code: r.code, text: r.stdout.trim() };
}

export function miniStop(ctr) {
  return miniScript(['stop', ctr, '/rootfs'], { timeoutMs: 60_000 });
}

/** Run the probe inside your container, or inside a Docker container. Returns the parsed JSON. */
export function probeMini(ctr) {
  const r = miniScript(['exec', ctr, 'node', '/app/probe.mjs']);
  if (r.code !== 0) throw new Error(`probe failed in ${ctr}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout.trim());
}
export function probeDocker(ctr) {
  const r = run(['exec', ctr, 'node', '/app/probe.mjs']);
  if (r.code !== 0) throw new Error(`probe failed in ${ctr}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout.trim());
}

/** Namespace links of PID 1 of the host container, as the host sees them. */
export function hostNamespaces() {
  const r = docker(['exec', HOST, 'sh', '-c', 'for f in /proc/1/ns/*; do echo "$(basename $f) $(readlink $f)"; done']);
  return Object.fromEntries(r.trim().split('\n').map((l) => l.split(' ')));
}

/** Names of the namespace types where `ns` differs from `base`. */
export function newNamespaces(ns, base) {
  return Object.keys(ns)
    .filter((k) => !k.endsWith('_for_children') && ns[k] !== base[k])
    .sort();
}

/** The host port Docker published for a container's 8080, on 127.0.0.1. */
export function publishedPort(ctr) {
  const r = docker(['port', ctr, '8080/tcp']).trim().split('\n')[0];
  return Number(r.split(':').pop());
}

/** Wait until a Docker container answers /health on its published port. */
export async function dockerWaitHealthy(ctr, timeoutMs = 20_000) {
  await waitFor(
    async () => {
      const res = await fetch(`http://127.0.0.1:${publishedPort(ctr)}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    },
    { timeoutMs, intervalMs: 150, what: `${ctr} to answer /health` },
  );
}

/** Count set bits in a hex capability mask such as "00000000a80425fb". */
export function popcountHex(hex) {
  return [...BigInt(`0x${hex.trim()}`).toString(2)].filter((b) => b === '1').length;
}

export function mkdir(p) {
  mkdirSync(p, { recursive: true });
}
