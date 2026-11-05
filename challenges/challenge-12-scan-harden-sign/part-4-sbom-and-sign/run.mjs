// Challenge 12, part 4: SBOM, provenance, a signature, and a gate.
// Run:  node challenges/challenge-12-scan-harden-sign/part-4-sbom-and-sign/run.mjs
// Options: --reference  use reference/gate.mjs and reference/workflow.   --record  write results.md, chart.svg and fixtures/.
//
// What happens, all on your machine:
//   1. a local registry (registry:3) starts on 127.0.0.1:15012, inside a labelled network;
//   2. an image is built with an SBOM and provenance attached and pushed to it;
//   3. a THROWAWAY key pair is made inside this run (in a labelled volume that cleanup removes; it is never saved to a file in the repository);
//   4. the image digest is signed and verified; the tag is then moved to other code and verification is tried again;
//   5. your gate.mjs decides pass or fail on the evidence.
// The signing tool and the registry get 256 MB and 64 MB. Nothing leaves your computer.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, assertDocker, cleanup, label } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { CHALLENGE, COSIGN, REGISTRY, ALPINE_IMAGE, docker, cage, trim, targetDir, removeByName } from '../lib.mjs';
import { findUnpinned, scannerPinnedByDigest, poisonedActions } from '../pins.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 12, part 4: SBOM, signature and gate');
const f = (k, v) => setFact(`c12.p4.${k}`, v);

const SYFT = 'docker/buildkit-syft-scanner@sha256:873a7458c3c8ac8e32c7b796c10e1600b07b963d2aa000a72a2d97aaaa2d6315';
const PORT = 15012;
const HOST_REPO = `127.0.0.1:${PORT}/dkr-c12/app`;
const NET_REPO = 'registry:5000/dkr-c12/app';
const NET = 'dkr-c12-net';
const KEYS = 'dkr-c12-keys';
const password = randomBytes(18).toString('hex'); // a throwaway: lives only in this process

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const gate = await import(pathToFileURL(join(targetDir(here), 'gate.mjs')));

/** Size of the amd64 layers of an image in a registry, in MB. */
function packedMb(ref) {
  const raw = JSON.parse(docker(['buildx', 'imagetools', 'inspect', '--raw', ref]));
  const m = raw.manifests ? JSON.parse(docker(['buildx', 'imagetools', 'inspect', '--raw', `${ref.split('@')[0].split(':')[0]}@${raw.manifests.find((x) => x.platform?.architecture === 'amd64' && x.platform?.os === 'linux').digest}`])) : raw;
  return round(m.layers.reduce((s, l) => s + l.size, 0) / 1e6, 1);
}

/** Run cosign in its pinned image. 256 MB because the key encryption needs memory (64 MB was killed). */
function cosign(args, { workdir } = {}) {
  removeByName('cosign');
  const r = run(['run', '--rm', ...cage('cosign', { memory: '256m', pids: 100 }), '--user', '0', '--network', NET, '-v', `${KEYS}:/keys`, ...(workdir ? ['-w', workdir] : []), '-e', 'COSIGN_PASSWORD', COSIGN, ...args], { env: { COSIGN_PASSWORD: password }, timeoutMs: 120_000 });
  removeByName('cosign');
  return { code: r.code, out: `${r.stdout}${r.stderr}`.replace(/\r\n/g, '\n').split('\n').filter((l) => !/deprecated|^$/.test(l)).join('\n') };
}

const SIGN_FLAGS = ['--key', '/keys/cosign.key', '--use-signing-config=false', '--tlog-upload=false', '--allow-http-registry', '--yes'];
const VERIFY_FLAGS = ['--key', '/keys/cosign.pub', '--insecure-ignore-tlog=true', '--allow-http-registry'];

function push(dir, tag) {
  const r = run(['buildx', 'build', '--push', '--attest', `type=sbom,generator=${SYFT}`, '--attest', 'type=provenance,mode=max', '-t', `${HOST_REPO}:${tag}`, '--label', 'dkr.challenge=12', dir], { timeoutMs: 300_000 });
  if (r.code !== 0) throw new Error(`build and push failed: ${(r.stderr || r.stdout).slice(-400)}`);
  const idx = docker(['buildx', 'imagetools', 'inspect', `${HOST_REPO}:${tag}`]);
  return { digest: /Digest:\s+(sha256:[0-9a-f]{64})/.exec(idx)[1], text: idx };
}

