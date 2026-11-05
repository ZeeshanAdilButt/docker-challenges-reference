// Challenge 4, part 2: run as non-root with a read-only root.
// Run: node challenges/challenge-4-slim-lock-drop-root/part-2-non-root-read-only/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the fixed files in reference/ (for maintainers).

import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, label, leftovers, run, safeArgs, waitFor } from '../../../toolkit/docker.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { CHALLENGE, build, clip, pick, removeImages, saveFacts } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 4, part 2: non-root with a read-only root');

const IMAGE = 'dkr-c4-p2-app:test';
const VOLUME = 'dkr-c4-p2-data';
const FORBIDDEN = [/^--privileged/, /^--cap-add/, /^--pid/, /^--network=?host/, /^--net=?host/, /docker\.sock/, /^--userns/, /^--security-opt=?seccomp=unconfined/];
const facts = {};

/** Flags from run-flags.txt: comments dropped, split on spaces. */
function readFlags(file) {
  const tokens = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .flatMap((l) => l.split(/\s+/));
  const bad = tokens.find((t) => FORBIDDEN.some((re) => re.test(t)));
  if (bad) throw new Error(`run-flags.txt uses "${bad}". This challenge does not allow it (see SAFETY.md).`);
  return tokens;
}

const lastJson = (text) => JSON.parse(text.trim().split(/\r?\n/).pop());
const writable = (p) => Object.values(p.writes).filter((v) => v === 'ok').length;
const showProbe = (p) => `user ${p.uid}:${p.gid}, powers (capabilities) ${p.caps}, writable ${writable(p)} of 6\n${Object.entries(p.writes).map(([d, v]) => `  ${d.padEnd(16)}${v}`).join('\n')}`;

