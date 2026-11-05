// Shared pieces for challenge 13 (ship it) and challenge 14 (capstone). Plain Node, no packages.
//
//   const k = kit(13);
//
// gives you, for challenge number n:
//   - a local registry (registry:3) that the "production host" can pull from
//   - the production host: ONE Docker-in-Docker container (docker:29-dind), reached through a Docker context
//   - a proxy in front of the app on that host, and a blue/green rollout that waits for health
//   - a load generator that counts failed requests
//   - the pipeline stages (lint, build, test, scan, sbom, sign, push) as a local equivalent of the GitHub workflow
//
// WHY THERE IS ONE PRIVILEGED CONTAINER (the single named exception to "no --privileged"):
//   A "production host" you can break must be a separate Docker engine, and a Docker engine inside a container needs
//   --privileged to start. It is a throwaway (named dkr-c<n>-prod, labelled, memory and process capped, its disk is a
//   size-capped tmpfs). Nothing mounts the Docker socket of your machine. The API of this engine is reached over TLS
//   with a client certificate made for this run, on 127.0.0.1 only. Teardown removes the container, the context and the
//   certificates.

import net from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';

import { cleanup, label, name as nameOf, run, safeArgs, waitFor } from '../../toolkit/docker.js';
import { getFact, setFact } from '../../toolkit/facts.js';

export const DIND_IMAGE = 'docker:29-dind';
export const REGISTRY_IMAGE = 'registry:3';
export const NGINX_IMAGE = 'nginx:1.27-alpine';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const secs = (ms) => Math.round(ms / 100) / 10;
export const short = (digest) => String(digest ?? '').replace(/^sha256:/, '').slice(0, 12);
export const here13 = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here13, '..', '..');

export const useReference = () => process.env.DKR_USE_REFERENCE === '1' || process.argv.includes('--reference');

/** Path of a part file. With the reference switch on, reference/<name> wins when it exists. */
export function pick(partDir, rel) {
  if (useReference()) {
    const ref = join(partDir, 'reference', rel);
    if (existsSync(ref)) return ref;
  }
  return join(partDir, rel);
}

/** Keep at most n lines. Longer output keeps the head and the tail, with a marker line between. */
export function clip(text, n = 25) {
  const lines = String(text).replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines.length <= n) return lines.join('\n');
  const head = Math.ceil((n - 1) / 2);
  const tail = n - 1 - head;
  return [...lines.slice(0, head), `... (${lines.length - head - tail} lines left out)`, ...lines.slice(lines.length - tail)].join('\n');
}