try {
  cleanup(CHALLENGE);

  // Step 1: the workflow, checked without any tool except a regular expression.
  const wfStarter = readFileSync(join(here, 'workflow', 'release.yml'), 'utf8');
  const wfRef = readFileSync(join(here, 'reference', 'workflow', 'release.yml'), 'utf8');
  const wfMine = readFileSync(join(targetDir(here), 'workflow', 'release.yml'), 'utf8');
  const show = (t) => `${findUnpinned(t).length} steps not pinned to a commit${poisonedActions(t).length ? `, uses ${poisonedActions(t).join(', ')}` : ''}${scannerPinnedByDigest(t) ? ', scanner pinned by digest' : ''}`;
  rec.step('check workflow/release.yml for steps not pinned to a full commit hash', `starter:   ${show(wfStarter)}\nreference: ${show(wfRef)}${record ? '' : `\nyours:     ${show(wfMine)}`}`, 'A tag can be moved. In March 2026, 75 of 76 tags of a scanner action were moved to code that stole secrets. A 40 character commit hash cannot be moved. The GitHub run of this workflow is your own: this check only reads the file.');
  f('workflow_unpinned_starter_count', findUnpinned(wfStarter).length);
  f('workflow_unpinned_reference_count', findUnpinned(wfRef).length);
  if (!record) f('workflow_unpinned_count', findUnpinned(wfMine).length);

  // Step 2: the tools, by digest.
  for (const img of [COSIGN, REGISTRY]) {
    const p = run(['pull', '--quiet', img], { timeoutMs: 300_000 });
    if (p.code !== 0) throw new Error(`pull of ${img} failed: ${p.stderr.trim()}`);
  }
  const cosignMb = packedMb(COSIGN);
  const registryMb = packedMb(REGISTRY);
  const syftMb = packedMb(SYFT);
  rec.step(`docker pull ${COSIGN}`, `cosign:   ${cosignMb} MB packed, named by digest\nregistry: ${registryMb} MB packed (registry:3)\nSBOM generator: ${syftMb} MB packed, ${SYFT.slice(0, 55)}...`, 'Three small tools. The SBOM generator is itself an image that BuildKit pulls by tag if you do not name it. Here it is named by digest too.');
  f('cosign_image_packed_mb', cosignMb);
  f('registry_image_packed_mb', registryMb);
  f('sbom_generator_packed_mb', syftMb);
  f('cosign_digest', COSIGN.split('@')[1]);

  // Step 3: registry in a labelled network.
  docker(['network', 'create', ...label(CHALLENGE), NET]);
  docker(['volume', 'create', ...label(CHALLENGE), KEYS]);
  docker(['run', '-d', ...cage('registry'), '--network', NET, '--network-alias', 'registry', '-p', `127.0.0.1:${PORT}:5000`, REGISTRY]);
  rec.step(`docker run -d --network ${NET} --network-alias registry -p 127.0.0.1:${PORT}:5000 ${REGISTRY}`, `registry listening on 127.0.0.1:${PORT}`, 'A registry of your own. It only listens on your computer.');

  // Step 4: build with SBOM and provenance, push.
  const t0 = process.hrtime.bigint();
  const v1 = push(join(here, 'app'), '1');
  const buildS = round(Number(process.hrtime.bigint() - t0) / 1e9, 1);
  const lines = v1.text.split(/\r?\n/).filter((l) => /^(Name|MediaType|Digest):|Platform:|vnd.docker.reference.type/.test(l.trim()) || /Name:\s+127/.test(l));
  rec.step(`docker buildx build --push --attest type=sbom,generator=<digest> --attest type=provenance,mode=max -t ${HOST_REPO}:1 app`, trim(lines.map((l) => l.replace(/sha256:([0-9a-f]{12})[0-9a-f]+/g, 'sha256:$1...')).join('\n')), `One push, two manifests in the index: the image, and an attestation manifest that holds the SBOM and the provenance. Build and push took ${buildS} s.`);
  const manifestCount = (v1.text.match(/MediaType:\s+application\/vnd.oci.image.manifest/g) ?? []).length;
  f('index_manifest_count', manifestCount);
  f('build_push_s', buildS);

  // Step 5: read the SBOM and the provenance back.
  const sbomRaw = JSON.parse(docker(['buildx', 'imagetools', 'inspect', `${HOST_REPO}@${v1.digest}`, '--format', '{{ json .SBOM }}'])).SPDX;
  const provRaw = JSON.parse(docker(['buildx', 'imagetools', 'inspect', `${HOST_REPO}@${v1.digest}`, '--format', '{{ json .Provenance }}'])).SLSA;
  const sbom = { spdxVersion: sbomRaw.spdxVersion, name: 'dkr-c12/app', packages: sbomRaw.packages.map((p) => ({ name: p.name, versionInfo: p.versionInfo ?? '' })) };
  const prov = { buildType: provRaw.buildDefinition.buildType, resolvedDependencies: provRaw.buildDefinition.resolvedDependencies.map((d) => ({ uri: d.uri, digest: d.digest })) };
  const sum = gate.summarizeSbom(sbom);
  rec.step('docker buildx imagetools inspect <ref> --format "{{ json .SBOM }}"   (then summarizeSbom)', `format: ${sum.format}\npackages: ${sum.packageCount}\nfirst ones: ${sum.names.slice(0, 6).join(', ')}`, 'An SBOM is a list of what is inside. It does not say whether any of it is vulnerable: you feed it to a scanner for that. Its value is that you can answer "do we ship package X?" in seconds.');
  rec.step('docker buildx imagetools inspect <ref> --format "{{ json .Provenance }}"', prov.resolvedDependencies.map((d) => `${decodeURIComponent(d.uri)}\n  sha256:${d.digest.sha256.slice(0, 16)}...`).join('\n'), 'Provenance says how the image was built and from what: the base image (by digest, as BuildKit saw it) and the SBOM generator.');
  f('sbom_format', sum.format);
  f('sbom_package_count', sum.packageCount);
  f('provenance_dependency_count', prov.resolvedDependencies.length);
  f('provenance_all_digests', prov.resolvedDependencies.every((d) => /^[0-9a-f]{64}$/.test(d.digest?.sha256 ?? '')));
  if (record) {
    writeFileSync(join(here, 'fixtures', 'sbom.json'), `${JSON.stringify(sbom, null, 1)}\n`);
    writeFileSync(join(here, 'fixtures', 'provenance.json'), `${JSON.stringify(prov, null, 1)}\n`);
  }

  // Step 6: a throwaway key pair, made inside the run.
  const kg = cosign(['generate-key-pair'], { workdir: '/keys' });
  rec.step('cosign generate-key-pair   (in a labelled volume, password made fresh for this run)', kg.out, 'The key lives in a Docker volume that cleanup removes. It is never written into this repository, and the password is random and not printed. Never commit a real signing key.');
  f('keypair_made', kg.code === 0);
  const pub = docker(['run', '--rm', ...cage('keyread'), '-v', `${KEYS}:/keys:ro`, ALPINE_IMAGE, 'cat', '/keys/cosign.pub']).trim().split(/\r?\n/);
  removeByName('keyread');

  // Step 7: sign the digest and verify it.
  const sg = cosign(['sign', ...SIGN_FLAGS, `${NET_REPO}@${v1.digest}`]);
  rec.step(`cosign sign --key /keys/cosign.key ... ${NET_REPO}@sha256:${v1.digest.slice(7, 19)}...`, sg.out, 'The signature is a small extra object in the registry, next to the image. It signs the digest, not the tag.');
  f('sign_ok', sg.code === 0);
  const vf = cosign(['verify', ...VERIFY_FLAGS, `${NET_REPO}@${v1.digest}`]);
  const vfLines = vf.out.split('\n').filter((l) => !l.startsWith('[{') && !l.startsWith('WARNING')).slice(0, 8);
  rec.step(`cosign verify --key /keys/cosign.pub ... ${NET_REPO}@sha256:${v1.digest.slice(7, 19)}...`, vfLines.join('\n'), 'Verification checks the signature against the public key you trust. It needs no network access to any outside service here, because we skip the public transparency log on purpose (a local key is not in it).');
  f('verify_digest_ok', vf.code === 0);

  // Step 8: attach the SBOM as a signed attestation, and verify it.
  const sbomFull = JSON.stringify(sbomRaw);
  const w = run(['run', '-i', '--rm', ...cage('keywrite'), '-v', `${KEYS}:/keys`, ALPINE_IMAGE, 'sh', '-c', 'cat > /keys/sbom.json'], { input: sbomFull });
  removeByName('keywrite');
  if (w.code !== 0) throw new Error('could not write the SBOM into the keys volume');
  const at = cosign(['attest', ...SIGN_FLAGS, '--type', 'spdxjson', '--predicate', '/keys/sbom.json', `${NET_REPO}@${v1.digest}`]);
  const va = cosign(['verify-attestation', ...VERIFY_FLAGS, '--type', 'spdxjson', `${NET_REPO}@${v1.digest}`]);
  rec.step('cosign attest --type spdxjson --predicate sbom.json ...  then  cosign verify-attestation --type spdxjson ...', `attest exit ${at.code}\nverify-attestation exit ${va.code}\n${va.out.split('\n').filter((l) => !l.startsWith('{') && !l.startsWith('WARNING')).slice(0, 5).join('\n')}`, 'Now the SBOM itself is signed. Someone who changes the SBOM after the build cannot make it verify.');
  f('attest_ok', at.code === 0 && va.code === 0);

  // Step 9: change one link and see where verification fails.
  const v2 = push(join(here, 'app-changed'), '1');
  const byTag = cosign(['verify', ...VERIFY_FLAGS, `${NET_REPO}:1`]);
  rec.step(`push OTHER code under the same tag ${HOST_REPO}:1  then  cosign verify ... ${NET_REPO}:1`, `tag 1 now points at sha256:${v2.digest.slice(7, 19)}... (was sha256:${v1.digest.slice(7, 19)}...)\n${byTag.out.split('\n').filter((l) => /Error|no signatures|no matching/.test(l)).slice(0, 2).join('\n') || trim(byTag.out, 4)}\nverify exit ${byTag.code}`, 'The tag moved to other code. The new image has no signature, so verification fails. This is why you deploy by digest, and why you verify what you pull.');
  f('verify_after_tag_moved_ok', byTag.code === 0);
  const again = cosign(['verify', ...VERIFY_FLAGS, `${NET_REPO}@${v1.digest}`]);
  rec.step(`cosign verify ... ${NET_REPO}@sha256:${v1.digest.slice(7, 19)}...   (the ORIGINAL digest)`, `verify exit ${again.code}`, 'The original digest still verifies: its bytes did not change. The registry holds both images; only the tag moved.');
  f('verify_original_digest_after_move_ok', again.code === 0);
  const other = cosign(['generate-key-pair'], { workdir: '/keys/other' });
  const wrong = cosign(['verify', '--key', '/keys/other/cosign.pub', '--insecure-ignore-tlog=true', '--allow-http-registry', `${NET_REPO}@${v1.digest}`]);
  rec.step('cosign verify --key <a DIFFERENT public key> ...@<the signed digest>', `${wrong.out.split('\n').filter((l) => /Error|no matching/.test(l)).slice(0, 2).join('\n') || trim(wrong.out, 3)}\nverify exit ${wrong.code}`, `The signature is valid, but not for this key. Verification answers "was this signed by the key I trust", not just "is there a signature". (second key made: ${other.code === 0})`);
  f('verify_wrong_key_ok', wrong.code === 0);

  // Step 10: the gate.
  const good = { ref: `${NET_REPO}@${v1.digest}`, signatureVerified: vf.code === 0, sbom, provenance: prov };
  const g1 = gate.evaluate(good);
  const g2 = gate.evaluate({ ...good, ref: `${NET_REPO}:1`, signatureVerified: byTag.code === 0 });
  const g3 = gate.evaluate({ ref: `${NET_REPO}:1`, signatureVerified: false, sbom: null, provenance: null });
  rec.step(
    'gate.evaluate(evidence)   three images',
    `signed digest:        ${g1.pass ? 'PASS' : 'FAIL'}${g1.reasons.map((r) => `\n  - ${r}`).join('')}\nmoved tag:            ${g2.pass ? 'PASS' : 'FAIL'}${g2.reasons.map((r) => `\n  - ${r}`).join('')}\nnothing attached:     ${g3.pass ? 'PASS' : 'FAIL'}${g3.reasons.map((r) => `\n  - ${r}`).join('')}`,
    g1.pass && !g2.pass && !g3.pass ? 'Your gate lets the signed, attested digest through and stops the other two, with a reason each.' : 'Not yet. Finish summarizeSbom and evaluate in gate.mjs.',
  );
  f('gate_signed_digest_pass', g1.pass);
  f('gate_moved_tag_pass', g2.pass);
  f('gate_moved_tag_reason_count', g2.reasons.length);
  f('gate_nothing_attached_reason_count', g3.reasons.length);
  void pub;

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Image downloads for this part (MB packed)',
        unit: 'MB',
        bars: [
          { label: 'cosign', value: cosignMb },
          { label: 'SBOM generator', value: syftMb },
          { label: 'registry:3', value: registryMb },
        ],
      }),
    );
    console.log('\nWrote results.md, chart.svg and fixtures/');
  }
  console.log(`\nSigned digest: ${g1.pass ? 'PASS' : 'FAIL'}. Moved tag: ${g2.pass ? 'PASS' : 'FAIL'}. Nothing attached: ${g3.pass ? 'PASS' : 'FAIL'}.`);
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c12.p4');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
