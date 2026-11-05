// What "fixed" means for each of the five Dockerfiles. Used by run.mjs and test.mjs. Provided, nothing to edit.
//
// Each check builds the Dockerfile for real and looks at the result. It never pulls a base image: if the
// Dockerfile starts from an image that is not on your machine, the check says so and stops.

import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { run, safeArgs } from '../../../toolkit/docker.js';
import { N, BASE, build, docker, getInside, imageExists, makeAppContext, parseDockerfile, stepCached, waitHealthy } from '../lib/common.mjs';
import { review } from './review.mjs';

export const SECRET = 'dkr-demo-fake-session-secret-not-real'; // made up. Opens nothing.
export const NAMES = ['01-unpinned-root', '02-cache-buster', '03-leaky-env', '04-add-and-shell', '05-no-ignore'];

/** The shared build context: daftar-api, plus an env file with a made-up secret and some notes that must not ship. */
export function makeContext(dir) {
  makeAppContext(dir);
  writeFileSync(join(dir, '.env.local'), `SESSION_SECRET=${SECRET}\n`);
  mkdirSync(join(dir, 'notes'), { recursive: true });
  writeFileSync(join(dir, 'notes', 'standup.md'), '# standup\nnotes for people, not for the image\n');
  return dir;
}

/** Name of the first base image the Dockerfile needs that is not on this machine, or null. */
export function missingBase(dockerfile) {
  const { stages } = parseDockerfile(readFileSync(dockerfile, 'utf8'));
  for (const st of stages) {
    const isStage = stages.some((s) => s.name && s.name.toLowerCase() === st.from.toLowerCase());
    if (!isStage && st.from !== 'scratch' && !imageExists(st.from)) return st.from;
  }
  return null;
}

const oneShot = (tag, cmd) => run(['run', '--rm', ...safeArgs(N, 'p1check'), tag, ...cmd]);

/**
 * Build one Dockerfile and test the property its fault was about.
 * Returns { name, findings, built, buildLog, healthy, pid, ok, detail, rebuildMs }.
 */
export async function checkOne(name, dockerfile, ctx, tag) {
  const findings = review(dockerfile);
  const out = { name, findings, built: false, buildLog: '', healthy: false, pid: null, ok: false, detail: '', rebuildMs: null };
  const missing = missingBase(dockerfile);
  if (missing) {
    out.detail = `base image ${missing} is not on this machine, so the build is skipped. Use ${BASE}.`;
    return out;
  }
  const b = build({ tag, dockerfile, context: ctx });
  out.buildLog = b.out;
  if (b.code !== 0) {
    out.detail = `the build failed: ${b.out.split('\n').filter(Boolean).slice(-4).join(' | ')}`;
    return out;
  }
  out.built = true;

  const id = name.slice(0, 2);
  const ctr = `dkr-c3-p1-${id}`;
  try {
    docker(['run', '-d', ...safeArgs(N, `p1-${id}`, { memory: '96m' }), tag]);
    try {
      await waitHealthy(ctr);
    } catch (e) {
      out.detail = `the container did not answer /health: ${e.message}`;
      return out;
    }
    out.healthy = true;
    out.pid = Number(JSON.parse(getInside(ctr, '/pid') ?? '{}').pid);

    if (name === '01-unpinned-root') {
      const uid = oneShot(tag, ['id', '-u']).stdout.trim();
      const unpinned = findings.some((f) => f.rule === 'base-not-pinned');
      out.ok = uid !== '0' && !unpinned;
      out.detail = `user id ${uid}; base image ${unpinned ? 'not pinned' : 'pinned'}`;
    } else if (name === '02-cache-buster') {
      const times = [];
      let cached = null;
      for (let i = 0; i < 3; i++) {
        const dir2 = `${ctx}-edit${i}`;
        cpSync(ctx, dir2, { recursive: true });
        appendFileSync(join(dir2, 'server.mjs'), `\n// edit ${i} ${Date.now()}\n`);
        const b2 = build({ tag, dockerfile, context: dir2 });
        times.push(b2.ms);
        cached = stepCached(b2.out, /npm ci/);
      }
      times.sort((a, c) => a - c);
      out.rebuildMs = times[1];
      out.ok = cached === true;
      out.detail = `after a code change the npm ci step was ${cached === true ? 'CACHED' : 'run again'}; rebuild took ${(times[1] / 1000).toFixed(1)} s (median of 3)`;
    } else if (name === '03-leaky-env') {
      const env = docker(['image', 'inspect', tag, '--format', '{{json .Config.Env}}']);
      const hist = docker(['history', '--no-trunc', '--format', '{{.CreatedBy}}', tag]);
      out.ok = !env.includes(SECRET) && !hist.includes(SECRET);
      out.detail = `secret in docker inspect Env: ${env.includes(SECRET)}; in docker history: ${hist.includes(SECRET)}`;
    } else if (name === '04-add-and-shell') {
      out.ok = out.pid === 1;
      out.detail = `the node process is PID ${out.pid}${out.pid === 1 ? '' : ' (a wrapper is PID 1; whether it passes signals on depends on the wrapper, and part 2 measures it)'}`;
    } else if (name === '05-no-ignore') {
      const ls = oneShot(tag, ['ls', '-A', '/app']).stdout.split('\n');
      const junk = ['.env.local', 'notes', 'test.mjs'].filter((f) => ls.includes(f));
      out.ok = junk.length === 0;
      out.detail = junk.length ? `these should not be in the image: ${junk.join(', ')}` : 'no env file, notes or tests in /app';
    }
  } finally {
    run(['rm', '-f', '-v', ctr]);
  }
  return out;
}
