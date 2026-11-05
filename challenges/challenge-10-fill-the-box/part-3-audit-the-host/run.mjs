// Challenge 10, part 3: audit the host.
// Run:  node challenges/challenge-10-fill-the-box/part-3-audit-the-host/run.mjs
// Add --record to write results.md and chart.svg. Add --reference to use reference/audit.mjs.
// Add --capture to rewrite fixtures/inspect.json from the four containers.
//
// It creates four containers (docker create: they are never started, so nothing runs without a cap),
// reads their `docker inspect` JSON, and runs your audit.mjs on it.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { run, assertDocker, cleanup, name } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { CHALLENGE, AUDIT_CONTAINERS, AUDIT_EXPECT, createAuditContainers, shortName, show, docker, targetDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const capture = process.argv.includes('--capture');
const rec = new Recorder('Challenge 10, part 3: audit the host');
const f = (k, v) => setFact(`c10.p3.${k}`, v);

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const auditPath = join(targetDir(here), 'audit.mjs');
const audit = await import(pathToFileURL(auditPath));
const cli = (args, input) => spawnSync(process.execPath, [auditPath, ...args], { encoding: 'utf8', input });

try {
  cleanup(CHALLENGE);
  console.log(`Using ${auditPath}`);

  // Step 1: four containers. They are created, not started.
  const list = createAuditContainers();
  const names = Object.keys(AUDIT_CONTAINERS);
  rec.step(
    'docker create ... (four times, flags differ)',
    names.map((n) => `${name(CHALLENGE, `aud-${n}`)}: ${AUDIT_CONTAINERS[n].join(' ') || '(no flags at all)'}`).join('\n'),
    'Four containers with different settings: one careful, three with a problem each. They are only created, so nothing runs without a cap.',
  );
  if (capture) writeFileSync(join(here, 'fixtures', 'inspect.json'), `${JSON.stringify(list, null, 2)}\n`);

  // Step 2: the fields the audit reads.
  const fmt = '{{.Name}} memory={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}} log={{.HostConfig.LogConfig.Type}}{{.HostConfig.LogConfig.Config}} restart={{.HostConfig.RestartPolicy.Name}} user={{.Config.User}}';
  const fields = names.map((n) => docker(['inspect', '--format', fmt, name(CHALLENGE, `aud-${n}`)]).trim()).join('\n');
  rec.step(`docker inspect --format '${fmt}' <container>`, fields, 'Everything the audit needs is already in docker inspect. Zero means no limit. An empty user means root.');

  // Step 3: parse sizes the way `docker ps -s` prints them.
  const psLine = docker(['ps', '-a', '-s', '--no-trunc', '--filter', `name=${name(CHALLENGE, 'aud-good')}`, '--format', '{{.Size}}']).trim();
  const bytes = audit.parseSize(psLine);
  rec.step(`docker ps -a -s --filter name=${name(CHALLENGE, 'aud-good')} --format '{{.Size}}'`, `${psLine}\nparseSize gives ${bytes} bytes`, 'Docker prints sizes in decimal units (1 kB is 1000 bytes). Your parseSize has to read the first number only.');
  f('ps_size_text', psLine);
  f('ps_size_parsed_bytes', Number.isFinite(bytes) ? bytes : -1);

  // Step 4: audit the four containers as a file, the way a chapter reader would.
  const jsonText = JSON.stringify(list);
  const r = cli(['-'], jsonText);
  rec.step('docker inspect <the four> | node audit.mjs -', `${r.stdout.trim()}${r.stderr.trim() ? `\n${r.stderr.trim()}` : ''}\nexit code ${r.status}`, 'One line per finding. Exit code 1 means at least one critical or high finding.');
  f('audit_exit_code', r.status);

  // Step 5: compare with what a correct audit says.
  let met = 0;
  const lines = [];
  const results = audit.auditAll(list);
  for (const res of results) {
    const key = res.container.replace(name(CHALLENGE, 'aud-'), '');
    const ids = res.findings.map((x) => x.id);
    const exp = AUDIT_EXPECT[key];
    const missing = (exp.has ?? []).filter((id) => !ids.includes(id));
    const extra = [...(exp.lacks ?? []).filter((id) => ids.includes(id)), ...(exp.exact ? ids : [])];
    const ok = missing.length === 0 && extra.length === 0;
    if (ok) met += 1;
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${key}: ${ids.length} findings${missing.length ? `, missing ${missing.join(', ')}` : ''}${extra.length ? `, should not have ${extra.join(', ')}` : ''}`);
  }
  rec.step('compare the findings with the expected ones', lines.join('\n'), met === names.length ? 'Your audit matches on all four containers.' : 'Not yet. Finish auditContainer in audit.mjs.');
  f('containers_audited_count', results.length);
  f('containers_correct_count', met);
  const counts = audit.summarize(results);
  for (const s of audit.SEVERITIES) f(`findings_${s}_count`, counts[s]);

  // Step 6: the same audit, live, only for our label. Read only.
  const live = cli(['--live', '--label', `dkr.challenge=${CHALLENGE}`]);
  rec.step('node audit.mjs --live --label dkr.challenge=10', live.stdout.trim(), 'Live mode asks Docker for the containers itself. It only reads. Without --label it audits every container on your Docker.');
  f('live_exit_code', live.status);

  // Step 7: the whole host, counted only. No names are printed or saved.
  const ids = run(['ps', '-a', '-q']).stdout.split(/\r?\n/).filter(Boolean);
  const all = ids.length ? JSON.parse(run(['inspect', ...ids], { timeoutMs: 120_000 }).stdout) : [];
  const own = new Set(list.map((c) => c.Id));
  const others = all.filter((c) => !own.has(c.Id));
  const res2 = audit.auditAll(others);
  const countId = (id) => res2.filter((x) => x.findings.some((y) => y.id === id)).length;
  rec.step(
    'node audit.mjs --live   (only the counts are shown here)',
    `${others.length} other containers on this Docker\n${countId('no-memory-limit')} have no memory limit\n${countId('log-not-rotated')} keep an unrotated json-file log\n${countId('restart-always')} use restart always`,
    'This is the real use of the tool: run it on a host and read the counts. Names are not printed here because they are not yours.',
  );

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Findings by severity on the four containers',
        bars: audit.SEVERITIES.map((s) => ({ label: s, value: counts[s] })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c10.p3');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
