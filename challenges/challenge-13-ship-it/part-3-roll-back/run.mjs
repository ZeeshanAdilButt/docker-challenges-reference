// Challenge 13, part 3: roll back by digest, and see what a schema change does to a rollback.
// Run: node challenges/challenge-13-ship-it/part-3-roll-back/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).
//
// Uses the single privileged Docker-in-Docker host (dkr-c13-prod) described in part 2. Created now, removed at the end.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertDocker, run } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { clip, kit, pick, clearFacts, saveFacts, secs, short } from '../kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ledger = join(here, '..', 'ledger');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 13, part 3: roll back');
const k = kit(13);
const facts = {};
const REPO = 'dkr-c13/ledger';
const composeFile = join(here, 'ledger.compose.yaml');
const plan = JSON.parse(readFileSync(pick(here, 'release-plan.json'), 'utf8'));
const { rollbackTarget } = await import(pathToFileURL(pick(here, 'rollback.mjs')).href);

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const get = async (url, init) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    let body = null;
    try { body = await r.json(); } catch { /* no body */ }
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: { error: e.message } };
  }
};

try {
  clearFacts('c13.p3.'); // a failed run must not leave the numbers of an older run behind
  k.teardown();
  k.removeImages();
  const reg = await k.startRegistry();
  const host = await k.startProd({ ports: [8080] });
  const edge = await k.startEdge({ hostPort: 8080 });
  const envFor = (digest) => ({ REGISTRY: reg.inner, DIGEST: digest });

  // Build and push the three releases: 1.0.0 (v1), 2.0.0 (v2-expand) and 2.0.1 (v2-rename).
  const releases = {};
  const local = `${reg.host}/${REPO}`;
  for (const [key, variant, version] of [['v1', 'v1', '1.0.0'], ['expand', 'v2-expand', '2.0.0'], ['rename', 'v2-rename', '2.0.1']]) {
    const b = k.build({ dir: ledger, tag: `${local}:${version}`, target: null, args: { VARIANT: variant, APP_VERSION: version } });
    if (b.code !== 0) throw new Error(`build of ${version} failed: ${b.stderr.trim().split('\n').slice(-3).join(' ')}`);
    const p = run(['push', `${local}:${version}`], { timeoutMs: 300_000 });
    if (p.code !== 0) throw new Error(`push of ${version} failed: ${p.stderr.trim().split('\n').slice(-2).join(' ')}`);
    releases[key] = { version, tag: version, digest: await k.digestOf(REPO, version) };
  }
  run(['tag', `${local}:1.0.0`, `${local}:original-1.0.0`]);

  const history = [];
  const deploy = async (rel, digest = rel.digest) => {
    const r = await edge.deploy({ file: composeFile, env: envFor(digest) });
    if (!r.ok) throw new Error(`deploy of ${rel.version} failed: ${r.error}`);
    history.push({ version: rel.version, tag: rel.tag, digest, deployedAt: new Date().toISOString() });
    return r;
  };
  const list = async () => get(`${edge.url}/customers`);
  const add = (name) => get(`${edge.url}/customers?name=${encodeURIComponent(name)}`, { method: 'POST' });
  const must = (r, what) => {
    if (r.status !== 201) throw new Error(`setup: adding ${what} answered ${r.status}`);
  };
  const runningDigest = (container) => {
    const id = k.prodDocker(['inspect', container, '--format', '{{.Image}}']);
    return JSON.parse(k.prodDocker(['image', 'inspect', id, '--format', '{{json .RepoDigests}}']) || '[]').map((d) => d.split('@')[1]);
  };

  /** One full story: deploy 1, deploy 2, someone moves a tag, roll back. */
  async function story({ second, pickTarget }) {
    edge.reset({ file: composeFile, env: envFor(releases.v1.digest) }); // both colours down first: a volume in use cannot be removed
    k.prodDocker(['volume', 'rm', '-f', 'ledger-data']);
    k.prodDocker(['volume', 'create', 'ledger-data']);
    history.length = 0;
    const v2 = releases[second];
    await deploy(releases.v1);
    for (const n of ['Amina', 'Bilal', 'Chen']) must(await add(n), n);
    await deploy(v2);
    must(await add('Dawood'), 'Dawood');
    const before = await list();
    // Someone re-pushes the tag 1.0.0 with another build (a "hot fix"), after release 1 was deployed.
    run(['tag', `${local}:${v2.version}`, `${local}:1.0.0`]);
    run(['push', `${local}:1.0.0`], { timeoutMs: 120_000 });
    const tagNow = await k.digestOf(REPO, '1.0.0');
    const target = pickTarget(history.map((h) => ({ ...h })));
    const digest = target.digest ?? (await k.digestOf(REPO, target.tag));
    const t0 = Date.now();
    const back = await edge.deploy({ file: composeFile, env: envFor(digest) });
    const rollbackMs = Date.now() - t0;
    if (!back.ok) throw new Error(`the rollback deploy failed: ${back.error}`);
    history.push({ version: 'rollback', tag: target.tag ?? '', digest, deployedAt: new Date().toISOString() });
    const root = await get(`${edge.url}/`);
    const after = await list();
    const wrote = await add('Esra');
    const digests = runningDigest(back.container);
    const out = {
      second, by: target.digest ? 'digest' : 'tag', rollbackMs,
      tagMoved: tagNow !== releases.v1.digest,
      digestMatches: digests.includes(releases.v1.digest),
      version: root.body?.version ?? '(no answer)',
      before: before.body?.customers?.length ?? 0,
      listStatus: after.status,
      count: after.body?.customers?.length ?? 0,
      listError: after.body?.error ?? '',
      writeStatus: wrote.status,
      writeError: wrote.body?.error ?? '',
      back,
    };
    out.dataOk = out.listStatus === 200 && out.count >= out.before && out.writeStatus === 201;
    // put the tag back for the next story
    run(['tag', `${local}:original-1.0.0`, `${local}:1.0.0`]);
    run(['push', `${local}:1.0.0`], { timeoutMs: 120_000 });
    return out;
  }
  const describe = (s) =>
    [
      `rolled back by ${s.by}; the tag 1.0.0 had been moved after release 1 was deployed: ${s.tagMoved}`,
      `rollback took ${secs(s.rollbackMs)} s`,
      `running now: version ${s.version}, ${s.digestMatches ? 'the digest of release 1' : 'NOT the digest of release 1'}`,
      `GET /customers: ${s.listStatus}${s.listError ? ` (${s.listError})` : ` with ${s.count} customers (there were ${s.before} before the rollback)`}`,
      `POST /customers: ${s.writeStatus}${s.writeError ? ` (${s.writeError})` : ''}`,
    ].join('\n');

  // Step 1: the control. Release 2 renames a column in one step. The rollback is by digest, so it is the right image.
  const control = await story({ second: 'rename', pickTarget: (h) => ({ digest: h[h.length - 2].digest }) });
  facts['c13.p3.control_digest_matches'] = control.digestMatches;
  facts['c13.p3.control_data_readable'] = control.listStatus === 200;
  rec.step(
    'release 2 renames the column name to full_name in one step (2.0.1), then:  roll back to release 1 by digest',
    describe(control),
    control.listStatus === 200
      ? 'The old code reads the new schema. (Unexpected for a rename.)'
      : 'The rollback put back the right code, and the right code cannot read the database any more: it asks for a column that no longer exists. The host is "healthy" and the data is out of reach. A rollback does not undo a schema change.',
  );

  // Step 2: your plan, and your rollbackTarget.
  const yours = await story({ second: plan.secondRelease === 'expand' ? 'expand' : 'rename', pickTarget: rollbackTarget });
  facts['c13.p3.plan_second_release'] = plan.secondRelease;
  facts['c13.p3.rollback_by'] = yours.by;
  facts['c13.p3.tag_moved'] = yours.tagMoved;
  facts['c13.p3.rollback_digest_matches'] = yours.digestMatches;
  facts['c13.p3.rollback_version'] = yours.version;
  facts['c13.p3.data_readable_after_rollback'] = yours.listStatus === 200;
  facts['c13.p3.data_count_after_rollback'] = yours.count;
  facts['c13.p3.data_count_before_rollback'] = yours.before;
  facts['c13.p3.write_after_rollback'] = yours.writeStatus === 201;
  rec.step(
    `release-plan.json: ${JSON.stringify(plan)}   and   rollbackTarget(history) from rollback.mjs`,
    describe(yours),
    yours.digestMatches && yours.dataOk
      ? 'Back on release 1, by digest, with every customer still readable and new ones accepted. The tag had been moved, and the rollback did not care. Release 2 only ADDED a column, so release 1 still understood the database.'
      : `Not safe: ${!yours.digestMatches ? 'the host does not run the image of release 1 (a moved tag took you somewhere else). ' : ''}${!yours.dataOk ? 'release 1 cannot use the database release 2 left behind.' : ''}`,
  );

  // Step 3: how long a rollback takes (median of 3), only when the first one was good.
  const times = [yours.rollbackMs];
  if (yours.digestMatches && yours.dataOk) {
    for (let i = 0; i < 2; i++) {
      const v2 = releases[plan.secondRelease === 'expand' ? 'expand' : 'rename'];
      await deploy(v2);
      const target = rollbackTarget(history.map((h) => ({ ...h })));
      const digest = target.digest ?? (await k.digestOf(REPO, target.tag));
      const t0 = Date.now();
      const r = await edge.deploy({ file: composeFile, env: envFor(digest) });
      times.push(Date.now() - t0);
      history.push({ version: 'rollback', tag: target.tag ?? '', digest, deployedAt: new Date().toISOString() });
      if (!r.ok) throw new Error(`rollback ${i + 2} failed: ${r.error}`);
    }
  }
  facts['c13.p3.rollback_s'] = round(median(times) / 1000, 1);
  facts['c13.p3.control_rollback_s'] = secs(control.rollbackMs);
  rec.step(
    'repeat: deploy release 2, roll back (3 rollbacks in all, time each)',
    `rollback times: ${times.map((t) => `${secs(t)} s`).join(', ')}\nmedian: ${facts['c13.p3.rollback_s']} s   (target: under 120 s)`,
    'A rollback is a deploy of an older digest that the host already has, so it takes about as long as a normal deploy. The registry is not needed: the image is already on the host.',
  );

  // Step 4: what is actually running? Someone started a container by hand on the host.
  const expected = history[history.length - 1].digest;
  k.prodDocker(['run', '-d', '--name', 'hotfix-by-hand', '--network', 'edge', '--memory', '64m', `${reg.inner}/${REPO}:2.0.1`]);
  const rows = k
    .prodDocker(['ps', '--format', '{{.Names}}|{{.Label "com.docker.compose.project"}}'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split('|'))
    .filter(([n]) => n !== 'edge-proxy')
    .map(([n, project]) => {
      const digests = runningDigest(n);
      return { name: n, project: project || '(none)', digest: digests[0] ?? '?', ok: Boolean(project) && digests.includes(expected) };
    });
  const drift = rows.filter((r) => !r.ok);
  facts['c13.p3.drift_found_count'] = drift.length;
  facts['c13.p3.drift_expected_count'] = 1;
  rec.step(
    'docker --context dkr-c13-prod run -d --name hotfix-by-hand ...   (a person on the host, in a hurry)\ndrift check: every container vs the digest the history says should run',
    `expected digest: ${short(expected)}\n${rows.map((r) => `${r.name.padEnd(22)} project ${r.project.padEnd(14)} ${short(r.digest)}  ${r.ok ? 'as expected' : 'DRIFT'}`).join('\n')}`,
    drift.length === 1 ? 'The container nobody deployed through the pipeline is found: it has no compose project and a different digest. "What is actually running" is a question you answer with the host, not with the repository.' : 'The check did not find the hand-made container.',
  );

  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, production host engine ${host.engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Seconds to roll back (median of 3), and what it brings back',
        unit: 's',
        bars: [
          { label: 'Rollback time (s)', value: facts['c13.p3.rollback_s'] },
          { label: 'Customers readable after (yours)', value: yours.listStatus === 200 ? yours.count : 0 },
          { label: 'Customers readable after (rename)', value: control.listStatus === 200 ? control.count : 0 },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nRollback by ${yours.by}: right image ${yours.digestMatches}, data readable ${yours.listStatus === 200}. Median rollback ${facts['c13.p3.rollback_s']} s.`);
  console.log('See your numbers with: node toolkit/show-facts.mjs c13.p3');
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  try {
    saveFacts(facts);
  } catch { /* nothing more to save */ }
  process.exitCode = 1;
} finally {
  k.teardown();
  k.removeImages();
}
