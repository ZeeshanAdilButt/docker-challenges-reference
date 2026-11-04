// Challenge 0, part 1: check your toolkit.
// Run: node challenges/challenge-0-setup/part-1-check-your-toolkit/run.mjs
// Add --record to also write results.md and chart.svg next to this file.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { run } from '../../../toolkit/docker.js';
import { checkSetup, formatTable } from '../../../toolkit/check-setup.mjs';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round, timed } from '../../../toolkit/stats.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 0, part 1: check your toolkit');

// Step 1: Node
rec.step('node --version', process.version, `You need Node 22 or newer. Yours is ${process.version}.`);

// Step 2: how fast does the Docker engine answer? Median of three calls.
const format = 'Client {{.Client.Version}}, Engine {{.Server.Version}}';
const versionCmd = `docker version --format "${format}"`;
const calls = [];
let last = { code: 1, stdout: '', stderr: 'not run' };
for (let i = 0; i < 3; i++) {
  const t = await timed(() => run(['version', '--format', format], { timeoutMs: 30_000 }));
  last = t.value;
  calls.push(t.ms);
}
const callMs = Math.round(median(calls));
rec.step(
  versionCmd,
  last.code === 0 ? last.stdout : (last.stderr || last.stdout),
  last.code === 0 ? `The engine answers in about ${callMs} ms (median of 3 calls).` : 'Docker did not answer. Start Docker and run this again.',
);

// Step 3: the full check
const { rows, facts, ok } = checkSetup({ dir: root });
rec.step('node toolkit/check-setup.mjs', `${formatTable(rows)}\n\n${ok ? 'All hard checks passed.' : 'A check failed.'}`, ok ? 'No FAIL lines, so your machine is ready.' : 'Fix every FAIL line, then run this again.');

// Save the numbers
setFact('c0.p1.node_major', facts.node_major);
if (facts.docker_memory_gb !== undefined) setFact('c0.p1.docker_memory_gb', facts.docker_memory_gb);
if (facts.disk_free_gb !== undefined) setFact('c0.p1.disk_free_gb', facts.disk_free_gb);
if (ok) setFact('c0.p1.docker_call_ms', callMs);

const shown = spawnSync(process.execPath, [join(root, 'toolkit', 'show-facts.mjs'), 'c0.p1'], { encoding: 'utf8' });
rec.step('node toolkit/show-facts.mjs c0.p1', shown.stdout, 'These numbers are saved in facts.json. The test reads them.');

if (record && ok) {
  rec.write(join(here, 'results.md'), `${process.platform}, Docker ${facts.desktop ? 'Desktop ' : ''}Engine ${facts.engine_version}, Node ${process.versions.node}`);
  writeFileSync(
    join(here, 'chart.svg'),
    barsSvg({
      title: 'What your machine gives Docker',
      unit: 'GB',
      bars: [
        { label: 'Memory for Docker', value: facts.docker_memory_gb },
        { label: 'Free disk', value: round(facts.disk_free_gb, 1) },
      ],
    }),
  );
  console.log('\nWrote results.md and chart.svg');
}

process.exit(ok ? 0 : 1);
