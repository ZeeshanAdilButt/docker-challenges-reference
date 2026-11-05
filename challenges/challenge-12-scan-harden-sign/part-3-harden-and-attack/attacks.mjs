// The attack scripts of part 3, and the code that starts your container.
// They run ONLY against the container this script starts (name dkr-c12-target), with docker exec.
// Think of an attacker who found a way to run commands inside your service. What can they do?
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, name, label, cleanup } from '../../../toolkit/docker.js';
import { CHALLENGE, docker, removeByName } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const IMAGE = 'dkr-c12-target:1';
export const PORT = 18130;
export const CANARY = 'root-only-secret-dkrcanary';

/** Controls you can set in harden.json (the ones the leave-one-out table removes one at a time). */
export const CONTROLS = ['user', 'cap_drop', 'read_only', 'no_new_privileges', 'pids_limit'];

/** Each attack: what the attacker tries, the command, and how to tell it worked. */
export const ATTACKS = [
  { id: 'write-rootfs', title: 'write a new program into /usr/local/bin', cmd: 'echo pwned > /usr/local/bin/evil && echo SUCCESS', worked: (o) => o.includes('SUCCESS'), stoppedBy: 'a non-root user, or read_only' },
  { id: 'read-secret', title: 'read the root-only secret file', cmd: 'cat /root/secret.txt', worked: (o) => o.includes(CANARY), stoppedBy: 'a non-root user' },
  { id: 'setuid-climb', title: 'climb to root with the setuid program doas and read the secret', cmd: 'doas cat /root/secret.txt', worked: (o) => o.includes(CANARY), stoppedBy: 'no_new_privileges, or dropping capabilities (and a non-root user to start from)' },
  { id: 'chown-file', title: 'give a file to another user (needs the CHOWN capability)', cmd: 'chown 1234 /www/index.html && echo SUCCESS', worked: (o) => o.includes('SUCCESS'), stoppedBy: 'dropping capabilities, a non-root user, or read_only' },
  { id: 'make-device', title: 'create a device file (needs the MKNOD capability)', cmd: 'mknod /tmp/null c 1 3 && echo SUCCESS', worked: (o) => o.includes('SUCCESS'), stoppedBy: 'dropping capabilities or a non-root user' },
  { id: 'fork-flood', title: 'start 150 processes at once', cmd: 'i=0; while [ $i -lt 150 ]; do sleep 30 & i=$((i+1)); done 2>/dev/null; sleep 1; echo COUNT=$(ps | grep -c "[s]leep 30")', worked: (o) => Number((/COUNT=([0-9]+)/.exec(o) ?? [])[1]) > 64, stoppedBy: 'a process limit (pids_limit)' },
];

export const loadHarden = (dir) => JSON.parse(readFileSync(join(dir, 'harden.json'), 'utf8'));

/** Turn harden.json into docker run flags. Always adds the safety cage: 64 MB memory, a process cap of 200 at most. */
export function flagsFor(h) {
  const pids = h.pids_limit > 0 ? h.pids_limit : 200;
  const flags = ['--name', name(CHALLENGE, 'target'), ...label(CHALLENGE), '--memory', '64m', '--memory-swap', '64m', '--pids-limit', String(pids), '--log-opt', 'max-size=1m', '--log-opt', 'max-file=2', '-p', `127.0.0.1:${PORT}:8080`];
  if (h.user && h.user !== 'root') flags.push('--user', h.user);
  for (const c of h.cap_drop ?? []) flags.push('--cap-drop', c);
  if (h.read_only) flags.push('--read-only');
  if (h.no_new_privileges) flags.push('--security-opt', 'no-new-privileges');
  for (const t of h.tmpfs ?? []) flags.push('--tmpfs', t);
  return flags;
}

/** Build the target image from target/. Returns the seconds it took. */
export function buildTarget() {
  const t0 = process.hrtime.bigint();
  docker(['build', '--quiet', '-t', IMAGE, '--label', 'dkr.challenge=12', join(here, 'target')], { timeoutMs: 300_000 });
  return Number(process.hrtime.bigint() - t0) / 1e9;
}

/** Start the target with a hardening config. Returns when the container is running. */
export function startTarget(h) {
  removeByName('target');
  docker(['run', '-d', ...flagsFor(h), IMAGE]);
}

export const stopTarget = () => removeByName('target');

/** Ask the service: GET /health from the host. */
export async function serviceOk() {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.status === 200 && (await r.text()).includes('ok')) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Run every attack with docker exec. Returns [{ id, title, worked, output }]. */
export function attackAll() {
  return ATTACKS.map((a) => {
    const r = run(['exec', name(CHALLENGE, 'target'), 'sh', '-c', a.cmd], { timeoutMs: 60_000 });
    const output = `${r.stdout}${r.stderr}`.trim();
    return { id: a.id, title: a.title, stoppedBy: a.stoppedBy, worked: a.worked(output), output };
  });
}

/** What the attacker sees about their own power. */
export function whoami() {
  const r = run(['exec', name(CHALLENGE, 'target'), 'sh', '-c', 'echo "uid=$(id -u) $(grep CapEff /proc/self/status | tr -s "\\t " " ") NoNewPrivs=$(grep NoNewPrivs /proc/self/status | cut -f2)"']);
  return r.stdout.trim();
}

/** Start with a config, check the service, attack, stop. Returns { ok, results, who }. */
export async function trial(h) {
  startTarget(h);
  try {
    const ok = await serviceOk();
    const who = ok ? whoami() : '';
    const results = ok ? attackAll() : [];
    return { ok, results, who };
  } finally {
    stopTarget();
  }
}

export { cleanup };
