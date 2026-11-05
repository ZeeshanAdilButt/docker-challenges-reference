// Helpers shared by the parts of challenge 5. Plain Node, no packages.
//
// Starter or reference: every part runs against YOUR files by default.
// Set DKR_USE_REFERENCE=1 (or pass --reference to run.mjs) to run the same part
// against the fixed files in the part's reference/ folder. Maintainers use this to
// prove that the tests fail on the starter and pass on the reference.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { run } from '../../toolkit/docker.js';
import { getFact, setFact } from '../../toolkit/facts.js';

export const CHALLENGE = 5;
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

/**
 * Run `docker build` (BuildKit plain progress) and return { ok, ms, out, steps }.
 * steps: one entry per numbered Dockerfile instruction: { n, name, cached, sec }.
 */
export function build({ dockerfile, context, tag, buildArgs = {}, extra = [], noCache = false }) {
  const args = ['build', '--progress=plain', '--label', `dkr.challenge=${CHALLENGE}`, '-f', dockerfile, '-t', tag];
  if (noCache) args.push('--no-cache');
  for (const [k, v] of Object.entries(buildArgs)) args.push('--build-arg', `${k}=${v}`);
  args.push(...extra, context);
  const t0 = process.hrtime.bigint();
  const r = run(args, { timeoutMs: 900_000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const out = r.stdout + r.stderr;
  return { ok: r.code === 0, ms, out, steps: parseSteps(out) };
}

/** Read BuildKit plain output. A "step" is a line like "#7 [3/5] RUN npm ci". */
export function parseSteps(out) {
  const byId = new Map();
  for (const line of out.split(/\r?\n/)) {
    let m = /^#(\d+) \[(?:([^\]]*?)\s)?(\d+)\/(\d+)\] (.+)$/.exec(line);
    if (m) {
      if (!byId.has(m[1])) byId.set(m[1], { n: Number(m[1]), stage: m[2] || '', index: Number(m[3]), of: Number(m[4]), name: m[5], cached: false, sec: undefined });
      continue;
    }
    m = /^#(\d+) CACHED/.exec(line);
    if (m && byId.has(m[1])) byId.get(m[1]).cached = true;
    m = /^#(\d+) DONE ([\d.]+)s/.exec(line);
    if (m && byId.has(m[1])) byId.get(m[1]).sec = Number(m[2]);
  }
  return [...byId.values()].sort((a, b) => a.n - b.n);
}

/** The size BuildKit reported for the first "transferring context" line, in MB. */
export function contextMb(out) {
  const all = [...out.matchAll(/transferring context: ([\d.]+)(B|kB|MB|GB)/g)];
  if (!all.length) return NaN;
  const [, num, unit] = all[all.length - 1];
  return Number(num) * { B: 1e-6, kB: 1e-3, MB: 1, GB: 1000 }[unit];
}

/** Unpacked size of a local image in bytes. */
export function imageBytes(tag) {
  const r = run(['image', 'inspect', '--format', '{{.Size}}', tag]);
  return r.code === 0 ? Number(r.stdout.trim()) : NaN;
}

/** Remove the images this challenge built: label dkr.challenge=5 AND a name starting with dkr-c5-. */
export function removeImages() {
  const r = run(['image', 'ls', '--filter', `label=dkr.challenge=${CHALLENGE}`, '--format', '{{.Repository}}:{{.Tag}}']);
  const names = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith(`dkr-c${CHALLENGE}-`));
  if (names.length) run(['image', 'rm', '--force', ...names]);
  return names;
}

export const mb = (bytes, digits = 1) => Math.round((bytes / 1e6) * 10 ** digits) / 10 ** digits;
export const secs = (ms) => Math.round(ms / 100) / 10;
