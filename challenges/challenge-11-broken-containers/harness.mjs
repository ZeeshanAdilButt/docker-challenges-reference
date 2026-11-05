// Shared helpers for challenge 11. Plain Node, no packages.
// Each broken service lives in its own folder with a compose.yaml. Everything it creates is named
// dkr-c11-... and labelled dkr.challenge=11 (the compose files carry the label and a memory,
// process and log cap). Host ports are bound to 127.0.0.1 only.

import { join } from 'node:path';
import { run, safeArgs } from '../../toolkit/docker.js';

export const CHALLENGE = 11;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The ten services: folder name, slug, containers, ports and the ticket the learner receives. */
export const SERVICES = {
  '01-wrong-entrypoint': { n: 1, slug: 'wrong-entrypoint', containers: ['dkr-c11-wrong-entrypoint'], port: 18101, ticket: 'Deploy of the orders API: the container never comes up. `docker compose up` prints an error.' },
  '02-missing-env': { n: 2, slug: 'missing-env', containers: ['dkr-c11-missing-env'], port: 18102, ticket: 'The billing API starts and is gone a second later. Nothing answers on port 18102.' },
  '03-volume-permission': { n: 3, slug: 'volume-permission', containers: ['dkr-c11-volume-permission'], port: 18103, ticket: 'The shop API keeps its data in a volume. Since we added the volume the container exits right after start.' },
  '04-exit-137': { n: 4, slug: 'exit-137', containers: ['dkr-c11-exit-137'], port: 18104, ticket: 'The catalogue API loads a cache at start-up and then dies. Someone says "it is killed". By what?' },
  '05-port-clash': { n: 5, slug: 'port-clash', containers: ['dkr-c11-port-clash-web', 'dkr-c11-port-clash-admin'], focus: 'dkr-c11-port-clash-admin', port: 18105, ticket: 'The web site is fine but the admin site never starts. The compose file looks right.' },
  '06-bad-healthcheck': { n: 6, slug: 'bad-healthcheck', containers: ['dkr-c11-bad-healthcheck'], port: 18106, ticket: 'The reports API answers requests, but Docker says it is unhealthy and the deploy tool refuses to continue.' },
  '07-dns-typo': { n: 7, slug: 'dns-typo', containers: ['dkr-c11-dns-typo-gateway', 'dkr-c11-dns-typo-backend'], focus: 'dkr-c11-dns-typo-gateway', port: 18107, ticket: 'Both containers are running. The gateway answers /health but /orders returns a 502 error.' },
  '08-read-only-root': { n: 8, slug: 'read-only-root', containers: ['dkr-c11-read-only-root'], port: 18108, ticket: 'Security made the root filesystem read-only. Now the pricing API exits at start-up.' },
  '09-missing-shell': { n: 9, slug: 'missing-shell', containers: ['dkr-c11-missing-shell'], port: 18109, ticket: 'The new hardened image (no shell) exits at once. You cannot get a shell inside to look around.' },
  '10-wrong-user': { n: 10, slug: 'wrong-user', containers: ['dkr-c11-wrong-user'], port: 18110, ticket: 'The profile API runs as a normal user (good!) and exits at start-up. It worked as root.' },
};

/** Run `docker compose` for one service folder. Never throws. */
export function compose(dir, args, opts = {}) {
  return run(['compose', '-f', join(dir, 'compose.yaml'), ...args], { cwd: dir, timeoutMs: opts.timeoutMs ?? 180_000 });
}

/** Bring a service up (build included). Returns the compose result; a failure here is part of the symptom. */
export function up(dir) {
  return compose(dir, ['up', '-d', '--build']);
}

/** Stop and remove one service and its volumes. Only the compose project of this folder. */
export function down(dir) {
  return compose(dir, ['down', '-v', '--remove-orphans', '-t', '2']);
}

/** Remove the image a service built, by its exact name. */
export function removeImage(slug) {
  return run(['rmi', '-f', `dkr-c11/${slug}:1`]);
}

