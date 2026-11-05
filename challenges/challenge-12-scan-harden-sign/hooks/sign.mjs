// Pipeline hook: sign an image that is already in a local registry, and check the signature.
//   node hooks/sign.mjs <registry host:port>/<repo>@sha256:<digest>
// The reference must name a digest: a tag can move. The registry must be one that Docker publishes on this computer
// (as the registry of challenges 13 and 14 does), because the signing container joins its network.
// A THROWAWAY key pair is made for this run in a labelled volume and removed at the end. The password is random and
// never printed or saved. Signing, then verifying with the public key, must both succeed.
import { randomBytes } from 'node:crypto';
import { hook, tempVolume, dropVolume, run, cage, removeByName } from './common.mjs';
import { COSIGN } from '../lib.mjs';

const SIGN = ['--key', '/keys/cosign.key', '--use-signing-config=false', '--tlog-upload=false', '--allow-http-registry', '--yes'];
const VERIFY = ['--key', '/keys/cosign.pub', '--insecure-ignore-tlog=true', '--allow-http-registry'];

await hook('sign', async (ref) => {
  const m = /^([^/]+):(\d+)\/(.+)@(sha256:[0-9a-f]{64})$/.exec(ref);
  if (!m) return { status: 'failed', fields: { reason: 'needs_host:port/repo@sha256' } };
  const [, , port, repo, digest] = m;

  // Which container publishes that port, and on which network can the signing container reach it?
  const reg = run(['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}']).stdout.trim().split(/\r?\n/).filter(Boolean)[0];
  if (!reg) return { status: 'failed', fields: { reason: 'no_registry_on_that_port' } };
  const nets = Object.keys(JSON.parse(run(['inspect', reg, '--format', '{{json .NetworkSettings.Networks}}']).stdout || '{}')).filter((n) => n !== 'bridge');
  if (nets.length === 0) return { status: 'failed', fields: { reason: 'registry_not_on_a_user_network' } };
  const inner = `${reg}:5000/${repo}@${digest}`;

  if (run(['image', 'inspect', COSIGN]).code !== 0 && run(['pull', '--quiet', COSIGN], { timeoutMs: 300_000 }).code !== 0) return { status: 'failed', fields: { reason: 'cannot_pull_cosign' } };

  const keys = tempVolume('keys');
  const env = { COSIGN_PASSWORD: randomBytes(18).toString('hex') };
  const cosign = (args, { workdir } = {}) => {
    removeByName('hook-cosign');
    // 256 MB: the key encryption needs more than 64 MB (it is killed at 64).
    const r = run(['run', '--rm', ...cage('hook-cosign', { memory: '256m', pids: 100 }), '--user', '0', '--network', nets[0], '-v', `${keys}:/keys`, ...(workdir ? ['-w', workdir] : []), '-e', 'COSIGN_PASSWORD', COSIGN, ...args], { env, timeoutMs: 120_000 });
    removeByName('hook-cosign');
    return r.code;
  };
  try {
    if (cosign(['generate-key-pair'], { workdir: '/keys' }) !== 0) return { status: 'failed', fields: { reason: 'key_generation_failed' } };
    if (cosign(['sign', ...SIGN, inner]) !== 0) return { status: 'failed', fields: { reason: 'signing_failed' } };
    if (cosign(['verify', ...VERIFY, inner]) !== 0) return { status: 'failed', fields: { reason: 'verification_failed' } };
    return { status: 'ok', fields: { digest: digest.slice(0, 19), verified: 'true', key: 'throwaway' } };
  } finally {
    dropVolume(keys);
  }
});
