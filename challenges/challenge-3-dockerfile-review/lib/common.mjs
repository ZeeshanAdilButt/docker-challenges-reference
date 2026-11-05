// Shared helpers for the four parts of challenge 3.
// Images made here are named dkr-c3-... and labelled dkr.challenge=3. cleanup(3) does not remove images,
// so every part removes its own images by their full tag with removeImages().

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, waitFor } from '../../../toolkit/docker.js';

export const N = 3;
export const BASE = 'node:24-alpine'; // already on your machine from challenge 0; no download

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** True when the scripts and tests should use each part's reference/ folder instead of the starter files. */
export const useReference = process.env.DKR_TARGET === 'reference';
/** The folder with the files the learner edits (the part folder, or its reference/ folder). */
export const workDir = (partDir) => (useReference ? join(partDir, 'reference') : partDir);

export function docker(args, opts = {}) {
  const r = run(args, opts);
  if (r.code !== 0) throw new Error(`docker ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

export const tmp = (what) => mkdtempSync(join(tmpdir(), `dkr-c3-${what}-`));
export const rmTree = (dir) => rmSync(dir, { recursive: true, force: true });

/**
 * A build context with daftar-api in it: server.mjs, package.json, test.mjs and a package-lock.json
 * (daftar-api has no dependencies, so the lock file is an empty one that lets `npm ci` run without a network).
 */
export function makeAppContext(dir) {
  mkdirSync(dir, { recursive: true });
  for (const f of ['server.mjs', 'package.json', 'test.mjs']) cpSync(join(repoRoot, 'daftar-api', f), join(dir, f));
  writeFileSync(
    join(dir, 'package-lock.json'),
    JSON.stringify({ name: 'daftar-api', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'daftar-api', version: '1.0.0', engines: { node: '>=22' } } } }, null, 2),
  );
  return dir;
}

/** Build an image. Returns { code, out, ms }. Never throws. `args` are extra docker build flags. */
export function build({ tag, dockerfile, context, args = [], target }) {
  const cmd = ['build', '--progress=plain', '--provenance=false', '--sbom=false', '--label', 'dkr.challenge=3', '-t', tag, '-f', dockerfile];
  if (target) cmd.push('--target', target);
  cmd.push(...args, context);
  const t0 = process.hrtime.bigint();
  const r = run(cmd, { timeoutMs: 300_000 });
  return { code: r.code, out: `${r.stdout}\n${r.stderr}`, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

/** Did the build step whose text matches `re` come from the cache? true, false, or null when no such step is in the log. */
export function stepCached(log, re) {
  const lines = log.split(/\r?\n/);
  const header = lines.find((l) => /^#\d+ \[/.test(l) && re.test(l));
  if (!header) return null;
  const id = header.match(/^#(\d+) /)[1];
  return lines.some((l) => l.startsWith(`#${id} CACHED`));
}

/** Remove images by tag. Refuses any tag that is not ours (it must contain "dkr-c3-"). */
export function removeImages(...tags) {
  for (const t of tags) {
    if (!t.includes('dkr-c3-')) throw new Error(`refusing to remove ${t}: not a dkr-c3- image`);
    run(['image', 'rm', t]);
  }
}

export const imageExists = (tag) => run(['image', 'inspect', tag]).code === 0;

/** GET a path from inside a running daftar-api container. Returns the text, or null. */
export function getInside(ctr, path) {
  const r = run(['exec', ctr, 'node', '-e', `fetch('http://127.0.0.1:8080${path}').then((r) => r.text()).then((t) => console.log(t))`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Wait until the container answers /health. */
export const waitHealthy = (ctr, timeoutMs = 60_000) => waitFor(() => getInside(ctr, '/health'), { timeoutMs, intervalMs: 300, what: `${ctr} to answer /health` });

/**
 * Parse a Dockerfile into instructions and stages. Handles comments, blank lines and "\" continuations.
 * Returns { instructions: [{ cmd, args, line }], stages: [{ name, from, index, instructions }] }.
 */
export function parseDockerfile(text) {
  const instructions = [];
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    if (/^\s*(#|$)/.test(line)) continue;
    const start = i + 1;
    while (/\\\s*$/.test(line) && i + 1 < raw.length) {
      i++;
      if (/^\s*#/.test(raw[i])) continue;
      line = `${line.replace(/\\\s*$/, ' ')}${raw[i].trim()}`;
    }
    const m = line.trim().match(/^(\S+)\s*(.*)$/s);
    instructions.push({ cmd: m[1].toUpperCase(), args: m[2], line: start });
  }
  const stages = [];
  for (const ins of instructions) {
    if (ins.cmd === 'FROM') {
      const f = ins.args.match(/^(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i);
      stages.push({ name: f[2] ?? null, from: f[1], index: stages.length, instructions: [ins] });
    } else if (stages.length) stages.at(-1).instructions.push(ins);
  }
  return { instructions, stages };
}

/** True when args is exec form: a JSON array such as ["node", "server.mjs"]. */
export function isExecForm(args) {
  try {
    return Array.isArray(JSON.parse(args));
  } catch {
    return false;
  }
}

export const mb = (bytes, d = 1) => Math.round((bytes / 1e6) * 10 ** d) / 10 ** d;

/** docker save into a file. */
export function save(tag, file) {
  docker(['save', '-o', file, tag], { timeoutMs: 300_000 });
}