try {
  assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

let ctx;
try {
  cleanup(CHALLENGE);
  const flags = readFlags(pick(here, 'run-flags.txt'));
  run(['volume', 'create', ...label(CHALLENGE), VOLUME]);

  // Step 1: build. The context is the sample service plus probe.mjs.
  ctx = mkdtempSync(join(tmpdir(), 'dkr-c4-p2-'));
  for (const f of ['package.json', 'server.mjs']) copyFileSync(join(root, 'daftar-api', f), join(ctx, f));
  copyFileSync(join(here, 'probe.mjs'), join(ctx, 'probe.mjs'));
  const built = build({ dockerfile: pick(here, 'Dockerfile'), context: ctx, tag: IMAGE });
  rec.step('docker build -t dkr-c4-p2-app:test .', built.out.split(/\r?\n/).filter((l) => /^#\d+ \[|ERROR|error:/.test(l)).slice(-8).join('\n'), built.ok ? 'Built from your Dockerfile.' : 'The build failed. Read the lines above.');
  if (!built.ok) throw new Error(built.out.split(/\r?\n/).slice(-10).join('\n'));

  const inspect = JSON.parse(run(['image', 'inspect', IMAGE]).stdout)[0];
  const imageUser = inspect.Config.User || '';
  const envPort = Number((inspect.Config.Env.find((e) => e.startsWith('PORT=')) || 'PORT=8080').split('=')[1]);
  facts['c4.p2.image_user_numeric'] = /^[1-9]\d*(:\d+)?$/.test(imageUser);
  facts['c4.p2.port_num'] = envPort;

  // Step 2: the baseline. The same image, as root, with no flags at all.
  const base = run(['run', '--rm', ...safeArgs(CHALLENGE, 'probe'), '--user', '0:0', '-v', `${VOLUME}:/app/data`, IMAGE, 'node', 'probe.mjs']);
  if (base.code !== 0) throw new Error(`baseline probe failed: ${(base.stderr || base.stdout).trim()}`);
  const baseline = lastJson(base.stdout);
  rec.step('docker run --rm --user 0:0 -v dkr-c4-p2-data:/app/data dkr-c4-p2-app:test node probe.mjs', showProbe(baseline), 'Baseline: this is what a process that breaks out of your app can do when the container runs as root with no extra flags.');

  // Step 3: your run: the user from the image, plus your flags.
  const mine = run(['run', '--rm', ...safeArgs(CHALLENGE, 'probe'), ...flags, IMAGE, 'node', 'probe.mjs']);
  const mineFlags = flags.join(' ');
  if (mine.code !== 0) throw new Error(`probe with your flags failed: ${(mine.stderr || mine.stdout).trim().split(/\r?\n/)[0]}`);
  const yours = lastJson(mine.stdout);
  rec.step(`docker run --rm ${mineFlags} dkr-c4-p2-app:test node probe.mjs`.replace('  ', ' '), showProbe(yours), 'Yours: the same image with your user and your flags.');

  // Step 4: the real service must still work with those flags, and its main process must not be root.
  const start = run(['run', '-d', ...safeArgs(CHALLENGE, 'app'), ...flags, '-p', `127.0.0.1::${envPort}`, IMAGE]);
  if (start.code !== 0) throw new Error(`could not start the service with your flags: ${start.stderr.trim()}`);
  let healthOk = false;
  try {
    const port = await waitFor(() => run(['port', 'dkr-c4-app', `${envPort}/tcp`]).stdout.match(/:(\d+)\s*$/m)?.[1], { timeoutMs: 5000, intervalMs: 50, what: 'a published port' });
    await waitFor(() => fetch(`http://127.0.0.1:${port}/health`).then((r) => r.status === 200).catch(() => false), { timeoutMs: 8000, intervalMs: 50, what: '/health' });
    healthOk = true;
  } catch {
    /* healthOk stays false; the logs below say why */
  }
  const status = run(['exec', 'dkr-c4-app', 'sh', '-c', 'grep -E "^(Uid|CapEff):" /proc/1/status']).stdout.trim();
  const svcUid = Number(/Uid:\s*(\d+)/.exec(status)?.[1] ?? -1);
  const ro = run(['inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', 'dkr-c4-app']).stdout.trim() === 'true';
  const logs = healthOk ? '' : (() => { const l = run(['logs', '--tail', '4', 'dkr-c4-app']); return (l.stdout + l.stderr).trim(); })();
  rec.step(
    `docker exec dkr-c4-app sh -c 'grep -E "^(Uid|CapEff):" /proc/1/status'`,
    `${status}\nread-only root filesystem: ${ro}\n/health answered: ${healthOk}${logs ? `\n${logs}` : ''}`,
    svcUid === 0 ? 'The service itself runs as uid 0 (root).' : `The service runs as uid ${svcUid}, not root.`,
  );
  run(['rm', '-f', 'dkr-c4-app']);

  // Step 5: ports below 1024. Docker lets a non-root process bind them by default. Check, then turn that off.
  const low = (extra) => lastJson(run(['run', '--rm', ...safeArgs(CHALLENGE, 'probe'), '--user', '10001:10001', ...extra, IMAGE, 'node', 'probe.mjs']).stdout);
  const lowDefault = low([]);
  const lowStrict = low(['--sysctl', 'net.ipv4.ip_unprivileged_port_start=1024']);
  rec.step(
    'docker run --rm --user 10001:10001 [--sysctl net.ipv4.ip_unprivileged_port_start=1024] dkr-c4-p2-app:test node probe.mjs',
    `default settings:        port 80 -> ${lowDefault.port80}, port 8080 -> ${lowDefault.port8080}\nsysctl start at 1024:    port 80 -> ${lowStrict.port80}, port 8080 -> ${lowStrict.port8080}`,
    'Docker lets a non-root user open port 80 by default. Other runtimes may not, so build the image to listen above 1024.',
  );

  // Facts
  facts['c4.p2.service_uid'] = svcUid;
  facts['c4.p2.readonly_root'] = ro;
  facts['c4.p2.health_ok'] = healthOk;
  facts['c4.p2.caps_baseline'] = baseline.caps;
  facts['c4.p2.caps_yours'] = yours.caps;
  facts['c4.p2.writable_paths_baseline'] = writable(baseline);
  facts['c4.p2.writable_paths_yours'] = writable(yours);
  facts['c4.p2.data_writable'] = yours.writes['/app/data'] === 'ok';
  facts['c4.p2.etc_writable'] = yours.writes['/etc'] === 'ok';
  facts['c4.p2.code_writable'] = yours.writes['/app'] === 'ok';
  facts['c4.p2.low_port_default_ok'] = lowDefault.port80 === 'ok';
  facts['c4.p2.low_port_sysctl1024_ok'] = lowStrict.port80 === 'ok';
  saveFacts(facts);

  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${assertDocker()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Places a hijacked process can write (out of 6)',
        unit: 'paths',
        bars: [
          { label: 'Root, no flags', value: writable(baseline) },
          { label: 'Your setup', value: writable(yours) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nService user ${svcUid}, read-only root ${ro}, writable paths ${writable(yours)} of 6 (baseline ${writable(baseline)}).`);
} catch (e) {
  console.error(`\nStopped: ${clip(e.message, 12)}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
  removeImages();
  if (ctx) rmSync(ctx, { recursive: true, force: true });
}
