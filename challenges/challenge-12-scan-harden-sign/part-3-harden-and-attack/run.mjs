// Challenge 12, part 3: harden a container and attack it.
// Run:  node challenges/challenge-12-scan-harden-sign/part-3-harden-and-attack/run.mjs
// Options: --matrix     also remove ONE control at a time from your settings and attack again
//          --reference  use reference/harden.json.    --record  starter, reference and matrix; writes results.md, chart.svg.
//
// Six attack scripts run with docker exec, against the container this script starts (dkr-c12-target)
// and nothing else. The container has 64 MB of memory and at most 200 processes.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { CHALLENGE, targetDir } from '../lib.mjs';
import { ATTACKS, CONTROLS, buildTarget, flagsFor, loadHarden, trial } from './attacks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const matrix = record || process.argv.includes('--matrix');
const rec = new Recorder('Challenge 12, part 3: harden and attack');
const f = (k, v) => setFact(`c12.p3.${k}`, v);

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const table = (results) => results.map((r) => `${r.worked ? 'SUCCEEDED' : 'blocked  '}  ${r.id.padEnd(13)} ${r.title}`).join('\n');

/** The docker run flags without the name, label, log and port flags, so the command is short to read. */
const flagText = (h) => {
  const all = flagsFor(h);
  const keep = [];
  for (let i = 0; i < all.length; i++) {
    if (['--name', '--label', '--memory-swap', '--log-opt', '-p'].includes(all[i])) {
      i += 1;
      continue;
    }
    keep.push(all[i]);
  }
  return `docker run -d ${keep.join(' ')} dkr-c12-target:1`;
};

async function study(label, h, keyPrefix) {
  const t = await trial(h);
  if (!t.ok) {
    rec.step(flagText(h), 'the service did not answer GET /health', `${label}: the container did not serve /health. Hardening must not break the service.`);
    f(`${keyPrefix}service_ok`, false);
    return { ok: false, results: [], worked: [], who: '' };
  }
  const worked = t.results.filter((r) => r.worked);
  rec.step(flagText(h), `${t.who}\n${table(t.results)}`, `${label}: ${worked.length} of ${ATTACKS.length} attacks succeeded.`);
  f(`${keyPrefix}attacks_succeeded_count`, worked.length);
  f(`${keyPrefix}service_ok`, true);
  return { ...t, worked };
}

const without = (h, c) => {
  const x = { ...h };
  if (c === 'user') x.user = 'root';
  if (c === 'cap_drop') x.cap_drop = [];
  if (c === 'read_only') x.read_only = false;
  if (c === 'no_new_privileges') x.no_new_privileges = false;
  if (c === 'pids_limit') x.pids_limit = 0;
  return x;
};

try {
  cleanup(CHALLENGE);
  const s = round(buildTarget(), 1);
  console.log(`Built dkr-c12-target:1 in ${s} s`);

  if (record) {
    const start = loadHarden(here);
    const a = await study('Starter settings (the container as it ships)', start, 'starter_');
    const only = await study('ONLY a non-root user added to the starter', { ...start, user: '10001:10001' }, 'only_user_');
    f('only_user_attack_ids', only.worked.map((x) => x.id).join(',') || 'none');
    const two = await study('Non-root user plus no_new_privileges', { ...start, user: '10001:10001', no_new_privileges: true }, 'user_nnp_');
    f('user_nnp_attack_ids', two.worked.map((x) => x.id).join(',') || 'none');
    f('starter_capeff', /CapEff:\s*(\w+)/.exec(a.who)?.[1] ?? 'unknown');
    const ref = loadHarden(join(here, 'reference'));
    const b = await study('Reference settings', ref, 'hardened_');
    f('hardened_capeff', /CapEff:\s*(\w+)/.exec(b.who)?.[1] ?? 'unknown');
    f('hardened_nonewprivs', /NoNewPrivs=(\d)/.exec(b.who)?.[1] === '1');
    const rows = [];
    for (const c of CONTROLS) {
      const r = await study(`Reference settings WITHOUT ${c}`, without(ref, c), `without_${c}_`);
      const ids = r.worked.map((x) => x.id);
      f(`without_${c}_attack_ids`, ids.join(',') || 'none');
      rows.push({ c, ids });
    }
    rec.step('summary: which attack gets through when ONE control is removed', rows.map((r) => `without ${r.c.padEnd(18)} ${r.ids.join(', ') || 'nothing gets through'}`).join('\n'), 'Each control stops a different attack, and some overlap on purpose: when one is missing or wrong, another still holds. That is defence in depth.');
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Attacks that succeeded (of 6)',
        bars: [{ label: 'Starter settings', value: a.worked.length }, ...rows.map((r) => ({ label: `Hardened, no ${r.c}`, value: r.ids.length })), { label: 'Fully hardened', value: b.worked.length }],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  } else {
    const h = loadHarden(targetDir(here));
    const a = await study('Your settings', h, '');
    for (const r of a.results) console.log(`${r.worked ? 'SUCCEEDED' : 'blocked  '} ${r.id}: ${r.title}${r.worked ? `   (stopped by: ${r.stoppedBy})` : ''}`);
    if (matrix) for (const c of CONTROLS) await study(`Your settings WITHOUT ${c}`, without(h, c), `without_${c}_`);
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c12.p3');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
