// Pipeline hook: scan an image on this machine's Docker with the scanner pinned by digest.
//   node hooks/scan.mjs <image reference>
// Fails (exit 1) when the image has a secret of HIGH or CRITICAL severity, or a CRITICAL vulnerability that has a fix
// (more than DKR_SCAN_MAX_CRITICAL of them, default 0). HIGH findings are counted and reported, not blocking.
//
// The vulnerability database lives in the kept volume dkr-c12-trivy-cache (see part 1). If it is not there yet, the
// first run downloads it (139 MB, about 1.7 GB on disk). Later runs reuse it: a scan takes a few seconds.
// DKR_SCAN_OFFLINE=1 skips the vulnerability part (no database, no download). The secret scan still runs and the result is
// "partial", not "ok", so you can see that half of the work was not done.
import { hook, tempVolume, dropVolume, ensureScanner, saveImage, trivyOnTar, downloadDb, haveDb, TRIVY } from './common.mjs';

await hook('scan', async (ref) => {
  const offline = process.env.DKR_SCAN_OFFLINE === '1';
  const maxCritical = Number(process.env.DKR_SCAN_MAX_CRITICAL ?? 0);
  ensureScanner();
  const vol = tempVolume('scan');
  try {
    await saveImage(ref, vol);

    const sec = trivyOnTar(vol, ['--scanners', 'secret', '--format', 'json']);
    if (sec.code !== 0) throw new Error('secret scan failed');
    const secrets = (JSON.parse(sec.stdout).Results ?? []).flatMap((r) => r.Secrets ?? []).filter((s) => ['HIGH', 'CRITICAL'].includes(s.Severity)).length;

    let fields = { scanner: TRIVY.split('@')[0].replace('aquasec/', '').replace(':', '-'), secrets };
    let status = 'ok';
    if (offline) {
      status = 'partial';
      fields = { ...fields, vuln: 'not-run' };
    } else {
      if (!haveDb()) downloadDb();
      const v = trivyOnTar(vol, ['--scanners', 'vuln', '--skip-db-update', '--format', 'json']);
      if (v.code !== 0) throw new Error('vulnerability scan failed');
      const report = JSON.parse(v.stdout);
      const vulns = (report.Results ?? []).flatMap((r) => r.Vulnerabilities ?? []);
      const fixable = (sev) => vulns.filter((x) => x.Severity === sev && x.FixedVersion).length;
      fields = { ...fields, critical_fixable: fixable('CRITICAL'), high_fixable: fixable('HIGH'), total: vulns.length, os: (report.Metadata?.OS ? `${report.Metadata.OS.Family}-${report.Metadata.OS.Name}` : 'none') };
      if (fields.critical_fixable > maxCritical) status = 'failed';
    }
    if (secrets > 0) status = 'failed';
    return { status, fields };
  } finally {
    dropVolume(vol);
  }
});
