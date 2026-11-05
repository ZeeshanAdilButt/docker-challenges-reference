// Helpers for part 2: build the leaky image from a folder, then hunt for the four canary strings in it.
// The canaries are FAKE values made for this challenge. Each one contains the text "dkrcanary".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../../../toolkit/docker.js';
import { findInImage } from '../layers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const CANARIES = JSON.parse(readFileSync(join(here, 'secrets', 'canaries.json'), 'utf8'));
export const VECTORS = [
  { key: 'env_file', title: 'a .env file copied into the image', fix: 'keep it out of the build context with .dockerignore' },
  { key: 'build_arg', title: 'a token passed as a build argument', fix: 'use a BuildKit secret mount, never ARG' },
  { key: 'env_var', title: 'an API key baked in with ENV', fix: 'pass it at run time with -e or an env file' },
  { key: 'deleted_key', title: 'a key copied in and deleted again', fix: 'never copy it; a later rm leaves it in the earlier layer' },
];

/** Build an image from a folder with the Dockerfile in it. Returns { ok, seconds, output }. */
export function build(dir, tag) {
  const t0 = process.hrtime.bigint();
  const r = run(
    ['build', '--quiet', '-t', tag, '--label', 'dkr.challenge=12', '--build-arg', `NPM_TOKEN=${CANARIES.build_arg}`, '--secret', `id=npm_token,src=${join(here, 'secrets', 'npm_token')}`, dir],
    { timeoutMs: 300_000 },
  );
  return { ok: r.code === 0, seconds: Number(process.hrtime.bigint() - t0) / 1e9, output: `${r.stdout}${r.stderr}`.trim() };
}

/** Where is each canary in the image? Returns { found: { key: [where] }, layers, configs }. */
export const hunt = (tag) => findInImage(tag, CANARIES);

/** Run `node server.mjs --check` in the image with the API key given at run time. */
export function check(tag, what) {
  run(['rm', '-f', `dkr-c12-${what}`]);
  const r = run(['run', '--rm', '--name', `dkr-c12-${what}`, '--label', 'dkr.challenge=12', '--memory', '64m', '--memory-swap', '64m', '--pids-limit', '50', '--log-opt', 'max-size=1m', '--security-opt', 'no-new-privileges', '-e', `API_KEY=${CANARIES.env_var}`, tag, 'node', 'server.mjs', '--check']);
  try {
    return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  } catch {
    return { error: `${r.stdout}${r.stderr}`.trim().slice(0, 300) };
  }
}

export const history = (tag) => run(['history', '--no-trunc', '--format', '{{.CreatedBy}}', tag]).stdout;
export const userOf = (tag) => run(['image', 'inspect', tag, '--format', '{{.Config.User}}']).stdout.trim();
export const removeImage = (tag) => run(['rmi', '-f', tag]);
