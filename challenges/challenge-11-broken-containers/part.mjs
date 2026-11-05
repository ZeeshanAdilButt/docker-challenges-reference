// The code every part of challenge 11 shares: run a set of services, report, grade, check the runbook.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { run, assertDocker, cleanup } from '../../toolkit/docker.js';
import { setFact } from '../../toolkit/facts.js';
import { Recorder } from '../../toolkit/record.js';
import { barsSvg } from '../../toolkit/bars.js';
import { SERVICES, CHALLENGE, up, down, settle, symptomLine, removeImage } from './harness.mjs';
import { ladder } from './ladder.mjs';

export const wantReference = () => process.argv.includes('--reference') || process.env.DKR_TARGET === 'reference';
/** The folder that holds services/ and runbook.md for this run: the part itself, or its reference/ folder. */
export const targetDir = (here) => (wantReference() ? join(here, 'reference') : here);

const show = (args) => `docker ${args.map((a) => (/[\s{}"$]/.test(a) ? (/[$"]/.test(a) ? `'${a}'` : `"${a}"`) : a)).join(' ')}`;
const trim = (text, lines = 25) => {
  const all = String(text).replace(/\r\n/g, '\n').trimEnd().split('\n');
  return all.length > lines ? [...all.slice(0, lines - 1), `... (${all.length - lines + 1} more lines)`].join('\n') : all.join('\n');
};
const mb = 1024 * 1024;

/**
 * Grade one service folder. Brings the service up, waits, checks it works and that the learner
 * did not remove the safety cage. Always takes the service down again. Returns { working, problems, result }.
 */
export async function gradeService(id, dir) {
  const problems = [];
  try {
    down(dir); // a fresh start: old volumes would hide a fix
    const u = up(dir);
    const result = await settle(id);
    const svc = SERVICES[id];
    if (!result.working) {
      problems.push(`${id} is not working: ${symptomLine(result)}. ${result.probes.filter((p) => !p.ok).map((p) => `${p.what}: ${p.detail}`).join('; ')}${u.code !== 0 ? ` (docker compose up said: ${(u.stderr || u.stdout).trim().split('\n').slice(-1)[0].slice(0, 200)})` : ''}`);
    }
    for (const name of svc.containers) {
      const one = (fmt) => run(['inspect', name, '--format', fmt]);
      if (one('{{.Id}}').code !== 0) continue;
      const memory = one('{{.HostConfig.Memory}}').stdout.trim();
      const privileged = one('{{.HostConfig.Privileged}}').stdout.trim();
      const readonly = one('{{.HostConfig.ReadonlyRootfs}}').stdout.trim();
      const user = one('{{.Config.User}}').stdout.trim();
      const health = one('{{json .Config.Healthcheck}}').stdout.trim();
      const label = one('{{index .Config.Labels "dkr.challenge"}}').stdout.trim();
      if (!(Number(memory) > 0 && Number(memory) <= 64 * mb)) problems.push(`${name}: the memory limit must stay between 1 byte and 64 MB (it is ${memory})`);
      if (privileged === 'true') problems.push(`${name}: --privileged is not allowed`);
      if (label !== '11') problems.push(`${name}: the label dkr.challenge=11 must stay`);
      if (id === '08-read-only-root' && readonly !== 'true') problems.push(`${name}: the root filesystem must stay read-only. Give the app a tmpfs to write to.`);
      if (id === '10-wrong-user' && ['', 'root', '0'].includes(user)) problems.push(`${name}: the service must keep running as a normal user, not root (user is "${user}")`);
      if (id === '06-bad-healthcheck' && (health === 'null' || health.includes('NONE') || !health.includes('/health'))) problems.push(`${name}: keep a real health check that calls /health, fix it instead of removing it`);
    }
    return { working: result.working && problems.length === 0, problems, result };
  } finally {
    down(dir);
    removeImage(SERVICES[id].slug);
  }
}

/** Read runbook.md and check that every id has a Symptom, Cause and Fix line. Returns a list of problems. */
export function checkRunbook(file, ids) {
  if (!existsSync(file)) return [`${file} does not exist`];
  const text = readFileSync(file, 'utf8');
  const problems = [];
  for (const id of ids) {
    const start = text.indexOf(`## ${id}`);
    if (start < 0) {
      problems.push(`runbook has no section "## ${id}"`);
      continue;
    }
    const next = text.indexOf('\n## ', start + 3);
    const section = text.slice(start, next < 0 ? undefined : next);
    for (const key of ['Symptom', 'Cause', 'Fix']) {
      const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(section);
      if (!m || m[1].trim().length < 15 || /TODO/i.test(m[1])) problems.push(`${id}: the "${key}:" line is missing, too short or still says TODO`);
    }
  }
  return problems;
}

