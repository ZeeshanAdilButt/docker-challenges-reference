// Shared code for the three pipeline hooks: scan.mjs, sbom.mjs and sign.mjs.
//
// The contract (also in hooks/README.md):
//   node hooks/<stage>.mjs <image reference>
//   - exit code 0 means the stage passed, any other code means it failed;
//   - stdout holds exactly ONE line, the result line:  <stage> <status> key=value key=value ...
//     status is ok, failed or partial; values have no spaces. Nothing else is printed to stdout or stderr.
//   - everything a hook creates is named dkr-c12-hook-... and labelled dkr.challenge=12, and is removed before it exits.

import { randomBytes } from 'node:crypto';
import { run, label, name } from '../../../toolkit/docker.js';
import { CHALLENGE, TRIVY, TRIVY_CACHE, ALPINE_IMAGE, cage, docker, ensureCacheVolume, haveDb, pipeDocker, removeByName, trivyArgs } from '../lib.mjs';

export { TRIVY, TRIVY_CACHE, ALPINE_IMAGE, cage, docker, haveDb, removeByName, run, label, name, CHALLENGE };

/** Build a result line. */
export function resultLine(stage, status, fields = {}) {
  const kv = Object.entries(fields).map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_')}`);
  return [stage, status, ...kv].join(' ');
}

/** Read a result line back. Returns { stage, status, fields } or null. Looks at the LAST matching line. */
export function parseResult(text) {
  const lines = String(text).split(/\r?\n/).reverse();
  for (const l of lines) {
    const m = /^(scan|sbom|sign) (ok|failed|partial)((?: [A-Za-z0-9_.-]+=\S*)*)$/.exec(l.trim());
    if (m) return { stage: m[1], status: m[2], fields: Object.fromEntries([...m[3].matchAll(/ ([A-Za-z0-9_.-]+)=(\S*)/g)].map((x) => [x[1], x[2]])) };
  }
  return null;
}

/**
 * Run a hook body. The body returns { status, fields }. Prints the single result line and exits 0 for ok and
 * partial, 1 for failed. An exception is a failure: the line says so.
 */
export async function hook(stage, body) {
  const started = Date.now();
  let out;
  try {
    const ref = process.argv[2];
    if (!ref) throw new Error('usage: node hooks/<stage>.mjs <image reference>');
    out = await body(ref);
  } catch (e) {
    out = { status: 'failed', fields: { reason: String(e.message).split('\n')[0].slice(0, 80) } };
  }
  out.fields = { ...out.fields, seconds: ((Date.now() - started) / 1000).toFixed(1) };
  process.stdout.write(`${resultLine(stage, out.status, out.fields)}\n`);
  process.exit(out.status === 'failed' ? 1 : 0);
}

/** A unique, labelled volume for one hook run. Returns its name. */
export function tempVolume(what) {
  const v = `${name(CHALLENGE, `hook-${what}`)}-${randomBytes(3).toString('hex')}`;
  docker(['volume', 'create', ...label(CHALLENGE), v]);
  return v;
}
export const dropVolume = (v) => run(['volume', 'rm', '-f', v]);

/** Make sure the pinned scanner image is here. It is pulled by digest, so a moved tag cannot change it. */
export function ensureScanner() {
  if (run(['image', 'inspect', TRIVY]).code === 0) return;
  const p = run(['pull', '--quiet', TRIVY], { timeoutMs: 300_000 });
  if (p.code !== 0) throw new Error('cannot pull the pinned scanner');
}

/** Save a local image as a tar file inside a volume (docker save into a throwaway alpine container). */
export async function saveImage(ref, volume) {
  if (run(['image', 'inspect', ref]).code !== 0) throw new Error('image not found on this Docker');
  const w = await pipeDocker(['save', ref], ['run', '-i', '--rm', ...cage('hook-writer'), '-v', `${volume}:/in`, ALPINE_IMAGE, 'sh', '-c', 'mkdir -p /in/tmp && cat > /in/img.tar'], { timeoutMs: 300_000 });
  removeByName('hook-writer');
  if (w.code !== 0) throw new Error('could not save the image');
}

/** Run the pinned scanner on the saved tar. Temporary files go to the volume, not to memory. */
export function trivyOnTar(volume, args, { timeoutMs = 300_000 } = {}) {
  removeByName('hook-trivy');
  const r = run(trivyArgs('hook-trivy', ['image', '--input', '/in/img.tar', '--quiet', ...args], ['-e', 'TMPDIR=/in/tmp', '-v', `${volume}:/in`]), { timeoutMs });
  removeByName('hook-trivy');
  return r;
}

/** Download the vulnerability database into the kept cache volume. About 139 MB, about 1.7 GB on disk, once. */
export function downloadDb() {
  ensureCacheVolume();
  docker(['run', '--rm', ...cage('hook-dbtmp'), '-v', `${TRIVY_CACHE}:/c`, ALPINE_IMAGE, 'mkdir', '-p', '/c/tmp']);
  removeByName('hook-dbtmp');
  const r = run(trivyArgs('hook-dbdownload', ['image', '--download-db-only', '--quiet', '--no-progress'], ['-e', 'TMPDIR=/root/.cache/tmp']), { timeoutMs: 900_000 });
  removeByName('hook-dbdownload');
  if (r.code !== 0) throw new Error('database download failed');
}
