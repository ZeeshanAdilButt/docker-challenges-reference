// Challenge 10, part 2: logs and disk growth.
// Run:  node challenges/challenge-10-fill-the-box/part-2-logs-and-disk-growth/run.mjs
// Add --record to write results.md and chart.svg. Add --reference to use reference/settings.json.
//
// A container prints about 12 MB of log lines. We look at how much disk the log takes with no
// rotation and with your rotation, then fill a capped tmpfs and the writable layer on purpose.
// Every container is capped at 64 MB of memory. Nothing here writes more than about 30 MB to disk.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { run, assertDocker, cleanup, name } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { round } from '../../../toolkit/stats.js';
import { waitFor } from '../../../toolkit/docker.js';
import { CHALLENGE, ALPINE_IMAGE, LOG_LINES, LOG_BUDGET_BYTES, cageArgs, docker, show, removeByName, emitLogs, tmpfsWriter, gradeSettings, targetDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 10, part 2: logs and disk growth');

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const settings = JSON.parse(readFileSync(join(targetDir(here), 'settings.json'), 'utf8'));
const f = (k, v) => setFact(`c10.p2.${k}`, v);
const mib = (b) => round(b / 1048576, 1);
const listing = (disk) => disk.map((d) => `${String(d.bytes).padStart(8)}  ${d.file.replace(/^[0-9a-f]{12,}/, '<id>')}`).join('\n');

try {
  cleanup(CHALLENGE);
  const pull = run(['pull', '--quiet', ALPINE_IMAGE]);
  if (pull.code !== 0) throw new Error(`docker pull ${ALPINE_IMAGE} failed: ${pull.stderr.trim()}`);
  console.log(`Using settings from ${join(targetDir(here), 'settings.json')}: ${JSON.stringify(settings)}`);

  // Step 1: which log driver does this daemon use when you say nothing? Measured.
  const driver = docker(['info', '--format', '{{.LoggingDriver}}']).trim();
  rec.step("docker info --format '{{.LoggingDriver}}'", driver, `This daemon logs with "${driver}" when you choose nothing. The docs say json-file with no rotation. Check yours: the default decides whether a log can fill the disk.`);
  f('default_log_driver', driver);

  // Step 2: json-file with no rotation. The log keeps everything.
  const none = emitLogs('logs-norot', { driver: 'json-file' });
  const bytesPerLine = none.diskBytes / LOG_LINES;
  rec.step(
    `docker run -d --log-driver json-file ... awk (prints ${LOG_LINES} lines of 220 bytes)`,
    `printed:   ${mib(none.emittedBytes)} MiB (${LOG_LINES} lines)\non disk:   ${mib(none.diskBytes)} MiB in ${none.disk.length} file\nkept:      ${none.keptLines} lines, first ${none.firstKept}, last ${none.lastKept}\n${listing(none.disk)}`,
    `With no rotation every line stays. The file is bigger than what was printed because json-file adds about ${Math.round(bytesPerLine - 221)} bytes of JSON and time per line.`,
  );
  f('norot_printed_mib', mib(none.emittedBytes));
  f('norot_disk_mib', mib(none.diskBytes));
  f('norot_files', none.disk.length);
  f('norot_lines_kept', none.keptLines);
  f('disk_bytes_per_line', Math.round(bytesPerLine));

  // Step 3: your rotation.
  const log = settings.log;
  const rot = emitLogs('logs-rot', log);
  rec.step(
    `docker run -d --log-driver ${log.driver || 'json-file'} --log-opt max-size=${log.max_size || '(none)'} --log-opt max-file=${log.max_file || '(none)'} ... awk`,
    `printed:   ${mib(rot.emittedBytes)} MiB (${LOG_LINES} lines)\non disk:   ${mib(rot.diskBytes)} MiB in ${rot.disk.length} files\nkept:      ${rot.keptLines} lines, first ${rot.firstKept}, last ${rot.lastKept}\n${listing(rot.disk)}`,
    `Rotation keeps the newest lines and drops the oldest. ${LOG_LINES - rot.keptLines} lines are gone for good. That is the price of a bounded disk.`,
  );
  f('rot_disk_mib', mib(rot.diskBytes));
  f('rot_files', rot.disk.length);
  f('rot_lines_kept', rot.keptLines);
  f('rot_lines_lost', LOG_LINES - rot.keptLines);
  f('rot_newest_kept', rot.newestKept);

  // Step 4: what a steady rate does to a disk. Plain arithmetic on the measured bytes per line.
  const perDayMb = round((bytesPerLine * 100 * 86400) / 1e6, 0);
  const daysToFull10Gb = round(10000 / perDayMb, 1);
  rec.step(
    'arithmetic: measured bytes per line x 100 lines per second x 86400 seconds',
    `${Math.round(bytesPerLine)} bytes per line x 100 x 86400 = ${perDayMb} MB per day\n10 GB of free disk lasts ${daysToFull10Gb} days at that rate with no rotation`,
    'This is the 3 am story: nothing is wrong for days, then the disk is full.',
  );
  f('growth_mb_per_day_at_100_lines_s', perDayMb);
  f('days_to_fill_10gb_at_100_lines_s', daysToFull10Gb);

  // Step 5: the none driver.
  removeByName('logs-none');
  const nid = docker(['run', '-d', ...cageArgs('logs-none'), '--log-driver', 'none', ALPINE_IMAGE, 'echo', 'hello']).trim();
  run(['wait', nid]);
  const nl = run(['logs', nid]);
  removeByName('logs-none');
  rec.step('docker logs <container started with --log-driver none>', (nl.stderr || nl.stdout).trim(), 'With the none driver nothing is kept and docker logs cannot read it. No disk use, and no evidence when it breaks.');
  f('none_driver_logs_readable', nl.code === 0 && nl.stdout.trim() !== '');

  // Step 6: tmpfs. It is fast and bounded, but it lives in memory.
  const small = tmpfsWriter('tmpfs-ok', settings.tmpfs_mb, 10);
  rec.step(`docker run --tmpfs /scratch:rw,size=${settings.tmpfs_mb}m ... dd 10 MB into /scratch`, `wrote ${small.wroteMb} MB, memory.current now ${small.memoryCurrentMb} MB of 64`, 'A tmpfs file counts against the container memory. 10 MB of scratch took about 10 MB of the 64 MB.');
  f('tmpfs_small_wrote_mb', small.wroteMb);
  f('tmpfs_small_memory_mb', small.memoryCurrentMb);
  const big = tmpfsWriter('tmpfs-run', settings.tmpfs_mb, 100);
  rec.step(`same tmpfs (size=${settings.tmpfs_mb}m), dd 100 MB`, `stopped at ${big.wroteMb} MB, no-space error: ${big.enospc}, OOMKilled: ${big.oomKilled}, memory.current ${big.memoryCurrentMb} MB`, big.oomKilled ? 'The tmpfs is as big as the memory cap, so memory ran out first and the kernel killed the writer. A tmpfs bigger than the headroom is a hidden memory leak.' : 'The writer got "no space left on device" at the tmpfs size. The kernel killed nothing.');
  f('tmpfs_runaway_wrote_mb', big.wroteMb);
  f('tmpfs_runaway_oomkilled', big.oomKilled);
  f('tmpfs_runaway_enospc', big.enospc);
  const baseline = tmpfsWriter('tmpfs-base', 64, 100);
  rec.step('same test with --tmpfs /scratch:rw,size=64m', `stopped at ${baseline.wroteMb} MB, OOMKilled: ${baseline.oomKilled}`, 'A 64 MB tmpfs inside a 64 MB container cannot work: the kernel runs out of memory first.');
  f('tmpfs_64_oomkilled', baseline.oomKilled);

  // Step 7: the writable layer has no cap by default.
  removeByName('layer');
  const lid = docker(['run', '-d', ...cageArgs('layer'), '--log-opt', 'max-size=1m', ALPINE_IMAGE, 'sh', '-c', 'dd if=/dev/zero of=/var/tmp/big bs=1M count=20 2>/dev/null; echo done; sleep 120']).trim();
  await waitFor(() => run(['logs', lid]).stdout.includes('done'), { timeoutMs: 30_000, what: 'the write to finish' });
  const sizeRw = Number(docker(['inspect', '--size', '--format', '{{.SizeRw}}', lid]).trim());
  const psLine = docker(['ps', '-s', '--no-trunc', '--filter', `name=${name(CHALLENGE, 'layer')}`, '--format', 'table {{.Names}}\\t{{.Size}}']).trim();
  removeByName('layer');
  rec.step(`docker ps -s --filter name=${name(CHALLENGE, 'layer')}`, psLine, `Writing 20 MB to a normal path made the writable layer ${mib(sizeRw)} MB. Nothing capped it. This is the space that fills a host while docker logs looks fine.`);
  f('writable_layer_mb', mib(sizeRw));

  // Step 8: the verdict on settings.json.
  const g = gradeSettings(settings);
  rec.step('check settings.json against the goals', g.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.text}`).join('\n'), g.checks.every((c) => c.ok) ? 'All goals are met.' : 'Not yet. Change settings.json and run again. The goals are in the README.');
  f('goals_met_count', g.checks.filter((c) => c.ok).length);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Engine ${engine}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Log disk use after about 12 MB of output',
        unit: 'MiB',
        bars: [
          { label: 'No rotation', value: mib(none.diskBytes) },
          { label: 'With your rotation', value: mib(rot.diskBytes) },
          { label: 'Budget', value: mib(LOG_BUDGET_BYTES) },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c10.p2');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup(CHALLENGE);
}
