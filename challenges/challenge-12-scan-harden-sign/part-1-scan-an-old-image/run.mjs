// Challenge 12, part 1: scan an old image and read the result.
// Run:  node challenges/challenge-12-scan-harden-sign/part-1-scan-an-old-image/run.mjs
//
// Default (offline): reads the three saved Trivy reports in fixtures/ and runs YOUR triage.mjs on them.
//                    No Docker, no download.
// --live             also pulls the pinned scanner, downloads the vulnerability database ONCE into the
//                    kept volume dkr-c12-trivy-cache (139 MB download, about 1.7 GB on disk), and scans
//                    the three images for real. Later runs reuse the database (--skip-db-update).
// --update-fixtures  with --live: rewrite fixtures/*.json from the new scans.
// --reference        use reference/triage.mjs.     --record  write results.md and chart.svg.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { run, assertDocker, cleanup } from '../../../toolkit/docker.js';
import { setFact, getFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round, timed } from '../../../toolkit/stats.js';
import { CHALLENGE, TRIVY, TRIVY_CACHE, ALPINE_IMAGE, docker, trim, targetDir, trivyArgs, trivyScanRemote, trimReport, ensureCacheVolume, haveDb, cage, removeByName } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes('--live');
const record = process.argv.includes('--record');
const updateFixtures = process.argv.includes('--update-fixtures') || record;
const rec = new Recorder('Challenge 12, part 1: scan an old image');
const f = (k, v) => setFact(`c12.p1.${k}`, v);

const IMAGES = [
  { key: 'old', image: 'nginx:1.18-alpine', what: 'an old image (2021)' },
  { key: 'year_old', file: 'year-old', image: 'nginx:1.27-alpine', what: 'a year-old image' },
  { key: 'current', image: 'alpine:3.23', what: 'a current base image' },
];

