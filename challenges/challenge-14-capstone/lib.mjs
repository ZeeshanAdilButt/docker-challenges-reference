// Helpers shared by the four parts of challenge 14 (the capstone). Plain Node, no packages.
//
// The system you work on is daftar-platform/ (api, worker, web, compose.yaml). Every part runs against YOUR files.
// Maintainers set DKR_USE_REFERENCE=1 (or pass --reference) to run the same part against a copy of the system with the
// fixed files of every part's reference/ folder laid over it.
//
// The single Docker-in-Docker production host (dkr-c14-prod, privileged on purpose, the one exception to the "no
// --privileged" rule, same as challenge 13) comes from ../challenge-13-ship-it/kit.mjs. Read its header for the reasons.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { label, run, safeArgs, waitFor } from '../../toolkit/docker.js';
import { kit, lastLines, sleep, secs, useReference } from '../challenge-13-ship-it/kit.mjs';

export { clip, checkWorkflow, clearFacts, copyTree, removeTree, saveFacts, short, sleep, secs, startLoad, useReference } from '../challenge-13-ship-it/kit.mjs';

export const CHALLENGE = 14;
export const k = kit(CHALLENGE);
export const root = dirname(fileURLToPath(import.meta.url));
export const platformDir = join(root, 'daftar-platform');
export const SERVICES = ['api', 'worker', 'web'];
export const PROJECT = 'dkr-c14-stack';
export const TEST_PASSWORD = 'dkr-c14-test-db-pass-1f9a';
export const SECRET_MARK = 'supersecret'; // the planted secrets in the starter all contain this word
const PART_DIRS = ['part-1-containerize', 'part-2-pipeline-and-ship', 'part-3-break-it', 'part-4-defend-it'];

/** Where a file of the system is: yours, or (with the reference switch) the reference copy when there is one. */
export function sysPath(rel) {
  if (useReference()) {
    for (const p of [...PART_DIRS].reverse()) {
      const f = join(root, p, 'reference', 'daftar-platform', rel);
      if (existsSync(f)) return f;
    }
  }
  return join(platformDir, rel);
}
export const sysText = (rel) => (existsSync(sysPath(rel)) ? readFileSync(sysPath(rel), 'utf8') : '');

/**
 * The folder to build and run from. Yours, or a scratch copy with every reference file laid over it.
 * Call releaseSystem(dir) when you are done.
 */
export function systemDir() {
  if (!useReference()) return platformDir;
  const dir = mkdtempSync(join(tmpdir(), 'dkr-c14-sys-'));
  cpSync(platformDir, dir, { recursive: true, filter: (src) => !/node_modules/.test(src) });
  for (const p of PART_DIRS) {
    const ref = join(root, p, 'reference', 'daftar-platform');
    if (existsSync(ref)) cpSync(ref, dir, { recursive: true });
  }
  return dir;
}
export function releaseSystem(dir) {
  if (dir !== platformDir) rmSync(dir, { recursive: true, force: true });
}

export const dockerOut = (args, opts) => {
  const r = run(args, opts);
  return r.code === 0 ? r.stdout.trim() : '';
};

/** All FROM lines of a Dockerfile: [{ image, alias, pinned }]. A stage name used as a base is not an image. */
export function fromLines(text) {
  const stages = new Set();
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (!m) continue;
    const [, image, alias] = m;
    if (!stages.has(image.toLowerCase()) && image.toLowerCase() !== 'scratch') out.push({ image, alias, pinned: /@sha256:[0-9a-f]{64}$/.test(image) });
    if (alias) stages.add(alias.toLowerCase());
  }
  return out;
}

/** docker build --check: how many warnings and which rules. */
export function buildCheck(contextDir, target) {
  const r = run(['build', '--check', ...(target ? ['--target', target] : []), contextDir], { timeoutMs: 180_000 });
  const text = `${r.stdout}${r.stderr}`;
  const m = /Check complete, (no|\d+) warnings? (?:has been found|have been found|found)/.exec(text);
  const rules = [...new Set([...text.matchAll(/^WARNING:\s+(\w+)/gm)].map((x) => x[1]))];
  const count = m ? (m[1] === 'no' ? 0 : Number(m[1])) : r.code === 0 ? rules.length : 99;
  return { count, rules, ok: r.code === 0 && count === 0, text };
}

/** Build one image of the system. Returns { ok, ms, tag, error }. */
export function buildService(dir, service, { tag, noCache = false, args = {} } = {}) {
  const t = tag ?? `dkr-c${CHALLENGE}-${service}:p1`;
  const a = ['build', '--provenance=false', '--sbom=false', '--label', `dkr.challenge=${CHALLENGE}`, ...(noCache ? ['--no-cache'] : [])];
  for (const [key, v] of Object.entries(args)) a.push('--build-arg', `${key}=${v}`);
  a.push('-t', t, join(dir, service));
  const t0 = Date.now();
  const r = run(a, { timeoutMs: 900_000 });
  return { ok: r.code === 0, ms: Date.now() - t0, tag: t, error: r.code === 0 ? '' : lastLines(r, 6), out: `${r.stdout}${r.stderr}` };
}

export const imageSizeMb = (tag) => Math.round(Number(dockerOut(['image', 'inspect', tag, '--format', '{{.Size}}'])) / 1e6);

// ---------------------------------------------------------------------------
// The development stack (compose.yaml) on this machine's Docker, labelled and with loopback ports.
// ---------------------------------------------------------------------------

