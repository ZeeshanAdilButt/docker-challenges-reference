// The checks for part 3. Used by run.mjs and test.mjs. Provided, nothing to edit.

import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv } from 'node:crypto';
import { join } from 'node:path';

import { run, safeArgs } from '../../../toolkit/docker.js';
import { N, build, docker, makeAppContext, parseDockerfile, waitHealthy } from '../lib/common.mjs';

export const TOOLCHAIN_BYTES = 30_000_000; // a pretend compiler: bytes that do not compress

/** daftar-api plus toolchain/compiler.bin. Same bytes every time. */
export function makeContext(dir) {
  makeAppContext(dir);
  mkdirSync(join(dir, 'toolchain'), { recursive: true });
  const cipher = createCipheriv('aes-128-ctr', Buffer.alloc(16, 7), Buffer.alloc(16));
  writeFileSync(join(dir, 'toolchain', 'compiler.bin'), cipher.update(Buffer.alloc(TOOLCHAIN_BYTES)));
  return dir;
}

/** A copy of the context where one test fails on purpose. */
export function withFailingTest(ctx) {
  const dir = `${ctx}-failing`;
  cpSync(ctx, dir, { recursive: true });
  appendFileSync(join(dir, 'test.mjs'), "\ntest('forced failure for the pipeline check', () => {\n  assert.equal(1, 2, 'forced failure');\n});\n");
  return dir;
}

/** Stage names and count of a Dockerfile. */
export function stagesOf(dockerfile) {
  const { stages } = parseDockerfile(readFileSync(dockerfile, 'utf8'));
  return { count: stages.length, names: stages.map((s) => s.name), last: stages.at(-1)?.name ?? null };
}

/** How many tests `node --test` reported in a build log (the line "tests 12"), or 0. */
export function testsRun(log) {
  const m = log.match(/(?:^|\s)tests\s+(\d+)/m);
  return m ? Number(m[1]) : 0;
}

/** Size of the root file system inside an image, in bytes (du -sx /). The same number in every image store. */
export function rootBytes(tag) {
  const r = run(['run', '--rm', ...safeArgs(N, 'p3size'), tag, 'sh', '-c', 'du -sxk / 2>/dev/null | cut -f1']);
  return Number(r.stdout.trim()) * 1024;
}

/** Look inside the runtime image. */
export function inspectRuntime(tag) {
  const ls = (path) => run(['run', '--rm', ...safeArgs(N, 'p3ls'), tag, 'sh', '-c', `ls -A ${path} 2>/dev/null`]).stdout.split('\n').filter(Boolean);
  const uid = run(['run', '--rm', ...safeArgs(N, 'p3id'), tag, 'id', '-u']).stdout.trim();
  return { app: ls('/app'), opt: ls('/opt'), uid };
}

export async function healthy(tag) {
  const ctr = 'dkr-c3-p3-run';
  try {
    docker(['run', '-d', ...safeArgs(N, 'p3-run', { memory: '96m' }), tag]);
    await waitHealthy(ctr);
    return true;
  } catch {
    return false;
  } finally {
    run(['rm', '-f', '-v', ctr]);
  }
}

export { build };
