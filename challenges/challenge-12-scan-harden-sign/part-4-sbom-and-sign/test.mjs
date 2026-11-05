// Challenge 12, part 4 test.
// Run: node --test challenges/challenge-12-scan-harden-sign/part-4-sbom-and-sign/test.mjs
// It needs no Docker: it checks your gate.mjs on a real SBOM and provenance saved by the reference run,
// and it checks workflow/release.yml for steps that are not pinned to a commit.
// With DKR_TARGET=reference it tests reference/gate.mjs and reference/workflow/release.yml instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { targetDir } from '../lib.mjs';
import { findUnpinned, scannerPinnedByDigest, poisonedActions } from '../pins.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = targetDir(here);
const gate = await import(pathToFileURL(join(dir, 'gate.mjs')));
const sbom = JSON.parse(readFileSync(join(here, 'fixtures', 'sbom.json'), 'utf8'));
const provenance = JSON.parse(readFileSync(join(here, 'fixtures', 'provenance.json'), 'utf8'));
const DIGEST = `sha256:${'a'.repeat(64)}`;
const good = { ref: `registry:5000/dkr-c12/app@${DIGEST}`, signatureVerified: true, sbom, provenance };

test('summarizeSbom describes a real SBOM', () => {
  const s = gate.summarizeSbom(sbom);
  assert.equal(s.format, 'SPDX-2.3');
  assert.equal(s.packageCount, sbom.packages.length);
  assert.ok(s.packageCount > 5);
  assert.ok(s.names.includes('alpine-baselayout'));
  assert.deepEqual(s.names, [...s.names].sort());
});

test('summarizeSbom copes with no SBOM and an empty one', () => {
  assert.deepEqual(gate.summarizeSbom(null), { format: 'none', packageCount: 0, names: [] });
  assert.equal(gate.summarizeSbom({ spdxVersion: 'SPDX-2.3' }).packageCount, 0);
});

test('evaluate passes a signed digest with an SBOM and provenance', () => {
  const r = gate.evaluate(good);
  assert.deepEqual(r, { pass: true, reasons: [] });
});

test('evaluate fails an image named by tag', () => {
  const r = gate.evaluate({ ...good, ref: 'registry:5000/dkr-c12/app:1' });
  assert.equal(r.pass, false);
  assert.deepEqual(r.reasons, ['image is named by tag, not by digest']);
});

test('evaluate fails an image without a valid signature', () => {
  const r = gate.evaluate({ ...good, signatureVerified: false });
  assert.deepEqual(r.reasons, ['no valid signature for this image']);
  assert.equal(gate.evaluate({ ...good, signatureVerified: undefined }).pass, false);
});

test('evaluate fails a missing or empty SBOM', () => {
  assert.deepEqual(gate.evaluate({ ...good, sbom: null }).reasons, ['no usable SBOM']);
  assert.deepEqual(gate.evaluate({ ...good, sbom: { spdxVersion: 'SPDX-2.3', packages: [] } }).reasons, ['no usable SBOM']);
  assert.deepEqual(gate.evaluate({ ...good, sbom: { spdxVersion: 'CycloneDX', packages: [{ name: 'x' }] } }).reasons, ['no usable SBOM']);
});

test('evaluate fails missing provenance or a dependency without a digest', () => {
  const msg = 'provenance is missing or a base image is not pinned by digest';
  assert.deepEqual(gate.evaluate({ ...good, provenance: null }).reasons, [msg]);
  assert.deepEqual(gate.evaluate({ ...good, provenance: { resolvedDependencies: [] } }).reasons, [msg]);
  const bad = { resolvedDependencies: [...provenance.resolvedDependencies, { uri: 'pkg:docker/x', digest: {} }] };
  assert.deepEqual(gate.evaluate({ ...good, provenance: bad }).reasons, [msg]);
});

test('evaluate lists every failed rule, in order', () => {
  const r = gate.evaluate({ ref: 'x:1', signatureVerified: false, sbom: null, provenance: null });
  assert.equal(r.pass, false);
  assert.deepEqual(r.reasons, ['image is named by tag, not by digest', 'no valid signature for this image', 'no usable SBOM', 'provenance is missing or a base image is not pinned by digest']);
});

const workflow = readFileSync(join(dir, 'workflow', 'release.yml'), 'utf8');

test('workflow: every step is pinned to a full commit hash', () => {
  const bad = findUnpinned(workflow);
  assert.deepEqual(bad, [], `These steps use a tag or a branch: ${bad.map((b) => `line ${b.line} ${b.uses}`).join('; ')}. Pin each to a 40 character commit: gh api repos/<owner>/<repo>/commits/<tag> -q .sha`);
});

test('workflow: the poisoned scanner action is not used', () => {
  assert.deepEqual(poisonedActions(workflow), [], 'Remove aquasecurity/trivy-action and setup-trivy. Run the scanner image by digest instead.');
});

test('workflow: the scanner runs from its image, pinned by digest', () => {
  assert.ok(scannerPinnedByDigest(workflow), 'Run the scanner as: docker run aquasec/trivy:<version>@sha256:<64 hex> ...');
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});