const composeBase = (dir, extraFiles = []) => ['compose', '-p', PROJECT, '-f', join(dir, 'compose.yaml'), ...extraFiles.flatMap((f) => ['-f', f])];
export const stackEnv = (extra = {}) => ({ POSTGRES_PASSWORD: TEST_PASSWORD, APP_VERSION: '1.0.0', COMPOSE_PROJECT_NAME: PROJECT, ...extra });

/** The compose file as Docker reads it (all profiles on). Returns the parsed JSON or null. */
export function composeConfig(dir) {
  const r = run(['compose', '-f', join(dir, 'compose.yaml'), '--profile', '*', 'config', '--format', 'json'], { env: stackEnv() });
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/**
 * A second compose file that does three things for the run, whatever your compose.yaml says:
 * every service, the default network and every volume get the label dkr.challenge=14 (so cleanup finds them),
 * the database never publishes a port, and the api and web publish only on a random 127.0.0.1 port.
 */
export function writeOverride(dir, config) {
  const lines = ['# written by lib.mjs for the run; not part of the system', 'services:'];
  for (const name of Object.keys(config.services)) {
    lines.push(`  ${name}:`, '    labels:', '      dkr.challenge: "14"');
    if (name === 'api' || name === 'web') lines.push('    ports: !override', '      - "127.0.0.1::8080"');
    else lines.push('    ports: !reset []');
  }
  lines.push('networks:', '  default:', '    labels:', '      dkr.challenge: "14"');
  const volumes = Object.keys(config.volumes ?? {});
  if (volumes.length) {
    lines.push('volumes:');
    for (const v of volumes) lines.push(`  ${v}:`, '    labels:', '      dkr.challenge: "14"');
  }
  const file = join(mkdtempSync(join(tmpdir(), 'dkr-c14-ov-')), 'override.yaml');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

/** Bring the development stack up. Returns { files, upMs, ok, error, ports }. */
export async function stackUp(dir, { waitS = 90, env = {}, build = true } = {}) {
  const config = composeConfig(dir);
  if (!config) throw new Error('docker compose config failed on compose.yaml. Run: docker compose config');
  const override = writeOverride(dir, config);
  const base = composeBase(dir, [override]);
  const e = stackEnv(env);
  const t0 = Date.now();
  const up = run([...base, 'up', '-d', ...(build ? ['--build'] : []), '--wait', '--wait-timeout', String(waitS)], { env: e, timeoutMs: (waitS + 600) * 1000 });
  const upMs = Date.now() - t0;
  const port = (svc) => (run([...base, 'port', svc, '8080'], { env: e }).stdout.match(/:(\d+)\s*$/m) || [])[1];
  const ports = { api: port('api'), web: port('web') };
  return { base, env: e, override, config, upMs, ok: up.code === 0, error: up.code === 0 ? '' : lastLines(up, 4), ports };
}

export function stackDown(stack) {
  if (!stack) return;
  run([...stack.base, '--profile', '*', 'down', '-v', '--timeout', '3', '--remove-orphans'], { env: stack.env, timeoutMs: 120_000 });
  rmSync(dirname(stack.override), { recursive: true, force: true });
}

export const stackExec = (stack, args, opts = {}) => run([...stack.base, ...args], { env: stack.env, ...opts });

/** The health status of each service's container in a running stack: { api: 'healthy', ... }. */
export function stackHealth(stack) {
  const ids = stackExec(stack, ['ps', '-a', '-q']).stdout.trim().split(/\s+/).filter(Boolean);
  const out = {};
  for (const id of ids) {
    const line = dockerOut(['inspect', id, '--format', '{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}|{{.RestartCount}}|{{.State.OOMKilled}}']);
    const [svc, state, health, exit, restarts, oom] = line.split('|');
    out[svc] = { state, health, exit: Number(exit), restarts: Number(restarts), oom: oom === 'true', id };
  }
  return out;
}

export const containerOf = (stack, service) => stackHealth(stack)[service]?.id ?? '';

const jsonFetch = async (url, init) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
    let body = null;
    try { body = await r.json(); } catch { /* no body */ }
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: { error: e.message } };
  }
};
export const http = jsonFetch;

/** Queue n jobs through the web page's own path (/api/jobs) and wait until all are done. Returns { ok, ms, ids }. */
export async function runJobs(stack, n, { waitMs = 30_000, prefix = 'daftar capstone job' } = {}) {
  const base = `http://127.0.0.1:${stack.ports.web}`;
  const t0 = Date.now();
  const ids = [];
  // a stack without health checks may still be starting when "up --wait" returns: give it time before judging it
  await waitFor(async () => (await jsonFetch(`${base}/api/ready`)).status === 200, { timeoutMs: 30_000, intervalMs: 300, what: 'the api to be ready' }).catch(() => {});
  for (let i = 1; i <= n; i++) {
    const r = await jsonFetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `${prefix} ${i}` }) });
    if (r.status !== 201) return { ok: false, ms: Date.now() - t0, ids, error: `POST /api/jobs answered ${r.status}` };
    ids.push(r.body.id);
  }
  const ok = await waitFor(
    async () => {
      const r = await jsonFetch(`${base}/api/jobs`);
      const jobs = r.body?.jobs ?? [];
      return ids.every((id) => jobs.find((j) => j.id === id)?.status === 'done');
    },
    { timeoutMs: waitMs, intervalMs: 300, what: 'every job to be done' },
  ).then(() => true).catch(() => false);
  return { ok, ms: Date.now() - t0, ids };
}

/** Remove the images this challenge built. */
export const removeImages = () => k.removeImages();
export { label, safeArgs, sleep as pause, waitFor, mkdirSync, readdirSync };
