// Helpers shared by the three parts of challenge 4. Plain Node, no packages.
//
// Starter or reference: every part runs against YOUR files by default.
// Set DKR_USE_REFERENCE=1 (or pass --reference to run.mjs) to run the same part
// against the fixed files in the part's reference/ folder. Maintainers use this to
// prove that the tests fail on the starter and pass on the reference.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { run } from '../../toolkit/docker.js';
import { getFact, setFact } from '../../toolkit/facts.js';

export const CHALLENGE = 4;
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

/** docker build. Returns { ok, ms, out }. Every image gets the challenge label. */
export function build({ dockerfile, context, tag, buildArgs = {}, extra = [], noCache = false }) {
  const args = ['build', '--progress=plain', '--label', `dkr.challenge=${CHALLENGE}`, '-f', dockerfile, '-t', tag];
  if (noCache) args.push('--no-cache');
  for (const [k, v] of Object.entries(buildArgs)) args.push('--build-arg', `${k}=${v}`);
  args.push(...extra, context);
  const t0 = process.hrtime.bigint();
  const r = run(args, { timeoutMs: 600_000 });
  return { ok: r.code === 0, ms: Number(process.hrtime.bigint() - t0) / 1e6, out: r.stdout + r.stderr };
}

/** Unpacked size of a local image in bytes (what `docker images` shows). */
export function imageBytes(tag) {
  const r = run(['image', 'inspect', '--format', '{{.Size}}', tag]);
  return r.code === 0 ? Number(r.stdout.trim()) : NaN;
}

/**
 * Build with the OCI exporter into a tar file. Gives the packed size (the bytes a registry stores)
 * and the digest of the image. Extra flags go straight to `docker buildx build`.
 */
export function ociExport({ dockerfile, context, buildArgs = {}, flags = [], output = 'type=oci', noCache = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'dkr-c4-oci-'));
  const dest = join(dir, 'image.tar');
  const args = ['buildx', 'build', '--progress=plain', '-f', dockerfile, '--output', `${output},dest=${dest}`];
  if (noCache) args.push('--no-cache');
  for (const [k, v] of Object.entries(buildArgs)) args.push('--build-arg', `${k}=${v}`);
  args.push(...flags, context);
  const t0 = process.hrtime.bigint();
  const r = run(args, { timeoutMs: 600_000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.code !== 0 || !existsSync(dest)) {
    rmSync(dir, { recursive: true, force: true });
    return { ok: false, ms, out: r.stdout + r.stderr };
  }
  try {
  // relative name + cwd: GNU tar would read "C:\..." as host:path
  const read = (path) => spawnSync('tar', ['-xOf', 'image.tar', path], { cwd: dir, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }).stdout;
  const index = JSON.parse(read('index.json').toString('utf8'));
  const digest = index.manifests[0].digest;
  const manifest = JSON.parse(read(`blobs/${digest.replace(':', '/')}`).toString('utf8'));
  const layers = manifest.layers.map((l) => l.digest);
  const config = JSON.parse(read(`blobs/${manifest.config.digest.replace(':', '/')}`).toString('utf8'));
  // one entry per layer: the instruction that made it
  const steps = (config.history || []).filter((h) => !h.empty_layer).map((h) => h.created_by || '');
  const packedBytes = manifest.layers.reduce((s, l) => s + l.size, 0) + manifest.config.size;
  const tarBytes = statSync(dest).size;
  return { ok: true, ms, out: r.stdout + r.stderr, digest, config: manifest.config.digest, layers, steps, created: config.created, packedBytes, tarBytes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Remove the images this challenge built: label dkr.challenge=4 AND a name starting with dkr-c4-. */
export function removeImages() {
  const r = run(['image', 'ls', '--filter', `label=dkr.challenge=${CHALLENGE}`, '--format', '{{.Repository}}:{{.Tag}}']);
  const names = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith(`dkr-c${CHALLENGE}-`));
  if (names.length) run(['image', 'rm', '--force', ...names]);
  return names;
}

export const mb = (bytes, digits = 1) => Math.round((bytes / 1e6) * 10 ** digits) / 10 ** digits;

/** First 12 characters of a digest without the algorithm, for short printing. */
export const short = (digest) => digest.replace(/^sha256:/, '').slice(0, 12);

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}
