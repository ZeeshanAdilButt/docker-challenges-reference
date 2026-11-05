// Shared helpers for the four parts of challenge 2.
// Images made here are named dkr-c2-... and labelled dkr.challenge=2. Images are not removed by
// cleanup(2) (it only handles containers, networks and volumes), so every part removes its own
// images by their full tag with removeImages().

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run } from '../../../toolkit/docker.js';

export const N = 2;

/** True when the scripts and tests should use each part's reference/ folder instead of the starter files. */
export const useReference = process.env.DKR_TARGET === 'reference';
/** The folder with the files the learner edits (the part folder, or its reference/ folder). */
export const workDir = (partDir) => (useReference ? join(partDir, 'reference') : partDir);

export function docker(args, opts = {}) {
  const r = run(args, opts);
  if (r.code !== 0) throw new Error(`docker ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

export const tmp = (what) => mkdtempSync(join(tmpdir(), `dkr-c2-${what}-`));
export const rmTree = (dir) => rmSync(dir, { recursive: true, force: true });

/** Build an image. Returns { code, out } where out is the plain build log. Never throws. */
export function build({ tag, dockerfile, context, args = [] }) {
  const cmd = ['build', '--progress=plain', '--provenance=false', '--sbom=false', '--label', 'dkr.challenge=2', '-t', tag, '-f', dockerfile, ...args, context];
  const r = run(cmd, { timeoutMs: 300_000 });
  return { code: r.code, out: `${r.stdout}\n${r.stderr}` };
}

/** docker save into a file. */
export function save(tag, file) {
  docker(['save', '-o', file, tag], { timeoutMs: 300_000 });
}

/** Remove images by tag. Refuses any tag that is not ours (it must contain "dkr-c2-"). */
export function removeImages(...tags) {
  for (const t of tags) {
    if (!t.includes('dkr-c2-')) throw new Error(`refusing to remove ${t}: not a dkr-c2- image`);
    run(['image', 'rm', t]);
  }
}

export const mb = (bytes, d = 1) => Math.round((bytes / 1e6) * 10 ** d) / 10 ** d;
export const short = (digest, n = 12) => digest.replace('sha256:', '').slice(0, n);
