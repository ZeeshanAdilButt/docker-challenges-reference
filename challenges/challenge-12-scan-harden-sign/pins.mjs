// Check a GitHub Actions workflow for steps that are not pinned to a full commit.
// A tag such as "@v4" can be moved to other code at any time. A full 40-character commit hash cannot.
// That is the lesson of March 2026: 75 of 76 tags of a popular scanner action were rewritten.

/** Returns [{ line, uses }] for every `uses:` that is not pinned to a 40 character commit. Local (./) and digest-pinned docker:// uses are fine. */
export function findUnpinned(text) {
  const out = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(raw);
    if (!m) return;
    const uses = m[1];
    if (uses.startsWith('./')) return;
    if (uses.startsWith('docker://') && /@sha256:[0-9a-f]{64}$/.test(uses)) return;
    if (/@[0-9a-f]{40}$/.test(uses)) return;
    out.push({ line: i + 1, uses });
  });
  return out;
}

/** True when a line runs the scanner by digest: aquasec/trivy:<tag>@sha256:<64 hex>. */
const noComments = (text) => text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
export const scannerPinnedByDigest = (text) => /aquasec\/trivy(:[\w.-]+)?@sha256:[0-9a-f]{64}/.test(noComments(text));

/** Names of uses: that point at the poisoned scanner actions. */
export const poisonedActions = (text) => [...text.matchAll(/^\s*-?\s*uses:\s*(aquasecurity\/(?:trivy-action|setup-trivy))/g)].map((m) => m[1]);
