// Challenge 7, part 4 test.
// Run: node --test challenges/challenge-7-networks-and-volumes/part-4-volume-loss-and-backup/test.mjs
// It fails until compose.yaml keeps the data in a named volume and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers, run } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-7-networks-and-volumes/part-4-volume-loss-and-backup/run.mjs';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';

test('static check: the database keeps /var/lib/postgresql in a named volume', { skip: dockerDown }, () => {
  const r = run(['compose', '-f', join(filesDir(here), 'compose.yaml'), 'config', '--format', 'json']);
  assert.equal(r.code, 0, `compose.yaml is not valid: ${r.stderr}`);
  const spec = JSON.parse(r.stdout);
  const mount = (spec.services.db.volumes ?? []).find((v) => v.target === '/var/lib/postgresql');
  assert.ok(mount, 'db has no volume at /var/lib/postgresql. Mount a named volume there, for example "pgdata:/var/lib/postgresql".');
  assert.equal(mount.type, 'volume', `The mount at /var/lib/postgresql is a ${mount.type}, not a named volume.`);
  assert.ok(mount.source && spec.volumes?.[mount.source], 'The volume must be named and declared under the top-level "volumes:" key.');
  assert.equal(spec.volumes[mount.source].labels?.['dkr.challenge'], '7', 'Give the volume the label dkr.challenge: "7" so cleanup can find it.');
});

test('the data survives a container being removed and created again (facts from run.mjs)', () => {
  assert.equal(getFact('c7.p4.rows_before'), 3, hint);
  assert.equal(getFact('c7.p4.rows_after_recreate'), 3, `The rows are gone after the container was recreated. The data was not in a named volume. ${hint}`);
  assert.equal(getFact('c7.p4.same_volume_after_recreate'), true, hint);
  assert.equal(getFact('c7.p4.volume_is_named'), true, hint);
});

test('losing the volume loses the data, and both backups bring it back (facts from run.mjs)', () => {
  assert.equal(getFact('c7.p4.rows_after_volume_loss'), 0, hint);
  assert.equal(getFact('c7.p4.rows_after_restore_dump'), 3, hint);
  assert.equal(getFact('c7.p4.rows_after_restore_tar'), 3, hint);
  assert.ok(getFact('c7.p4.dump_bytes') < getFact('c7.p4.tar_mb') * 1048576, 'The logical dump should be smaller than the volume copy');
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(7), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
