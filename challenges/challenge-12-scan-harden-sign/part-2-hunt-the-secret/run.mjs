// Challenge 12, part 2: hunt the secret.
// Run:  node challenges/challenge-12-scan-harden-sign/part-2-hunt-the-secret/run.mjs
// Options: --reference  use reference/app.    --trivy  also run the pinned scanner's secret scan (63 MB pull).
//          --record     starter AND reference, with the scanner; writes results.md and chart.svg.
//
// Four fake secrets (each contains "dkrcanary") are hidden four different ways in app/. The script builds
// the image and looks in every layer and in the image configuration for them.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { CHALLENGE, TRIVY, TRIVY_CACHE, pipeDocker, cage, trim, targetDir, wantReference, ALPINE_IMAGE } from '../lib.mjs';
import { VECTORS, CANARIES, build, hunt, check, history, userOf, removeImage } from './leaks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const trivy = record || process.argv.includes('--trivy');
const rec = new Recorder('Challenge 12, part 2: hunt the secret');
const f = (k, v) => setFact(`c12.p2.${k}`, v);

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const short = (text) => text.replace(/\s+/g, ' ').slice(0, 170);

/** Build one folder, look inside it, report. Returns the numbers. */
async function study(label, dir, tag) {
  const b = build(dir, tag);
  rec.step(`docker build --build-arg NPM_TOKEN=... --secret id=npm_token,src=secrets/npm_token ${label}`, b.ok ? `built ${tag} in ${round(b.seconds, 1)} s` : trim(b.output), b.ok ? 'The build gets the token two ways on purpose: as a build argument (the old, leaky way) and as a BuildKit secret (the safe way). Which one the Dockerfile uses is your choice.' : 'The build failed. Fix the Dockerfile first.');
  if (!b.ok) throw new Error(`the build of ${label} failed`);

  const hist = history(tag).split(/\r?\n/).filter((l) => /dkrcanary|NPM_TOKEN|API_KEY/.test(l)).map(short);
  rec.step(`docker history --no-trunc ${tag}`, hist.length ? hist.join('\n') : '(no line mentions a secret)', hist.length ? 'Anyone who can pull the image can run this. Build arguments and ENV lines are printed in full, token included.' : 'The history shows no secret. It would be enough to say "done" if the layers were clean too, so look at them next.');

  const ls = run(['run', '--rm', ...cage('ls'), '--entrypoint', 'ls', tag, '-A', '/app']);
  rec.step(`docker run --rm --entrypoint ls ${tag} -A /app`, ls.stdout.trim(), 'This is the image as a container sees it. A deleted file is not here. That does NOT mean it is gone from the image: see the next step.');

  const h = await hunt(tag);
  const rows = VECTORS.map((v) => `${h.found[v.key].length ? 'FOUND  ' : 'clean  '} ${v.key.padEnd(12)} ${h.found[v.key].join(', ') || '-'}`);
  rec.step(`look in all ${h.layers} layers and ${h.configs} JSON files of docker save ${tag}`, rows.join('\n'), `${VECTORS.filter((v) => h.found[v.key].length).length} of 4 secrets are in the image. A "layer" hit means the file content sits in a layer; a "config" hit means it is in the image configuration (environment, history, build arguments). Deleting a file in a later layer does not remove it from the earlier layer.`);

  let scanned = null;
  if (trivy) {
    const w = await pipeDocker(['save', tag], ['run', '-i', '--rm', ...cage('tarwriter'), '-v', 'dkr-c12-scan-in:/in', ALPINE_IMAGE, 'sh', '-c', 'cat > /in/img.tar']);
    if (w.code !== 0) throw new Error(`saving the image failed: ${w.stderr.slice(0, 200)}`);
    const t = run(['run', '--rm', ...cage('scan', { memory: '1g', pids: 200, tmpMb: 256 }), '-v', 'dkr-c12-scan-in:/in:ro', '-v', `${TRIVY_CACHE}:/root/.cache`, TRIVY, 'image', '--input', '/in/img.tar', '--scanners', 'secret', '--skip-db-update', '--format', 'json', '--quiet'], { timeoutMs: 300_000 });
    if (t.code !== 0) throw new Error(`the scanner failed: ${(t.stderr || t.stdout).slice(0, 300)}`);
    const j = JSON.parse(t.stdout);
    scanned = (j.Results ?? []).flatMap((r) => (r.Secrets ?? []).map((s) => `${s.RuleID} (${s.Severity}) in ${r.Target}`));
    rec.step('trivy image --input img.tar --scanners secret   (pinned scanner, no database needed)', scanned.length ? scanned.join('\n') : '(no findings)', scanned.length ? `The scanner found ${scanned.length} of the 4. It only knows secrets with a known shape (a PEM private key). A token with no pattern, a variable, a build argument: it sees none of them. A scanner is one tool, not the answer.` : 'The scanner found nothing.');
  }

  const c = check(tag, 'check');
  rec.step(`docker run --rm -e API_KEY=<key> ${tag} node server.mjs --check`, JSON.stringify(c), c.api_key_configured ? 'The app sees the key that was given at run time. This check does not say where else the key is stored: the hunt above does.' : 'The app does not see the key.');
  const out = { found: VECTORS.filter((v) => h.found[v.key].length).length, perKey: Object.fromEntries(VECTORS.map((v) => [v.key, h.found[v.key].length > 0])), scanned: scanned?.length ?? null, user: userOf(tag), check: c, layers: h.layers, buildS: round(b.seconds, 1) };
  removeImage(tag);
  return out;
}

try {
  cleanup(CHALLENGE);
  if (trivy) run(['volume', 'create', '--label', `dkr.challenge=${CHALLENGE}`, 'dkr-c12-scan-in']);
  const noteText = `canaries: ${Object.keys(CANARIES).join(', ')}`;
  console.log(noteText);

  let first;
  let second = null;
  if (record) {
    first = await study('(starter app/)', join(here, 'app'), 'dkr-c12-leaky:starter');
    second = await study('(reference/app/)', join(here, 'reference', 'app'), 'dkr-c12-leaky:fixed');
    f('starter_secrets_found_count', first.found);
    for (const v of VECTORS) f(`starter_found_${v.key}`, first.perKey[v.key]);
    if (first.scanned !== null) f('starter_scanner_findings_count', first.scanned);
    f('starter_layers_count', first.layers);
    f('fixed_secrets_found_count', second.found);
    f('fixed_api_key_at_run_time', second.check.api_key_configured === true);
    f('fixed_build_s', second.buildS);
    f('starter_build_s', first.buildS);
  } else {
    const dir = join(targetDir(here), 'app');
    first = await study(wantReference() ? '(reference/app/)' : '(app/)', dir, 'dkr-c12-leaky:yours');
    f('secrets_found_count', first.found);
    for (const v of VECTORS) f(`found_${v.key}`, first.perKey[v.key]);
    if (first.scanned !== null) f('scanner_findings_count', first.scanned);
  }

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Secrets still in the image (of 4)',
        bars: [
          { label: 'Starter: hunt in all layers', value: first.found },
          { label: 'Starter: pinned scanner finds', value: first.scanned ?? 0 },
          { label: 'Fixed: hunt in all layers', value: second.found },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nSecrets found in the image: ${first.found} of 4${second ? ` (starter), ${second.found} of 4 (fixed)` : ''}`);
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c12.p2');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
