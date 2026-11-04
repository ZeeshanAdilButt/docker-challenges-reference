// Small helpers shared by the four parts of challenge 7. Plain Node, no packages.

import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { run } from '../../toolkit/docker.js';

export const CHALLENGE = 7;

/** True when the part should use its reference/ folder instead of the files you edit. */
export const useReference = () => process.argv.includes('--reference') || process.env.DKR_USE_REFERENCE === '1';

/** The folder that holds the files being tested: the part folder, or its reference/ folder. */
export const filesDir = (here) => (useReference() ? join(here, 'reference') : here);

/** Show an argument list the way you would type it. */
export const show = (args, bin = 'docker') => `${bin} ${args.map((a) => (/[\s{}"|;&]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')}`;

/** Run docker and return trimmed stdout. Throws with the error text when it fails. */
export function docker(args, opts = {}) {
  const r = run(args, opts);
  if (r.code !== 0) throw new Error(`${show(args)} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** docker exec in a container. opts.containerEnv sets variables for that command. Returns { ok, out, ms }. Never throws. */
export function exec(container, cmd, opts = {}) {
  const t0 = process.hrtime.bigint();
  const envArgs = Object.entries(opts.containerEnv ?? {}).flatMap(([k, v]) => ['-e', k + '=' + v]);
  const r = run(['exec', ...envArgs, container, ...cmd], opts);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ok: r.code === 0, out: `${r.stdout}${r.stderr}`.trim(), ms };
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

/** Non-loopback IPv4 addresses of this computer that are not link-local. */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

/** Try one TCP connection. Resolves 'open', 'refused', 'timeout' or 'error'. */
export function probeTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done('timeout'));
    s.on('connect', () => done('open'));
    s.on('error', (e) => done(e.code === 'ECONNREFUSED' ? 'refused' : 'error'));
  });
}

/** Wait until a TCP port accepts a connection. */
export async function waitTcp(host, port, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await probeTcp(host, port, 800)) === 'open') return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Nothing listened on ${host}:${port} after ${timeoutMs} ms`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `docker compose -p <project> -f <file> <args>` with extra environment variables.
 * Returns { code, stdout, stderr } and never throws. The project name keeps it separate from every other stack.
 */
export function compose(project, file, args, env = {}, opts = {}) {
  return run(['compose', '-p', project, '-f', file, ...args], { ...opts, env, cwd: opts.cwd });
}

/** Same as compose() but throws on a non-zero exit and returns trimmed stdout. */
export function composeOk(project, file, args, env = {}, opts = {}) {
  const r = compose(project, file, args, env, opts);
  if (r.code !== 0) throw new Error(`docker compose ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/**
 * Connect to each port on 127.0.0.1 and on every address in `addresses`.
 * Returns [{ port, loopback, others: ['open', ...] }]. Only scan ports of containers you started.
 */
export async function scanPorts(ports, addresses = lanAddresses()) {
  const rows = [];
  for (const port of ports) {
    const loopback = await probeTcp('127.0.0.1', port);
    const others = [];
    for (const a of addresses) others.push(await probeTcp(a, port));
    rows.push({ port, loopback, others });
  }
  return rows;
}

/** The table scan.mjs prints. rows come from scanPorts(). */
export function formatScan(rows, addresses) {
  const pad = (s, n) => String(s).padEnd(n);
  const head = `${pad('port', 7)}${pad('127.0.0.1', 11)}${addresses.map((a) => pad(a, 16)).join('') || 'no other address'}`;
  return [head, ...rows.map((r) => `${pad(r.port, 7)}${pad(r.loopback, 11)}${r.others.map((s) => pad(s, 16)).join('')}`.trimEnd())].join('\n');
}