let engine = 'not used';
if (live) {
  try {
    engine = assertDocker();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

const triage = await import(pathToFileURL(join(targetDir(here), 'triage.mjs')));
const policy = JSON.parse(readFileSync(join(here, 'policy.json'), 'utf8'));

try {
  if (live) {
    cleanup(CHALLENGE);

    // Step 1: the pinned scanner. The pull is by digest, so a rewritten tag cannot change what you run.
    const pull = run(['pull', TRIVY], { timeoutMs: 300_000 });
    if (pull.code !== 0) throw new Error(`docker pull failed: ${pull.stderr.trim()}`);
    const disk = Number(docker(['image', 'inspect', TRIVY, '--format', '{{.Size}}']).trim());
    const index = JSON.parse(docker(['buildx', 'imagetools', 'inspect', '--raw', TRIVY.split('@')[0] + '@' + TRIVY.split('@')[1]]));
    const amd = index.manifests.find((m) => m.platform?.architecture === 'amd64' && m.platform?.os === 'linux');
    const manifest = JSON.parse(docker(['buildx', 'imagetools', 'inspect', '--raw', `aquasec/trivy@${amd.digest}`]));
    const packedMb = round(manifest.layers.reduce((s, l) => s + l.size, 0) / 1e6, 1);
    rec.step(`docker pull ${TRIVY}`, trim(pull.stdout.trim().split(/\r?\n/).slice(-3).join('\n')), `The scanner is named by its digest. It is ${packedMb} MB to download and ${round(disk / 1e6, 1)} MB on disk. Why a digest: in March 2026 a Trivy release and its GitHub Action tags were poisoned. A tag can be moved; a digest cannot.`);
    f('scanner_image_packed_mb', packedMb);
    f('scanner_image_disk_mb', round(disk / 1e6, 1));
    f('scanner_digest', TRIVY.split('@')[1]);

    // Step 2: the database. The big cost of this part. Downloaded once, then kept.
    ensureCacheVolume();
    let dbSeconds = 0;
    let dbNote;
    const dbManifest = JSON.parse(docker(['buildx', 'imagetools', 'inspect', '--raw', 'mirror.gcr.io/aquasec/trivy-db:2']));
    const dbMb = round(dbManifest.layers.reduce((s, l) => s + l.size, 0) / 1e6, 1);
    f('db_download_mb', dbMb);
    if (!haveDb()) {
      console.log(`\nDownloading the vulnerability database: ${dbMb} MB. This happens once. It is kept in the volume ${TRIVY_CACHE}.`);
      // The download needs about 300 MB of temporary space. It goes to the kept volume, not to memory.
      docker(['run', '--rm', ...cage('dbtmp'), '-v', `${TRIVY_CACHE}:/c`, ALPINE_IMAGE, 'mkdir', '-p', '/c/tmp']);
      removeByName('dbtmp');
      const t = await timed(() => run(trivyArgs('dbdownload', ['image', '--download-db-only', '--quiet', '--no-progress'], ['-e', 'TMPDIR=/root/.cache/tmp']), { timeoutMs: 900_000 }));
      removeByName('dbdownload');
      if (t.value.code !== 0) throw new Error(`database download failed: ${(t.value.stderr || t.value.stdout).trim().slice(0, 300)}`);
      dbSeconds = round(t.ms / 1000, 1);
      dbNote = `First run: the download took ${dbSeconds} s on this connection.`;
    } else {
      const first = getFact('c12.p1.db_download_s');
      dbNote = `The database was already in the kept volume, so nothing was downloaded now.${first ? ` The first download on the reference machine took ${first} s.` : ''}`;
    }
    const du = docker(['run', '--rm', ...cage('dbsize'), '-v', `${TRIVY_CACHE}:/c:ro`, ALPINE_IMAGE, 'sh', '-c', 'stat -c %s /c/trivy/db/trivy.db; cat /c/trivy/db/metadata.json']).trim().split(/\r?\n/);
    removeByName('dbsize');
    const dbDiskMb = round(Number(du[0]) / 1e6, 0);
    const meta = JSON.parse(du.slice(1).join(''));
    rec.step(`trivy image --download-db-only   (volume ${TRIVY_CACHE})`, `trivy.db on disk: ${du[0]} bytes (${dbDiskMb} MB)\nmetadata.json: ${JSON.stringify(meta)}`, `${dbNote} Download ${dbMb} MB, ${dbDiskMb} MB on disk. The cost is large next to the 63 MB scanner. Every scan result depends on the date of this database.`);
    f('db_disk_mb', dbDiskMb);
    f('db_updated_at', meta.UpdatedAt.slice(0, 10));
    if (dbSeconds) f('db_download_s', dbSeconds);

    // Step 3: scan the three images with the cached database, three timed runs each.
    for (const img of IMAGES) {
      const times = [];
      let r;
      for (let i = 0; i < 3; i++) {
        const t = await timed(() => trivyScanRemote(img.image));
        if (t.value.code !== 0) throw new Error(`scan of ${img.image} failed: ${(t.value.stderr || t.value.stdout).slice(0, 300)}`);
        times.push(t.ms / 1000);
        r = t.value;
      }
      const report = JSON.parse(r.stdout);
      const trimmed = { Image: img.image, ScannerImage: TRIVY, DbUpdatedAt: meta.UpdatedAt, ...trimReport(report) };
      if (updateFixtures) writeFileSync(join(here, 'fixtures', `${img.file ?? img.key}.json`), `${JSON.stringify(trimmed, null, 1)}\n`);
      f(`${img.key}_scan_s`, round(median(times), 1));
    }
    // One real table, for the chapter: the old image, critical only.
    const tab = trivyScanRemote('nginx:1.18-alpine', { format: 'table', extra: ['--severity', 'CRITICAL'] });
    const tabLines = tab.stdout.split(/\r?\n/).filter((l) => /CVE-|Total|Library|alpine/.test(l)).map((l) => l.replace(/\s+/g, ' ').slice(0, 150));
    rec.step('trivy image --scanners vuln --skip-db-update --severity CRITICAL nginx:1.18-alpine   (inside the pinned scanner container, cache volume mounted)', trim(tabLines.join('\n')), 'The scanner read the image from the registry itself. No Docker socket is needed. The first lines name the operating system and the number of findings. With the cached database a scan takes a few seconds; the database download is the real cost.');
  }

  // Offline part: your triage.mjs on the saved reports. This always runs.
  const rows = [];
  for (const img of IMAGES) {
    const report = JSON.parse(readFileSync(join(here, 'fixtures', `${img.file ?? img.key}.json`), 'utf8'));
    const s = triage.summarize(report);
    const v = triage.verdict(report, policy);
    rows.push({ img, s, v });
    const top = triage.topFixes(report, policy, 3).map((x) => `${x.pkg} ${x.installed} -> ${x.fixedIn} (${x.count})`).join('\n  ');
    rec.step(
      `node triage.mjs fixtures/${img.file ?? img.key}.json policy.json   (${img.image})`,
      `${s.os}: ${s.total} findings (${triage.SEVERITIES.map((k) => `${s.bySeverity[k]} ${k.toLowerCase()}`).join(', ')}), ${s.fixable} fixable\nfix now ${v.counts['fix-now']}, plan ${v.counts.plan}, accept ${v.counts.accept}\n${v.reasons.map((r) => `FAIL: ${r}`).join('\n')}${v.reasons.length ? '\n' : ''}${v.pass ? 'PASS' : 'FAIL'}${top ? `\nworst packages:\n  ${top}` : ''}`,
      img.key === 'old' ? 'The old image has FEWER findings than the year-old one, although it is far older. Likely reason: security advisories for its base (Alpine 3.11, end of life since 2021) stopped long ago, so the database knows little about it. A low count here means the scanner is blind, not that the image is safe. A count is not a risk.' : img.key === 'year_old' ? 'More findings. Its base (Alpine 3.21) had fixes until very recently, so the database knows a lot, and every finding has a fixed version. Updating the packages is the cure.' : 'A current base image has no findings in this database. It will not stay that way: a new advisory can appear tomorrow.',
    );
    f(`${img.key}_total`, s.total);
    f(`${img.key}_critical`, s.bySeverity.CRITICAL);
    f(`${img.key}_high`, s.bySeverity.HIGH);
    f(`${img.key}_fixable`, s.fixable);
    f(`${img.key}_fix_now`, v.counts['fix-now']);
    f(`${img.key}_pass`, v.pass);
    f(`${img.key}_end_of_life`, s.endOfLife);
  }

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Findings per image: a count is not a risk',
        bars: rows.map((r) => ({ label: r.img.image, value: r.s.total })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\n${rows.map((r) => `${r.img.image}: ${r.s.total} findings, ${r.v.pass ? 'PASS' : 'FAIL'}`).join('\n')}`);
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c12.p1');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (live) cleanup(CHALLENGE);
}
