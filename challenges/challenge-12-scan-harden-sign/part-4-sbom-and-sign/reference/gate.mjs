// gate.mjs: the last check before an image is allowed to ship.
//
// You give it EVIDENCE about one image and it says pass or fail, with reasons.
//   evidence = {
//     ref:               "registry:5000/dkr-c12/app@sha256:..."   how the image is named
//     signatureVerified: true | false                              did `cosign verify` succeed for this digest?
//     sbom:              an SPDX document { spdxVersion, packages: [{ name, versionInfo }] } or null
//     provenance:        { buildType, resolvedDependencies: [{ uri, digest: { sha256 } }] } or null
//   }
//
// Your job is in the two functions marked TODO: summarizeSbom and evaluate.

/**
 * Describe an SBOM. Return { format, packageCount, names } where
 *   format        the spdxVersion text, or "none" when sbom is null
 *   packageCount  how many packages are listed (0 when there are none or no sbom)
 *   names         the package names, sorted
 */
export function summarizeSbom(sbom) {
  if (!sbom) return { format: 'none', packageCount: 0, names: [] };
  const packages = sbom.packages ?? [];
  return { format: sbom.spdxVersion ?? 'none', packageCount: packages.length, names: packages.map((p) => p.name).sort() };
}

const DIGEST_REF = /@sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Decide. Return { pass, reasons } where reasons is a list of texts, one per failed rule. A pass has [].
 * The four rules, in this order:
 *   1. ref must end in @sha256:<64 hex>.          reason: "image is named by tag, not by digest"
 *   2. signatureVerified must be true.             reason: "no valid signature for this image"
 *   3. the SBOM must have format starting "SPDX-"
 *      and at least one package.                   reason: "no usable SBOM"
 *   4. provenance must exist, list at least one dependency, and every dependency must have a sha256 digest.
 *                                                  reason: "provenance is missing or a base image is not pinned by digest"
 */
export function evaluate(evidence) {
  const reasons = [];
  if (!DIGEST_REF.test(String(evidence.ref ?? ''))) reasons.push('image is named by tag, not by digest');
  if (evidence.signatureVerified !== true) reasons.push('no valid signature for this image');
  const s = summarizeSbom(evidence.sbom);
  if (!s.format.startsWith('SPDX-') || s.packageCount < 1) reasons.push('no usable SBOM');
  const deps = evidence.provenance?.resolvedDependencies;
  if (!Array.isArray(deps) || deps.length === 0 || !deps.every((d) => SHA256.test(d.digest?.sha256 ?? ''))) reasons.push('provenance is missing or a base image is not pinned by digest');
  return { pass: reasons.length === 0, reasons };
}