/** State of the named containers from `docker inspect`. Containers that do not exist are reported as "missing". */
export function states(names) {
  const fmt = '{{.Name}}|{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.Error}}';
  return names.map((n) => {
    const r = run(['inspect', n, '--format', fmt]);
    if (r.code !== 0) return { name: n, status: 'missing', exit: null, oomKilled: false, health: 'none', restarts: 0, error: '' };
    const [, status, exit, oom, health, restarts, ...err] = r.stdout.trim().split('|');
    return { name: n, status, exit: Number(exit), oomKilled: oom === 'true', health, restarts: Number(restarts), error: err.join('|') };
  });
}

/** The host port Docker published for a container's port 8080, or null. */
export function publishedPort(container) {
  const r = run(['port', container, '8080/tcp']);
  const m = /:(\d+)\s*$/m.exec(r.stdout);
  return m ? Number(m[1]) : null;
}

/** GET a URL from the host with a short timeout. Returns { status, body } or { status: 0, error }. */
export async function get(url, timeoutMs = 2500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, error: String(e.cause?.code ?? e.message) };
  }
}

/** What "working" means for each service. Returns [{ what, ok, detail }]. */
export async function probes(id) {
  const svc = SERVICES[id];
  const out = [];
  const check = (what, r, ok) => out.push({ what, ok: !!ok, detail: r.status ? `HTTP ${r.status} ${JSON.stringify(r.body)}` : `no answer (${r.error})` });
  const base = `http://127.0.0.1:${svc.port}`;
  const health = await get(`${base}/health`);
  check(`GET ${base}/health`, health, health.status === 200);
  if (id === '03-volume-permission' || id === '10-wrong-user' || id === '04-exit-137' || id === '02-missing-env') {
    const root = await get(`${base}/`);
    const need = { '03-volume-permission': (b) => !!b.started_at, '10-wrong-user': (b) => b.greeting === 'hello from the config file' && b.uid !== 0, '04-exit-137': (b) => b.preloaded_mb >= 16, '02-missing-env': (b) => b.database_host === 'db.internal' }[id];
    check(`GET ${base}/`, root, root.status === 200 && need(root.body));
  }
  if (id === '05-port-clash') {
    const p = publishedPort('dkr-c11-port-clash-admin');
    const admin = p ? await get(`http://127.0.0.1:${p}/`) : { status: 0, error: 'admin has no published port' };
    check(`admin site${p ? ` on port ${p}` : ''}`, admin, admin.status === 200 && admin.body.role === 'admin' && p !== svc.port);
  }
  if (id === '07-dns-typo') {
    const orders = await get(`${base}/orders`, 8000);
    check(`GET ${base}/orders`, orders, orders.status === 200 && Array.isArray(orders.body.orders));
  }
  return out;
}

/**
 * Wait until a service is working, or has clearly failed, or 15 seconds pass.
 * Returns { containers, probes, working, seconds }.
 */
export async function settle(id, { timeoutMs = 15_000 } = {}) {
  const svc = SERVICES[id];
  const t0 = Date.now();
  let st;
  let pr = [];
  for (;;) {
    st = states(svc.containers);
    const bad = st.some((s) => ['exited', 'dead', 'created', 'missing'].includes(s.status) || s.health === 'unhealthy' || s.status === 'restarting');
    const allRunning = st.every((s) => s.status === 'running' && (s.health === 'none' || s.health === 'healthy'));
    if (allRunning) {
      pr = await probes(id);
      if (pr.every((p) => p.ok)) return { containers: st, probes: pr, working: true, seconds: (Date.now() - t0) / 1000 };
    }
    if (bad && Date.now() - t0 > 1500) break;
    if (Date.now() - t0 > timeoutMs) break;
    await sleep(500);
  }
  // Take a last look at the probes so the symptom is on record.
  pr = await probes(id);
  return { containers: st, probes: pr, working: false, seconds: (Date.now() - t0) / 1000 };
}

/** One line that says what a person sees. */
export function symptomLine(r) {
  const parts = r.containers.map((c) => {
    const bits = [c.status];
    if (c.status === 'exited') bits.push(`exit ${c.exit}`);
    if (c.oomKilled) bits.push('OOMKilled');
    if (c.health !== 'none') bits.push(c.health);
    return `${c.name.replace('dkr-c11-', '')}: ${bits.join(', ')}`;
  });
  return parts.join('; ');
}

/** A `docker run` cage for the small helper containers used by the diagnosis ladder. */
export const ladderCage = (what) => safeArgs(CHALLENGE, what, { memory: '64m', pids: 50 });
