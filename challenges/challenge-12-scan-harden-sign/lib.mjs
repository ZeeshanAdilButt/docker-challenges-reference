// Shared helpers for challenge 12. Plain Node, no packages.
// Everything is named dkr-c12-... and labelled dkr.challenge=12.
// The scanner and the signing tool are pinned by DIGEST, not by tag. See NOTES.md for how the
// digests were chosen and why they must be checked again before you trust them.

import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { run, name, label, cleanup } from '../../toolkit/docker.js';

export const CHALLENGE = 12;
export const ALPINE_IMAGE = 'alpine:3.23';

// Trivy 0.76.1, published 2026-10-21, seven months after the March 2026 compromise (v0.69.4).
// The digest is the multi-platform index digest from `docker buildx imagetools inspect aquasec/trivy:0.76.1`.
export const TRIVY = 'aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c';
// Cosign v3.1.4, index digest from `docker buildx imagetools inspect ghcr.io/sigstore/cosign/cosign:v3.1.4`.
export const COSIGN = 'ghcr.io/sigstore/cosign/cosign:v3.1.4@sha256:0f06154836d2de34f887a5c273506d52ca43edaa1d9e53e6510fa78a48f69c2d';
export const REGISTRY = 'registry:3';

/** The Trivy database lives in a volume that is KEPT between runs, so it is downloaded once.
 *  Its label value is "12-cache" on purpose: `cleanup(12)` leaves it alone. Remove it by hand when you are done:
 *  docker volume rm dkr-c12-trivy-cache */
export const TRIVY_CACHE = name(CHALLENGE, 'trivy-cache');

export const wantReference = () => process.argv.includes('--reference') || process.env.DKR_TARGET === 'reference';
export const targetDir = (here) => (wantReference() ? join(here, 'reference') : here);

export const show = (args) => `docker ${args.map((a) => (/[\s{}"$]/.test(a) ? (/[$"]/.test(a) ? `'${a}'` : `"${a}"`) : a)).join(' ')}`;

export function docker(args, opts) {
  const r = run(args, opts);
  if (r.code !== 0) throw new Error(`${show(args)} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

export const removeByName = (what) => run(['rm', '-f', '-v', name(CHALLENGE, what)]);

export function trim(text, lines = 25) {
  const all = String(text).replace(/\r\n/g, '\n').trimEnd().split('\n');
  return all.length > lines ? [...all.slice(0, lines - 1), `... (${all.length - lines + 1} more lines)`].join('\n') : all.join('\n');
}

/** Run a docker command and pipe the output of a first command into it. For `docker save | docker run -i`. */
export function pipeDocker(firstArgs, secondArgs, { timeoutMs = 180_000 } = {}) {
  return new Promise((resolve) => {
    const a = spawn('docker', firstArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const b = spawn('docker', secondArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    let aErr = '';
    a.stdout.pipe(b.stdin);
    a.stderr.on('data', (d) => (aErr += d));
    b.stdout.on('data', (d) => (out += d));
    b.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      a.kill();
      b.kill();
    }, timeoutMs);
    b.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: out, stderr: err + aErr });
    });
  });
}

// ---------------------------------------------------------------------------
// Trivy
// ---------------------------------------------------------------------------

/** Make sure the cache volume exists. It carries the label dkr.challenge=12-cache (kept by cleanup). */
export function ensureCacheVolume() {
  if (run(['volume', 'inspect', TRIVY_CACHE]).code !== 0) docker(['volume', 'create', '--label', 'dkr.challenge=12-cache', '--label', 'dkr.cache=true', TRIVY_CACHE]);
}

/** True when the cache volume already holds the vulnerability database. */
export function haveDb() {
  if (run(['volume', 'inspect', TRIVY_CACHE]).code !== 0) return false;
  const r = run(['run', '--rm', ...cage('dbcheck', { memory: '64m' }), '-v', `${TRIVY_CACHE}:/c:ro`, ALPINE_IMAGE, 'sh', '-c', 'test -s /c/trivy/db/trivy.db && echo yes || echo no']);
  removeByName('dbcheck');
  return r.stdout.trim() === 'yes';
}

/** Cage for a container of this challenge. Trivy needs a bigger memory cap because it maps its database. */
export function cage(what, { memory = '64m', pids = 50, tmpMb = 16 } = {}) {
  return ['--name', name(CHALLENGE, what), ...label(CHALLENGE), '--memory', memory, '--memory-swap', memory, '--pids-limit', String(pids), '--tmpfs', `/tmp:rw,size=${tmpMb}m`, '--log-opt', 'max-size=1m', '--log-opt', 'max-file=2', '--security-opt', 'no-new-privileges'];
}

/** `docker run` args for the scanner. The only container of the course with a cap above 64 MB: 1 GB. */
export function trivyArgs(what, trivyArgsList, extra = []) {
  return ['run', '--rm', ...cage(what, { memory: '1g', pids: 200, tmpMb: 256 }), '-v', `${TRIVY_CACHE}:/root/.cache`, ...extra, TRIVY, ...trivyArgsList];
}

/** Scan an image from a registry (no Docker socket needed). Uses the cached database only. */
export function trivyScanRemote(image, { scanners = 'vuln', format = 'json', extra = [] } = {}) {
  removeByName('scan');
  const r = run(trivyArgs('scan', ['image', '--scanners', scanners, '--skip-db-update', '--skip-java-db-update', '--format', format, '--quiet', ...extra, image]), { timeoutMs: 300_000 });
  removeByName('scan');
  return r;
}

/** Keep only what triage needs from a Trivy JSON report, so fixtures are small and readable. */
export function trimReport(report) {
  return {
    Metadata: { OS: report.Metadata?.OS ?? null },
    Results: (report.Results ?? []).map((x) => ({
      Target: x.Target,
      Class: x.Class,
      Type: x.Type,
      Vulnerabilities: (x.Vulnerabilities ?? []).map((v) => ({
        VulnerabilityID: v.VulnerabilityID,
        PkgName: v.PkgName,
        InstalledVersion: v.InstalledVersion,
        FixedVersion: v.FixedVersion ?? '',
        Status: v.Status ?? '',
        Severity: v.Severity,
        Title: v.Title ?? '',
      })),
    })),
  };
}

export { cleanup, run, name, label };
