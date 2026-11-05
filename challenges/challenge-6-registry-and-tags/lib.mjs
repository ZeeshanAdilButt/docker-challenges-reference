// Helpers shared by the parts of challenge 6. Plain Node, no packages.
//
// Starter or reference: every part runs against YOUR files by default.
// Set DKR_USE_REFERENCE=1 (or pass --reference to run.mjs) to run the same part
// against the fixed files in the part's reference/ folder. Maintainers use this to
// prove that the tests fail on the starter and pass on the reference.

import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

import { label, run, safeArgs, waitFor } from '../../toolkit/docker.js';
import { getFact, setFact } from '../../toolkit/facts.js';

export const CHALLENGE = 6;
export const REGISTRY_IMAGE = 'registry:3';
export const useReference = () => process.env.DKR_USE_REFERENCE === '1' || process.argv.includes('--reference');

/** Path of a part file. With the reference switch on, reference/<name> wins when it exists. */
export function pick(partDir, name) {
  if (useReference()) {
    const ref = join(partDir, 'reference', name);
    if (existsSync(ref)) return ref;
  }
  return join(partDir, name);
}

/** Keep at most n lines. Longer output keeps the head and the tail, with a marker line between. */
export function clip(text, n = 25) {
  const lines = String(text).replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.length <= n) return lines.join('\n');
  const head = Math.ceil((n - 1) / 2);
  const tail = n - 1 - head;
  return [...lines.slice(0, head), `... (${lines.length - head - tail} lines left out)`, ...lines.slice(lines.length - tail)].join('\n');
}

/** Save facts, then read them back. Another builder may write facts.json at the same moment, so retry. */
export function saveFacts(facts) {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const [k, v] of Object.entries(facts)) if (getFact(k) !== v) setFact(k, v);
    if (Object.entries(facts).every(([k, v]) => getFact(k) === v)) return;
  }
  throw new Error('could not save all facts to facts.json');
}

/** Flags files: comments dropped, split on spaces. Refuses the flags this course never allows. */
const FORBIDDEN = [/^--privileged/, /^--cap-add/, /^--pid/, /^--network=?host/, /^--net=?host/, /docker\.sock/, /^--userns/];
export function readFlags(file) {
  const tokens = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .flatMap((l) => l.split(/\s+/));
  const bad = tokens.find((t) => FORBIDDEN.some((re) => re.test(t)));
  if (bad) throw new Error(`${file} uses "${bad}". This challenge does not allow it (see SAFETY.md).`);
  return tokens;
}

/**
 * A free port on 127.0.0.1. We choose it ourselves because on this Docker Desktop a port that Docker picks
 * (-p 127.0.0.1::5000) is reachable from Windows but not by the engine, so `docker push` to it fails.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/**
 * Start registry:3 in a capped container. Returns { name, port, base, host }.
 * flags: extra docker run flags (published port, volume, env). If there is no -p flag, one on 127.0.0.1 and a free port is added.
 */
export async function startRegistry({ what = 'registry', flags = [], memory = '256m', port: wanted } = {}) {
  const name = `dkr-c${CHALLENGE}-${what}`;
  const args = ['run', '-d', ...safeArgs(CHALLENGE, what, { memory, pids: 100 }), ...flags];
  if (!flags.some((t) => t === '-p' || t === '--publish' || t.startsWith('--publish='))) args.push('-p', `127.0.0.1:${wanted ?? (await freePort())}:5000`);
  args.push(REGISTRY_IMAGE);
  const r = run(args);
  if (r.code !== 0) throw new Error(`could not start the registry: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-2).join(' ')}`);
  const port = await waitFor(() => run(['port', name, '5000/tcp']).stdout.match(/:(\d+)\s*$/m)?.[1], { timeoutMs: 8000, intervalMs: 100, what: 'the registry port' });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(() => fetch(`${base}/v2/`).then((x) => x.status === 200).catch(() => false), { timeoutMs: 20_000, intervalMs: 100, what: 'the registry to answer /v2/' });
  return { name, port: Number(port), base, host: `127.0.0.1:${port}` };
}

export function createVolume(name) {
  return run(['volume', 'create', ...label(CHALLENGE), name]);
}

/** All requests a registry has logged so far: [{ method, uri, status }]. Take the count before an action, then slice. */
export function registryRequests(name) {
  const r = run(['logs', name]);
  const out = [];
  for (const line of (r.stdout + r.stderr).split(/\r?\n/)) {
    if (!/msg="response completed"/.test(line)) continue;
    const method = /http\.request\.method=(\w+)/.exec(line)?.[1];
    const uri = /http\.request\.uri="?([^"\s]+)"?/.exec(line)?.[1];
    const status = Number(/http\.response\.status=(\d+)/.exec(line)?.[1]);
    if (method && uri) out.push({ method, uri, status });
  }
  return out;
}

/** Build a tiny image (FROM alpine:3.23 plus one file) and tag it. */
export function buildTiny({ tag, text, dockerfileExtra = '', labels = {} }) {
  const lines = ['FROM alpine:3.23', `RUN echo "${text}" > /version`, dockerfileExtra];
  const args = ['build', '--provenance=false', '--sbom=false', '--label', `dkr.challenge=${CHALLENGE}`, '-t', tag];
  for (const [k, v] of Object.entries(labels)) args.push('--label', `${k}=${v}`);
  args.push('-');
  return run(args, { input: lines.filter(Boolean).join('\n') + '\n', timeoutMs: 300_000 });
}

/** Remove the images this challenge made: label dkr.challenge=6 and a name with dkr-c6 or /dkr-c6/ in it. */
export function removeImages() {
  const r = run(['image', 'ls', '--filter', `label=dkr.challenge=${CHALLENGE}`, '--format', '{{.Repository}}:{{.Tag}}']);
  const names = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && (s.startsWith(`dkr-c${CHALLENGE}-`) || s.includes(`/dkr-c${CHALLENGE}/`)) && !s.endsWith(':<none>'));
  if (names.length) run(['image', 'rm', '--force', ...names]);
  return names;
}

export const secs = (ms) => Math.round(ms / 100) / 10;
export const mb = (bytes, digits = 1) => Math.round((bytes / 1e6) * 10 ** digits) / 10 ** digits;
export const short = (digest) => String(digest).replace(/^sha256:/, '').slice(0, 12);
