// audit.mjs: read `docker inspect` JSON and flag containers that can hurt the host.
//
// Use it:
//   node audit.mjs fixtures/inspect.json          audit a saved inspect file
//   docker inspect a b c | node audit.mjs -       audit JSON from standard input
//   node audit.mjs --live --label dkr.challenge=10   inspect the running Docker (read only)
// Exit code 1 when any finding is critical or high. Exit code 0 otherwise.
//
// Your job is in the two functions marked TODO: parseSize and auditContainer.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

const UNITS = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };

/**
 * Turn a size printed by Docker into bytes. Docker prints decimal units: "512B", "21kB", "21MB", "1.5GB".
 * It also prints "21MB (virtual 30.1MB)" in `docker ps -s`: use only the first size.
 * Return NaN for anything you do not understand.
 */
export function parseSize(text) {
  // TODO: return the number of bytes, or NaN. Docker uses decimal units: 1 kB is 1000 bytes.
  return NaN;
}

// Handy: Docker reports "no limit" in several ways (0, -1, null, missing).
const unset = (v) => v === undefined || v === null || v === 0 || v === -1;

/**
 * Look at ONE object from `docker inspect` and return a list of findings.
 * A finding is { id, severity, message }. severity is one of SEVERITIES.
 * A clean container returns [].
 *
 * The rules (id, severity, when):
 *   privileged        critical  HostConfig.Privileged is true
 *   docker-socket     critical  a bind or mount whose path contains docker.sock
 *   no-memory-limit   high      HostConfig.Memory is 0
 *   log-not-rotated   high      LogConfig.Type is json-file and Config has no max-size
 *   no-pids-limit     medium    HostConfig.PidsLimit is missing, 0 or -1
 *   restart-always    medium    RestartPolicy.Name is always
 *   runs-as-root      medium    Config.User is empty, 0 or root
 *   restart-unbounded low       RestartPolicy.Name is unless-stopped, or on-failure with MaximumRetryCount 0
 *   writable-rootfs   low       ReadonlyRootfs is false
 *   no-healthcheck    low       Config.Healthcheck is missing or its Test is ["NONE"]
 */
export function auditContainer(inspect) {
  // TODO: apply the rules in the comment above and return the findings.
  // Start with the one you can see in the JSON: HostConfig.Memory.
  void inspect;
  return [];
}

/** Audit a list of inspect objects. Returns [{ container, findings }]. */
export function auditAll(list) {
  return list.map((c) => ({ container: String(c.Name ?? c.Id ?? '?').replace(/^\//, ''), findings: auditContainer(c) }));
}

/** Count findings per severity. */
export function summarize(results) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const r of results) for (const f of r.findings) counts[f.severity] += 1;
  return counts;
}

/** Format results as a table. Plain text. */
export function format(results) {
  const rows = [];
  for (const r of results) {
    if (r.findings.length === 0) rows.push(['ok', '-', r.container, 'no findings']);
    for (const f of r.findings) rows.push([f.severity.toUpperCase(), f.id, r.container, f.message]);
  }
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => `${r[0].padEnd(w[0])}  ${r[1].padEnd(w[1])}  ${r[2].padEnd(w[2])}  ${r[3]}`).join('\n');
}

function readInspectJson(args) {
  const live = args.includes('--live');
  if (live) {
    const li = args.indexOf('--label');
    const filter = li >= 0 ? ['--filter', `label=${args[li + 1]}`] : [];
    const ids = spawnSync('docker', ['ps', '-a', '-q', ...filter], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
    if (ids.length === 0) return [];
    return JSON.parse(spawnSync('docker', ['inspect', ...ids], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout);
  }
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Give a file, "-" for standard input, or --live. Example: node audit.mjs fixtures/inspect.json');
  const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [data];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const results = auditAll(readInspectJson(process.argv.slice(2)));
    console.log(format(results));
    const counts = summarize(results);
    console.log(`\n${results.length} containers: ${SEVERITIES.map((s) => `${counts[s]} ${s}`).join(', ')}`);
    process.exit(counts.critical + counts.high > 0 ? 1 : 0);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