/** Save facts, then read them back. Other builders write facts.json too, so retry. */
export function saveFacts(facts) {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const [k, v] of Object.entries(facts)) if (getFact(k) !== v) setFact(k, v);
    if (Object.entries(facts).every(([k, v]) => getFact(k) === v)) return;
  }
  throw new Error('could not save all facts to facts.json');
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export const lastLines = (r, n = 6) => `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/).slice(-n).join('\n');

/** Pipe `docker <firstArgs>` into `docker <secondArgs>` (for docker save | docker load). */
export function pipeDocker(firstArgs, secondArgs, { timeoutMs = 240_000 } = {}) {
  return new Promise((resolve) => {
    const a = spawn('docker', firstArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const b = spawn('docker', secondArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    a.stdout.pipe(b.stdin);
    a.stderr.on('data', (d) => (err += d));
    b.stdout.on('data', (d) => (out += d));
    b.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      a.kill();
      b.kill();
    }, timeoutMs);
    b.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: out, stderr: err });
    });
  });
}

// ---------------------------------------------------------------------------
// A load generator. Every request is a new connection, so a rollout shows up as a new client would see it.
// ---------------------------------------------------------------------------
const classify = (err) => {
  const c = err.code ?? '';
  if (c === 'ECONNREFUSED') return 'refused';
  if (c === 'ECONNRESET' || c === 'EPIPE' || /socket hang up/i.test(err.message)) return 'reset';
  if (c === 'ETIMEDOUT' || err.message === 'timeout') return 'timeout';
  return 'other';
};

/** startLoad({ url, paths }) returns { stop() }. stop() resolves with the counts. */
export function startLoad({ url, paths = ['/', '/slow?ms=100'], concurrency = 6, thinkMs = 5, timeoutMs = 3000 }) {
  const t0 = Date.now();
  const result = { total: 0, ok: 0, failed: 0, refused: 0, reset: 0, timeout: 0, http_5xx: 0, other: 0, versions: {}, failures: [] };
  let running = true;
  let i = 0;
  const one = (path) =>
    new Promise((resolve) => {
      const started = Date.now();
      const fail = (kind) => {
        result.failed += 1;
        result[kind] += 1;
        result.failures.push({ at: started - t0, kind });
        resolve();
      };
      const req = http.get(new URL(path, url), { agent: false, timeout: timeoutMs }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            result.ok += 1;
            try {
              const v = JSON.parse(body).version;
              if (v) result.versions[v] = (result.versions[v] ?? 0) + 1;
            } catch { /* not JSON */ }
            resolve();
          } else fail('http_5xx');
        });
        res.on('error', (e) => fail(classify(e)));
        res.on('aborted', () => fail('reset'));
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', (e) => fail(classify(e)));
    });
  const worker = async () => {
    while (running) {
      result.total += 1;
      await one(paths[i++ % paths.length]);
      if (thinkMs) await sleep(thinkMs);
    }
  };
  const workers = Array.from({ length: concurrency }, worker);
  return {
    async stop() {
      running = false;
      await Promise.all(workers);
      result.duration_ms = Date.now() - t0;
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Static checks of a GitHub Actions workflow (text only; this machine cannot run Actions).
// ---------------------------------------------------------------------------
export function checkWorkflow(file) {
  // Comments are dropped first, so a comment that mentions a bad habit does not count as the habit.
  const text = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
  const lines = text.split('\n');
  const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  return {
    actions: uses.length,
    unpinned: uses.filter((u) => !/@[0-9a-f]{40}$/.test(u)).length,
    writeAll: /permissions:\s*write-all/.test(text),
    topLevelPermissions: /^permissions:/m.test(text),
    permissionBlocks: [...text.matchAll(/^\s*permissions:/gm)].length,
    packagesWrite: /packages:\s*write/.test(text),
    idTokenWrite: /id-token:\s*write/.test(text),
    pushGuarded: lines.some((l) => /^\s*push:\s*\$\{\{[^}]*(pull_request|event_name)/.test(l)),
    pushAlways: lines.some((l) => /^\s*push:\s*true\b/.test(l)),
    usesGithubToken: /secrets\.GITHUB_TOKEN/.test(text),
    hardcodedSecret: /(password|token):\s*(?!\$\{\{)[^\s#]{8,}/i.test(text),
    printsDigest: /steps\.[a-z_-]+\.outputs\.digest/.test(text),
    deployNeedsBuild: /needs:\s*\[?\s*(build|ship|publish)/.test(text),
    pullRequestTarget: /pull_request_target/.test(text),
    cacheGha: /cache-from:\s*type=gha/.test(text) && /cache-to:\s*type=gha/.test(text),
    hasTestStep: /target:\s*test/.test(text),
    hasScan: /scan/i.test(text),
    hasSign: /sign/i.test(text),
    hasSbom: /sbom/i.test(text),
    hasMetadata: uses.some((u) => u.startsWith('docker/metadata-action@')),
    uses,
  };
}

// ---------------------------------------------------------------------------
// The kit for one challenge number.
// ---------------------------------------------------------------------------
export function kit(n) {
  const NET = nameOf(n, 'net');
  const REG = nameOf(n, 'registry');
  const PROD = nameOf(n, 'prod');
  const CTX = PROD;
  const REPO_PREFIX = `dkr-c${n}`;
  const state = { regPort: 0, ctxDir: '', prodPorts: {} };

  const docker = (args, opts = {}) => {
    const r = run(args, opts);
    if (r.code !== 0) throw new Error(`docker ${args.slice(0, 4).join(' ')} failed (exit ${r.code}): ${lastLines(r, 4)}`);
    return r.stdout.trim();
  };
  const prod = (args, opts = {}) => run(['--context', CTX, ...args], opts);
  const prodDocker = (args, opts = {}) => docker(['--context', CTX, ...args], opts);

  function ensureNet() {
    if (run(['network', 'inspect', NET]).code !== 0) docker(['network', 'create', ...label(n), NET]);
  }

  /** registry:3 on the shared network. Pushes must go to a FIXED port on Docker Desktop (see NOTES.md of challenge 2). */
  async function startRegistry() {
    ensureNet();
    const port = await freePort();
    const args = ['run', '-d', ...safeArgs(n, 'registry', { memory: '256m', pids: 100 }), '--network', NET, '-p', `127.0.0.1:${port}:5000`, '-e', 'REGISTRY_LOG_LEVEL=warn', '-e', 'REGISTRY_STORAGE_DELETE_ENABLED=true', REGISTRY_IMAGE];
    docker(args);
    const base = `http://127.0.0.1:${port}`;
    await waitFor(() => fetch(`${base}/v2/`).then((x) => x.status === 200).catch(() => false), { timeoutMs: 30_000, intervalMs: 150, what: 'the registry to answer /v2/' });
    state.regPort = port;
    return { name: REG, port, base, host: `127.0.0.1:${port}`, inner: `${REG}:5000` };
  }

  const regHost = () => `127.0.0.1:${state.regPort}`;
  const regBase = () => `http://127.0.0.1:${state.regPort}`;
  const ACCEPT = 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';

  /** The digest the registry holds for repo:tag (HEAD), or null. */
  async function digestOf(repo, tag) {
    try {
      const r = await fetch(`${regBase()}/v2/${repo}/manifests/${tag}`, { method: 'HEAD', headers: { accept: ACCEPT } });
      return r.status === 200 ? r.headers.get('docker-content-digest') : null;
    } catch {
      return null;
    }
  }

  async function tagsOf(repo) {
    try {
      const r = await fetch(`${regBase()}/v2/${repo}/tags/list`);
      return r.status === 200 ? ((await r.json()).tags ?? []) : [];
    } catch {
      return [];
    }
  }

  /** Start the production host: docker:29-dind, privileged on purpose, capped, with a TLS context. */
  async function startProd({ ports = [8080], memory = '3g', tmpfsMb = 2000 } = {}) {
    ensureNet();
    const args = [
      'run', '-d', '--name', PROD, ...label(n),
      '--privileged', // the one named exception: a Docker engine inside a container needs it
      '--memory', memory, '--memory-swap', memory, '--pids-limit', '1024',
      '--log-opt', 'max-size=1m', '--log-opt', 'max-file=2',
      '--network', NET,
      '-e', 'DOCKER_TLS_CERTDIR=/certs',
      '--tmpfs', `/var/lib/docker:rw,size=${tmpfsMb}m`, // the host's disk: a size-capped tmpfs, gone at teardown
      '-p', '127.0.0.1::2376',
      ...ports.flatMap((p) => ['-p', `127.0.0.1::${p}`]),
      DIND_IMAGE,
      `--insecure-registry=${REG}:5000`,
    ];
    docker(args, { timeoutMs: 180_000 });
    await waitFor(() => run(['exec', PROD, 'test', '-s', '/certs/client/key.pem']).code === 0, { timeoutMs: 60_000, intervalMs: 300, what: 'the host to make its TLS certificates' });
    const dir = mkdtempSync(join(tmpdir(), `dkr-c${n}-ctx-`));
    state.ctxDir = dir;
    docker(['cp', `${PROD}:/certs/client/.`, dir]);
    const apiPort = docker(['port', PROD, '2376/tcp']).match(/:(\d+)\s*$/m)?.[1];
    if (!apiPort) throw new Error('the production host did not publish its API port');
    run(['context', 'rm', '-f', CTX]);
    docker(['context', 'create', CTX, '--docker', `host=tcp://127.0.0.1:${apiPort},ca=${join(dir, 'ca.pem')},cert=${join(dir, 'cert.pem')},key=${join(dir, 'key.pem')}`]);
    await waitFor(() => prod(['info', '--format', '{{.ServerVersion}}']).code === 0, { timeoutMs: 60_000, intervalMs: 300, what: 'the production host API' });
    for (const p of ports) {
      const m = docker(['port', PROD, `${p}/tcp`]).match(/:(\d+)\s*$/m);
      state.prodPorts[p] = m ? Number(m[1]) : 0;
    }
    return { ctx: CTX, ports: state.prodPorts, engine: prodDocker(['info', '--format', '{{.ServerVersion}}']) };
  }

  /** Load an image from this machine into the production host (docker save | docker load). */
  async function loadIntoProd(image) {
    const r = await pipeDocker(['save', image], ['--context', CTX, 'load']);
    if (r.code !== 0) throw new Error(`could not load ${image} into the host: ${lastLines(r, 3)}`);
  }

  /** Remove the context, the certificate folder and everything labelled with this challenge. */
  function teardown() {
    run(['context', 'rm', '-f', CTX]);
    if (state.ctxDir) rmSync(state.ctxDir, { recursive: true, force: true });
    state.ctxDir = '';
    return cleanup(n);
  }

  /** Remove the images this challenge built (names that start with dkr-c<n>- or hold /dkr-c<n>/). */
  function removeImages() {
    const r = run(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']);
    const names = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.endsWith(':<none>') && (s.startsWith(`${REPO_PREFIX}-`) || s.includes(`/${REPO_PREFIX}/`)));
    if (names.length) run(['image', 'rm', '--force', ...names]);
    return names;
  }

  // ---- compose and the proxy on the production host ----

  const containerOf = (project, env, file) => {
    const ids = prod(['compose', '-p', project, '-f', file, 'ps', '-q'], { env }).stdout.trim().split(/\s+/).filter(Boolean);
    if (!ids.length) return null;
    return prod(['inspect', '--format', '{{.Name}}', ids[0]]).stdout.trim().replace(/^\//, '');
  };

  /**
   * The proxy and the rollout. startEdge() makes the "edge" network and an nginx on the host (published as hostPort).
   * edge.deploy({ file, env }) starts the next colour with `compose up --wait`, points nginx at it, lets the old
   * colour drain, then removes it. If the new colour never gets healthy, the old one keeps serving.
   */
  async function startEdge({ hostPort = 8080, appPort = 8080 } = {}) {
    prodDocker(['network', 'create', 'edge']);
    await loadIntoProd(NGINX_IMAGE);
    prodDocker(['run', '-d', '--name', 'edge-proxy', '--network', 'edge', '--memory', '64m', '--pids-limit', '50', '-p', `${hostPort}:80`, '--restart', 'unless-stopped', NGINX_IMAGE]);
    const writeConf = (conf) => {
      prodDocker(['exec', '-i', 'edge-proxy', 'sh', '-c', 'cat > /etc/nginx/conf.d/default.conf'], { input: conf });
      prodDocker(['exec', 'edge-proxy', 'nginx', '-s', 'reload']);
    };
    const noBackend = 'server {\n  listen 80;\n  location / { return 503; }\n}\n';
    const proxyConf = (target) =>
      `upstream app {\n  server ${target}:${appPort};\n}\nserver {\n  listen 80;\n  location / {\n    proxy_pass http://app;\n    proxy_http_version 1.1;\n    proxy_set_header Connection "";\n    proxy_connect_timeout 1s;\n    proxy_read_timeout 10s;\n  }\n}\n`;
    writeConf(noBackend);
    const edge = {
      current: null,
      url: `http://127.0.0.1:${state.prodPorts[hostPort]}`,
      async deploy({ file, env, waitS = 60, drainMs = 1500, project = 'daftar' }) {
        const next = edge.current === 'blue' ? 'green' : 'blue';
        const proj = `${project}-${next}`;
        const t0 = Date.now();
        const up = prod(['compose', '-p', proj, '-f', file, 'up', '-d', '--wait', '--wait-timeout', String(waitS)], { env, timeoutMs: (waitS + 90) * 1000 });
        const upMs = Date.now() - t0;
        if (up.code !== 0) {
          const why = lastLines(up, 3);
          prod(['compose', '-p', proj, '-f', file, 'down', '--timeout', '2'], { env });
          return { ok: false, color: next, deploy_ms: upMs, error: why, serving: edge.current };
        }
        const target = containerOf(proj, env, file);
        if (!target) throw new Error('compose started nothing');
        writeConf(proxyConf(target));
        const old = edge.current;
        edge.current = next;
        if (old) {
          await sleep(drainMs);
          prod(['compose', '-p', `${project}-${old}`, '-f', file, 'down', '--timeout', '10'], { env });
        }
        return { ok: true, color: next, container: target, deploy_ms: Date.now() - t0, serving: next };
      },
      /** Take the current colour down without a replacement (a way to reset between trials). */
      reset({ file, env, project = 'daftar' }) {
        for (const c of ['blue', 'green']) prod(['compose', '-p', `${project}-${c}`, '-f', file, 'down', '--timeout', '2'], { env });
        writeConf(noBackend);
        edge.current = null;
      },
    };
    return edge;
  }

  // ---- images and the pipeline stages ----

  const hookFile = (stage) => join(repoRoot, 'challenges', 'challenge-12-scan-harden-sign', 'hooks', `${stage}.mjs`);

  function build({ dir, tag, target = 'release', args = {}, labels = {}, noCache = false }) {
    const a = ['build', '--provenance=false', '--sbom=false', '--target', target, '--label', `dkr.challenge=${n}`, ...(noCache ? ['--no-cache'] : [])];
    for (const [k, v] of Object.entries(args)) a.push('--build-arg', `${k}=${v}`);
    for (const [k, v] of Object.entries(labels)) a.push('--label', `${k}=${v}`);
    a.push('-t', tag, dir);
    const t0 = Date.now();
    const r = run(a, { timeoutMs: 600_000 });
    return { ...r, ms: Date.now() - t0 };
  }

  const tagNames = (rules, { sha, version }) => {
    const out = [];
    for (const rule of rules) {
      if (rule === 'sha') out.push(`sha-${sha.slice(0, 7)}`);
      else if (rule === 'version') out.push(version);
      else if (rule === 'latest') out.push('latest');
      else throw new Error(`pipeline.json: unknown tag rule "${rule}". Use sha, version or latest.`);
    }
    return out;
  };

  const STAGES = ['lint', 'build', 'test', 'scan', 'sbom', 'sign', 'push'];

  /**
   * Run a pipeline. config = { stages: [...], tags: [...] }. Returns the result of each stage.
   * A stage that fails stops the run; later stages are "not run". Nothing is pushed unless the push stage runs.
   * scan, sbom and sign call hooks/<stage>.mjs of challenge 12 when it exists. Otherwise they are skipped
   * and say so: the real tools arrive with challenge 12.
   */
  async function runPipeline({ config, dir, repo, sha, version, buildArgs = {}, noCache = false, hooks = true }) {
    for (const s of config.stages) if (!STAGES.includes(s)) throw new Error(`pipeline.json: unknown stage "${s}". Stages are ${STAGES.join(', ')}.`);
    const local = `${regHost()}/${repo}`;
    const res = { stages: [], ok: true, pushed: [], digest: null, tags: [], failedAt: null };
    let built = null;
    for (const stage of config.stages) {
      if (!res.ok) {
        res.stages.push({ name: stage, status: 'not run', ms: 0, detail: `stopped at ${res.failedAt}` });
        continue;
      }
      const t0 = Date.now();
      const done = (status, detail = '') => {
        res.stages.push({ name: stage, status, ms: Date.now() - t0, detail });
        if (status === 'failed') {
          res.ok = false;
          res.failedAt = stage;
        }
      };
      if (stage === 'lint') {
        const r = run(['build', '--check', '--target', 'release', dir], { timeoutMs: 120_000 });
        done(r.code === 0 ? 'ok' : 'failed', r.code === 0 ? 'docker build --check: no warnings' : lastLines(r, 3));
      } else if (stage === 'build') {
        built = `${local}:build-${sha.slice(0, 7)}`;
        const r = build({ dir, tag: built, args: { APP_VERSION: version, GIT_SHA: sha, ...buildArgs }, noCache });
        done(r.code === 0 ? 'ok' : 'failed', r.code === 0 ? `built ${built.split('/').pop()}` : lastLines(r, 3));
      } else if (stage === 'test') {
        const r = run(['build', '--target', 'test', '--progress=plain', ...(noCache ? ['--no-cache'] : []), dir], { timeoutMs: 300_000 });
        const out = `${r.stdout}${r.stderr}`;
        const summary = (/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(out) || []).slice(1).map(Number);
        done(r.code === 0 ? 'ok' : 'failed', summary.length ? `tests ${summary[0]}, pass ${summary[1]}, fail ${summary[2]}` : r.code === 0 ? 'tests passed (result reused from the layer cache)' : lastLines(r, 3));
      } else if (['scan', 'sbom', 'sign'].includes(stage)) {
        const file = hookFile(stage);
        if (!hooks || !existsSync(file)) {
          done('skipped', 'filled in after challenge 12');
        } else {
          // sign works on what is already in the registry, so it gets the pushed digest; scan and sbom get the built image
          const ref = stage === 'sign' && res.digest ? `${local}@${res.digest}` : (built ?? `${local}:build-${sha.slice(0, 7)}`);
          const r = spawnSyncNode(file, [ref]);
          done(r.code === 0 ? 'ok' : 'failed', lastLines(r, 3));
        }
      } else if (stage === 'push') {
        if (!built) {
          done('failed', 'nothing was built, so there is nothing to push');
        } else {
          const names = tagNames(config.tags ?? ['sha'], { sha, version });
          let bad = '';
          for (const t of names) {
            const ref = `${local}:${t}`;
            run(['tag', built, ref]);
            const r = run(['push', ref], { timeoutMs: 300_000 });
            if (r.code !== 0) {
              bad = lastLines(r, 3);
              break;
            }
            res.pushed.push(ref);
          }
          res.tags = names;
          res.digest = bad ? null : await digestOf(repo, names[0]);
          done(bad ? 'failed' : 'ok', bad || `pushed ${names.join(', ')} -> ${short(res.digest)}`);
        }
      }
    }
    return res;
  }

  return {
    n, NET, REG, PROD, CTX, REPO_PREFIX, state,
    docker, prod, prodDocker, ensureNet, startRegistry, regHost, regBase, digestOf, tagsOf,
    startProd, loadIntoProd, teardown, removeImages, startEdge, build, runPipeline, tagNames, containerOf, STAGES,
  };
}

