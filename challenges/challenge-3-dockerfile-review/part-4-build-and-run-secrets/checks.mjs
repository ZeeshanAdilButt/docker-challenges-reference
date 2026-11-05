// The checks for part 4. Used by run.mjs and test.mjs. Provided, nothing to edit.

import { copyFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, safeArgs } from '../../../toolkit/docker.js';
import { N, build, docker, makeAppContext, save } from '../lib/common.mjs';
import { openImage, layerFiles } from '../lib/image.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const BUILD_TOKEN = 'dkr-demo-fake-npm-token-4c1e-not-real'; // made up. Opens nothing.
export const RUNTIME_KEY = 'dkr-demo-fake-api-key-b72d-not-real'; // made up. Opens nothing.
export const fingerprint = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);

/** daftar-api plus check-secret.mjs. */
export function makeContext(dir) {
  makeAppContext(dir);
  copyFileSync(join(here, 'check-secret.mjs'), join(dir, 'check-secret.mjs'));
  return dir;
}

/** Write a secret file with no trailing newline, readable by everyone (the container user is not you). */
export function writeSecret(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, value);
  chmodSync(file, 0o644);
  return file;
}

/** Build with the token given BOTH ways, so that any Dockerfile can use either. */
export function buildWithToken(dockerfile, ctx, tag, tokenFile) {
  return build({ tag, dockerfile, context: ctx, args: ['--build-arg', `NPM_TOKEN=${BUILD_TOKEN}`, '--secret', `id=npm_token,src=${tokenFile}`] });
}

/** Where is the token? Looks in docker history, in the config blob, and in every file of every layer of the saved image. */
export function scanImage(tag, workDir) {
  const history = docker(['history', '--no-trunc', '--format', '{{.CreatedBy}}', tag]).includes(BUILD_TOKEN);
  const tarFile = join(workDir, `${tag.replace(/[^a-z0-9]/gi, '_')}.tar`);
  save(tag, tarFile);
  const img = openImage(tarFile);
  const config = JSON.stringify(img.config).includes(BUILD_TOKEN);
  const layers = img.layers.some((l) => layerFiles(l).some((f) => f.type === 'file' && f.data.includes(BUILD_TOKEN)));
  return { history, config, layers };
}

/** What the image says about the build-time use of the token: build-proof.txt holds the fingerprint of the token. */
export function buildProof(tag) {
  return run(['run', '--rm', ...safeArgs(N, 'p4proof'), tag, 'cat', '/app/build-proof.txt']).stdout.trim();
}

/**
 * Start a container with the flags from runArgs and look at it from outside and inside.
 * Returns { source, fingerprintOk, inspectHasKey, flagsHaveKey, mountReadonly, mounted }.
 */
export function runtimeCheck(tag, runArgs, keyFile) {
  const flags = runArgs(keyFile);
  const name = 'p4-rt';
  const ctr = `dkr-c3-${name}`;
  const out = { source: null, fingerprintOk: false, inspectHasKey: false, flagsHaveKey: flags.join(' ').includes(RUNTIME_KEY), mountReadonly: false, mounted: false };
  try {
    const r = run(['run', '-d', ...safeArgs(N, name, { memory: '64m' }), ...flags, tag, 'sleep', '60']);
    if (r.code !== 0) return { ...out, error: (r.stderr || r.stdout).trim() };
    const inspect = docker(['inspect', ctr, '--format', '{{json .Config.Env}} {{json .Mounts}} {{json .HostConfig.Binds}}']);
    out.inspectHasKey = inspect.includes(RUNTIME_KEY);
    const mounts = JSON.parse(docker(['inspect', ctr, '--format', '{{json .Mounts}}']));
    out.mounted = mounts.some((m) => m.Destination.startsWith('/run/secrets/'));
    out.mountReadonly = mounts.length > 0 && mounts.filter((m) => m.Destination.startsWith('/run/secrets/')).every((m) => m.RW === false);
    const e = run(['exec', ctr, 'node', '/app/check-secret.mjs']);
    if (e.code === 0) {
      const j = JSON.parse(e.stdout.trim());
      out.source = j.source;
      out.fingerprintOk = j.fingerprint === fingerprint(RUNTIME_KEY);
    } else {
      out.error = e.stderr.trim();
    }
  } finally {
    run(['rm', '-f', '-v', ctr]);
  }
  return out;
}
