// Challenge 6, part 4: the tags and labels a pipeline pushes, and the GHCR workflow.
// Run: node challenges/challenge-6-registry-and-tags/part-4-push-from-actions/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).
//
// The GitHub run is your own: this machine cannot run Actions and does not log in to GHCR.
// The local equivalent pushes the same tags and labels to a registry on this machine.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertDocker, cleanup, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { CHALLENGE, clip, pick, removeImages, saveFacts, short, startRegistry } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 6, part 4: tags, labels and the GHCR workflow');
const facts = {};
const REPO = 'dkr-c6/daftar-api';
const ACCEPT = 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
const lastLines = (r, n) => (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-n).join('\n');
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Static checks on the workflow file. */
function checkWorkflow(file) {
  const text = readFileSync(file, 'utf8');
  const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  const line = (re) => text.split(/\r?\n/).find((l) => re.test(l)) || '';
  return {
    actions: uses.length,
    unpinned: uses.filter((u) => !/@[0-9a-f]{40}$/.test(u)).length,
    writeAll: /^\s*permissions:\s*write-all/m.test(text),
    packagesWrite: /packages:\s*write/.test(text),
    pushGuarded: /push:\s*\$\{\{[^}]*pull_request/.test(line(/^\s*push:\s*\S/)),
    usesGithubToken: /secrets\.GITHUB_TOKEN/.test(text),
    printsDigest: /steps\.build\.outputs\.digest/.test(text),
    hasMetadata: uses.some((u) => u.startsWith('docker/metadata-action@')),
  };
}

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

try {
  cleanup(CHALLENGE);

  // Step 1: the tag rules, against a table of cases.
  const { tagsFor } = await import(pathToFileURL(pick(here, 'tags.mjs')).href);
  const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
  const rows = [];
  let passed = 0;
  for (const c of cases) {
    let got;
    try {
      got = tagsFor({ ...c.input, defaultBranch: 'main' });
    } catch (e) {
      got = [`threw: ${e.message}`];
    }
    const ok = Array.isArray(got) && sameSet(got, c.tags);
    if (ok) passed++;
    rows.push(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(26)} ${JSON.stringify(got)}${ok ? '' : `\n     expected ${JSON.stringify(c.tags)}`}`);
  }
  facts['c6.p4.tag_cases_total'] = cases.length;
  facts['c6.p4.tag_cases_passed'] = passed;
  rec.step('node -e "tagsFor(...)"  for five builds (a push, a branch, a pull request, a release, a pre-release)', rows.join('\n'), passed === cases.length ? 'Every build gets the tags it should and none it should not.' : 'FAIL lines show a wrong tag set. Fix tags.mjs.');

  // Step 2: the workflow.
  const wf = checkWorkflow(pick(here, 'workflow/release.yml'));
  Object.entries({ actions: wf.actions, unpinned: wf.unpinned, write_all: wf.writeAll, packages_write: wf.packagesWrite, push_guarded: wf.pushGuarded, uses_github_token: wf.usesGithubToken, prints_digest: wf.printsDigest, has_metadata: wf.hasMetadata }).forEach(([k, v]) => {
    facts[`c6.p4.workflow_${k}`] = v;
  });
  rec.step(
    'grep -E "uses:|permissions|packages:|push:|password:" workflow/release.yml',
    readFileSync(pick(here, 'workflow/release.yml'), 'utf8').split(/\r?\n/).filter((l) => /uses:|permissions|packages:|push:|password:/.test(l)).map((l) => l.trim().replace(/^- /, '')).join('\n'),
    wf.unpinned === 0 && !wf.writeAll && wf.pushGuarded && wf.usesGithubToken ? 'Pinned actions, narrow permissions, no push from a pull request, the built-in token. The GitHub run is your own.' : 'The workflow trusts too much. See the checklist in the README.',
  );

  // Step 3: the local equivalent. Build once, tag with the rules, push every tag to a local registry, check with the API.
  const reg = await startRegistry({ flags: ['-e', 'REGISTRY_STORAGE_DELETE_ENABLED=true'] });
  const release = { ref: 'refs/tags/v1.2.3', sha: 'abcdef0123456789abcdef0123456789abcdef01', version: '1.2.3' };
  const relTags = tagsFor({ ref: release.ref, sha: release.sha, defaultBranch: 'main' });
  const labels = { 'org.opencontainers.image.revision': release.sha, 'org.opencontainers.image.version': release.version, 'org.opencontainers.image.source': 'https://example.invalid/daftar-api' };
  const labelArgs = Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]);
  const buildFor = (tags, extra = '') => {
    const args = ['build', '--provenance=false', '--sbom=false', '--label', `dkr.challenge=${CHALLENGE}`, ...labelArgs, ...tags.flatMap((t) => ['-t', `${reg.host}/${REPO}:${t}`]), '-'];
    return run(args, { input: `FROM alpine:3.23\nRUN echo "${extra}" > /build\n`, timeoutMs: 300_000 });
  };
  const b = buildFor(relTags, 'release 1.2.3');
  if (b.code !== 0) throw new Error(`build failed:\n${lastLines(b, 6)}`);
  const push = run(['push', '--all-tags', `${reg.host}/${REPO}`], { timeoutMs: 300_000 });
  if (push.code !== 0) throw new Error(`push failed:\n${lastLines(push, 6)}`);
  const head = async (tag) => (await fetch(`${reg.base}/v2/${REPO}/manifests/${tag}`, { method: 'HEAD', headers: { accept: ACCEPT } })).headers.get('docker-content-digest');
  const listed = (await fetch(`${reg.base}/v2/${REPO}/tags/list`).then((r) => r.json())).tags ?? [];
  const digests = await Promise.all(listed.map(async (t) => [t, await head(t)]));
  const one = new Set(digests.map(([, d]) => d)).size === 1;
  facts['c6.p4.registry_tags_match'] = sameSet(listed, relTags);
  facts['c6.p4.one_digest'] = one && listed.length > 0;
  // Labels live in the image config blob.
  const mf = await fetch(`${reg.base}/v2/${REPO}/manifests/${listed[0] ?? 'x'}`, { headers: { accept: ACCEPT } }).then((r) => r.json());
  const cfg = mf.config ? await fetch(`${reg.base}/v2/${REPO}/blobs/${mf.config.digest}`).then((r) => r.json()) : {};
  const got = cfg.config?.Labels ?? {};
  facts['c6.p4.labels_ok'] = Object.entries(labels).every(([k, v]) => got[k] === v);
  rec.step(
    `docker push --all-tags ${reg.host}/${REPO}   then   GET /v2/${REPO}/tags/list   and HEAD each tag`,
    `tags pushed: ${JSON.stringify(relTags)}\ntags in the registry: ${JSON.stringify(listed)}\n${digests.map(([t, d]) => `${t.padEnd(14)} -> ${short(d)}`).join('\n')}\nlabels: revision ${String(got['org.opencontainers.image.revision']).slice(0, 7)}, version ${got['org.opencontainers.image.version']}`,
    one ? 'Every tag points to one digest. A release is one image with several names.' : 'The tags point to different digests. They are not the same release.',
  );

  // Step 4: a later push to main must not move `latest`.
  const releaseDigest = await head('latest');
  const mainTags = tagsFor({ ref: 'refs/heads/main', sha: '3f2a9c1d5e7b8a90123456789abcdef012345678', defaultBranch: 'main' });
  const b2 = buildFor(mainTags, 'main build');
  if (b2.code !== 0) throw new Error(`second build failed:\n${lastLines(b2, 6)}`);
  const push2 = run(['push', '--all-tags', `${reg.host}/${REPO}`], { timeoutMs: 300_000 });
  if (push2.code !== 0) throw new Error(`second push failed:\n${lastLines(push2, 6)}`);
  const latestAfter = await head('latest');
  facts['c6.p4.latest_stays_on_release'] = releaseDigest !== null && releaseDigest === latestAfter;
  rec.step(
    `push a commit to main   (tags: ${JSON.stringify(mainTags)})   then HEAD latest`,
    `latest before: ${short(releaseDigest)}\nlatest after:  ${short(latestAfter)}`,
    facts['c6.p4.latest_stays_on_release'] ? '`latest` still points at the last release. A push to main did not move it.' : '`latest` moved on a branch push. It now means "whatever was built last", not "the last release".',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Tags pushed for each kind of build',
        unit: 'tags',
        bars: cases.map((c) => ({ label: c.name, value: (tagsFor({ ...c.input, defaultBranch: 'main' }) || []).length })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\n${passed} of ${cases.length} tag cases pass. Workflow: ${wf.unpinned} unpinned action(s), write-all ${wf.writeAll}. Registry: one digest ${facts['c6.p4.one_digest']}, latest stays ${facts['c6.p4.latest_stays_on_release']}.`);
  for (const r of rows.filter((x) => x.startsWith('FAIL'))) console.log(r);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages();
}
