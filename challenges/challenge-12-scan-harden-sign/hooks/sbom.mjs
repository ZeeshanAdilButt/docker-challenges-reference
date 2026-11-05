// Pipeline hook: make an SBOM (SPDX) of an image on this machine's Docker with the scanner pinned by digest.
//   node hooks/sbom.mjs <image reference>
// Fails (exit 1) when no SPDX document with at least one package comes out. No vulnerability database is needed.
// The SBOM is printed nowhere: set DKR_SBOM_OUT=<file> to keep a copy of the document.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hook, tempVolume, dropVolume, ensureScanner, saveImage, trivyOnTar } from './common.mjs';

await hook('sbom', async (ref) => {
  ensureScanner();
  const vol = tempVolume('sbom');
  try {
    await saveImage(ref, vol);
    const r = trivyOnTar(vol, ['--format', 'spdx-json', '--skip-db-update']);
    if (r.code !== 0) throw new Error('the scanner could not make an SBOM');
    const doc = JSON.parse(r.stdout);
    const packages = (doc.packages ?? []).filter((p) => p.name && !String(p.name).endsWith('.tar'));
    if (!String(doc.spdxVersion ?? '').startsWith('SPDX-') || packages.length < 1) return { status: 'failed', fields: { reason: 'no_usable_sbom' } };
    if (process.env.DKR_SBOM_OUT) writeFileSync(process.env.DKR_SBOM_OUT, r.stdout);
    return { status: 'ok', fields: { format: doc.spdxVersion, packages: packages.length, sha256: createHash('sha256').update(r.stdout).digest('hex').slice(0, 12) } };
  } finally {
    dropVolume(vol);
  }
});