import { spawnSync } from 'node:child_process';
function spawnSyncNode(file, args) {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 300_000, windowsHide: true });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Copy a source folder to a scratch folder (to plant a bad commit without touching the original). */
export function copyTree(from, prefix = 'dkr-src-') {
  const to = mkdtempSync(join(tmpdir(), prefix));
  cpSync(from, to, { recursive: true });
  return to;
}
export function removeTree(dir) {
  rmSync(dir, { recursive: true, force: true });
}
export { mkdirSync, writeFileSync };

/** Plant a fault in a COPY of the app. kind: "health-500" (the unit tests catch it) or "never-ready" (the tests do not). */
export function plantFault(srcDir, kind) {
  const dir = copyTree(srcDir, 'dkr-bad-');
  const file = join(dir, 'server.mjs');
  let text = readFileSync(file, 'utf8');
  const before = text;
  if (kind === 'health-500') text = text.replace("case 'GET /health':\n      return send(res, 200, { status: 'ok' });", "case 'GET /health':\n      return send(res, 500, { status: 'broken' });");
  else if (kind === 'never-ready') text = text.replace('const isReady = () => !draining && Date.now() - startedAt >= WARMUP_MS;', 'const isReady = () => false;');
  else throw new Error(`unknown fault ${kind}`);
  if (text === before) throw new Error(`could not plant the fault "${kind}": server.mjs changed`);
  writeFileSync(file, text);
  return dir;
}