/** The whole run.mjs of a part. */
export async function runPart({ here, part, ids, title }) {
  const reference = wantReference();
  const record = process.argv.includes('--record');
  const answerKey = record || process.argv.includes('--answer-key');
  const rec = new Recorder(`Challenge 11, part ${part}: ${title}`);
  const f = (k, v) => setFact(`c11.p${part}.${k}`, v);

  let engine;
  try {
    engine = assertDocker();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const dirOf = (id, ref) => join(ref ? join(here, 'reference') : here, 'services', id);
  const rows = [];
  try {
    cleanup(CHALLENGE);
    for (const id of ids) {
      const svc = SERVICES[id];
      console.log(`\n=== ${id}`);
      console.log(`Ticket: ${svc.ticket}`);
      // The service as given (or the reference when --reference). With --record it is always the starter.
      const dir = dirOf(id, reference && !record);
      down(dir);
      const u = up(dir);
      const r = await settle(id);
      const line = symptomLine(r);
      const probeText = r.probes.map((p) => `${p.ok ? 'ok  ' : 'FAIL'} ${p.what}: ${p.detail}`).join('\n');
      const upTail = trim(`${u.stdout}${u.stderr}`.split('\n').filter((l, i, a) => /Error|error|Started|Created|Running|Healthy|Container/.test(l) && a.indexOf(l) === i).slice(-6).join('\n').replace(/\(([0-9a-f]{20,})\)/g, '(<id>)'), 8);
      const label = record ? 'starter' : reference ? 'reference' : 'yours';
      rec.step(
        `cd services/${id} && docker compose up -d --build`,
        `${upTail}\n${line}\n${probeText}`,
        r.working ? `The ${label} version works.` : `Ticket: ${svc.ticket} Here is what the ${label} version does.`,
      );
      const row = { id, slug: svc.slug, working: r.working, line, containers: r.containers, causeRung: null };
      if (!r.working && answerKey) {
        const rungs = ladder(id);
        rungs.forEach((rung, i) => {
          const out = run(rung.cmd, { timeoutMs: 60_000 });
          rec.step(show(rung.cmd), trim(`${out.stdout}${out.stderr}`.replace(/\r\n/g, '\n').trimEnd() || '(no output)'), rung.note);
          if (rung.cause) row.causeRung = i + 1;
        });
      }
      down(dir);
      rows.push(row);

      if (record) {
        // Now the reference version of the same service.
        const rdir = dirOf(id, true);
        down(rdir);
        up(rdir);
        const rr = await settle(id);
        rec.step(
          `cd reference/services/${id} && docker compose up -d --build`,
          `${symptomLine(rr)}\n${rr.probes.map((p) => `${p.ok ? 'ok  ' : 'FAIL'} ${p.what}: ${p.detail}`).join('\n')}`,
          rr.working ? 'Fixed. The service is running and every check answers.' : 'The reference did not work. This must not happen.',
        );
        down(rdir);
        row.fixedWorking = rr.working;
        const c = r.containers.find((x) => x.name === (svc.focus ?? svc.containers[0])) ?? r.containers[0];
        f(`${svc.slug.replaceAll('-', '_')}_broken_state`, c.status);
        f(`${svc.slug.replaceAll('-', '_')}_broken_exit_code`, c.exit ?? -1);
        f(`${svc.slug.replaceAll('-', '_')}_broken_oomkilled`, c.oomKilled);
        f(`${svc.slug.replaceAll('-', '_')}_broken_health`, c.health);
        f(`${svc.slug.replaceAll('-', '_')}_cause_rung`, row.causeRung ?? 0);
        f(`${svc.slug.replaceAll('-', '_')}_fixed_working`, rr.working);
      } else {
        f(`${svc.slug.replaceAll('-', '_')}_working`, r.working);
      }
      removeImage(svc.slug);
      console.log(r.working ? `-> working` : `-> BROKEN: ${line}`);
    }

    const working = record ? rows.filter((r) => r.fixedWorking).length : rows.filter((r) => r.working).length;
    f(record ? 'fixed_count' : 'working_count', working);
    if (record) f('broken_count', rows.filter((r) => !r.working).length);
    console.log(`\n${working} of ${rows.length} services working.`);

    if (record) {
      rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
      writeFileSync(
        join(here, 'chart.svg'),
        barsSvg({
          title: 'Ladder rung that proves the cause',
          unit: '',
          bars: rows.map((r) => ({ label: r.id.replace(/^\d+-/, ''), value: r.causeRung ?? 0 })),
        }),
      );
      console.log('Wrote results.md and chart.svg');
    }
    console.log(`\nDone. See your numbers with: node toolkit/show-facts.mjs c11.p${part}`);
  } catch (e) {
    console.error(`\nStopped: ${e.message}`);
    process.exitCode = 1;
  } finally {
    for (const id of ids) {
      down(dirOf(id, false));
      down(dirOf(id, true));
      removeImage(SERVICES[id].slug);
    }
    cleanup(CHALLENGE);
  }
}
