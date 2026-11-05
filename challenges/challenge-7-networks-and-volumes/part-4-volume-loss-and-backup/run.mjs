// Challenge 7, part 4: lose a volume, then get the data back.
// Run: node challenges/challenge-7-networks-and-volumes/part-4-volume-loss-and-backup/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to use the fixed compose.yaml in reference/ instead of yours.
//
// One Postgres database from compose.yaml gets three rows. Then the script
//   1. removes the container and creates it again (does the data survive?),
//   2. takes two backups: a logical one (pg_dump) and a file copy of the volume (tar),
//   3. deletes the volume (docker compose down -v) and shows the empty database,
//   4. restores from each backup and counts the rows again.
// Backups are held in memory only. Nothing is written outside Docker.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertDocker, cleanup, leftovers, run, waitFor } from '../../../toolkit/docker.js';
import { setFact } from '../../../toolkit/facts.js';
import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { median, round } from '../../../toolkit/stats.js';
import { CHALLENGE, compose, composeOk, docker, exec, filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 7, part 4: lose a volume, then get the data back');

const PROJECT = 'dkr-c7-p4';
const DB = `${PROJECT}-db-1`;
const TOOL = 'alpine:3.23';
const file = join(filesDir(here), 'compose.yaml');
const tracked = new Set(); // volumes seen on our containers, so we can remove exactly those at the end

let engine;
try {
  engine = assertDocker();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const dc = (args, opts) => composeOk(PROJECT, file, args, {}, { timeoutMs: 180_000, ...opts });
const psql = (sql) => compose(PROJECT, file, ['exec', '-T', 'db', 'psql', '-U', 'postgres', '-tA', '-c', sql]);
const rowCount = () => {
  const r = psql('SELECT count(*) FROM notes');
  return r.code === 0 ? Number(r.stdout.trim()) : 0; // 0 when the table does not exist
};
const waitReady = () => waitFor(() => exec(DB, ['pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).ok, { timeoutMs: 60_000, intervalMs: 500, what: 'Postgres to accept connections' });

/** The volumes mounted on the database container right now: [{ name, destination }]. */
function mounts() {
  const r = run(['inspect', DB, '--format', '{{json .Mounts}}']);
  if (r.code !== 0) return [];
  return JSON.parse(r.stdout).filter((m) => m.Type === 'volume').map((m) => ({ name: m.Name, destination: m.Destination }));
}
const noteVolumes = () => mounts().forEach((m) => tracked.add(m.name));
const dataVolume = () => mounts().find((m) => m.destination === '/var/lib/postgresql')?.name;

/** docker with binary-safe input and output, for tar streams. */
function dockerBin(args, input) {
  const r = spawnSync('docker', args, { input, maxBuffer: 512 * 1024 * 1024, windowsHide: true, timeout: 120_000 });
  if (r.status !== 0) throw new Error(`docker ${args.join(' ')} failed: ${String(r.stderr).trim()}`);
  return r.stdout;
}
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const kb = (bytes) => round(bytes / 1024, 1);

try {
  cleanup(CHALLENGE);

  dc(['up', '-d']);
  await waitReady();
  noteVolumes();
  const mountText = mounts().map((m) => `${m.destination} <- volume ${m.name.length > 30 ? `${m.name.slice(0, 12)}... (anonymous, random name)` : m.name}`).join('\n');
  rec.step(`docker compose -p ${PROJECT} up -d   (then: docker inspect ${DB} --format "{{json .Mounts}}")`, mountText || '(no volume)', mounts().some((m) => m.name.length > 30)
    ? 'The Postgres image declares /var/lib/postgresql as a volume. Without a name in your Compose file, Docker invents one: a random 64 character name that nobody will recognise later.'
    : 'The data directory is on a volume with a name you chose. You can find it, back it up and keep it.');

  psql('CREATE TABLE notes (id serial PRIMARY KEY, body text NOT NULL)');
  psql("INSERT INTO notes (body) VALUES ('first'), ('second'), ('third')");
  const before = rowCount();
  rec.step(`docker compose -p ${PROJECT} exec -T db psql -U postgres -tA -c "SELECT count(*) FROM notes"`, String(before), 'Three rows written. This is the data we must not lose.');

  // 1. Recreate: remove the container (not the volume) and create it again.
  const oldVolume = dataVolume();
  dc(['rm', '-sf', 'db']);
  dc(['up', '-d', 'db']);
  await waitReady();
  noteVolumes();
  const afterRecreate = rowCount();
  const sameVolume = dataVolume() === oldVolume;
  rec.step(
    `docker compose -p ${PROJECT} rm -sf db && docker compose -p ${PROJECT} up -d db   (then count rows)`,
    `rows: ${afterRecreate}\nsame data volume as before: ${sameVolume}`,
    afterRecreate === before ? 'The data survived. The new container mounted the same named volume.' : 'The data is gone. The new container got a new, empty anonymous volume. The old one still exists, but nothing points at it.',
  );

  // 2. Two backups. Run each three times and keep the median time.
  const dumpRuns = [];
  let dump = '';
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    const r = compose(PROJECT, file, ['exec', '-T', 'db', 'pg_dump', '-U', 'postgres', '--clean', '--if-exists', 'postgres']);
    dumpRuns.push(ms(t0));
    dump = r.stdout;
  }
  const dumpBytes = Buffer.byteLength(dump);
  const dumpS = round(median(dumpRuns) / 1000, 2);
  const dumpLines = dump.split('\n');
  rec.step(`docker compose -p ${PROJECT} exec -T db pg_dump -U postgres --clean --if-exists postgres`, [...dumpLines.filter((l) => /^(CREATE|INSERT|DROP|COPY)|^\d+\t/.test(l))].slice(0, 12).join('\n'), `A logical backup: SQL text, ${dumpBytes} bytes, ${dumpS} s (median of 3). It can be read, searched and restored into another Postgres version.`);

  const vol = dataVolume();
  dc(['stop', 'db']);
  const tarRuns = [];
  let tarball = Buffer.alloc(0);
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    tarball = dockerBin(['run', '--rm', '--memory', '64m', '--pids-limit', '50', '--label', `dkr.challenge=${CHALLENGE}`, '-v', `${vol}:/data:ro`, TOOL, 'tar', 'cf', '-', '-C', '/data', '.']);
    tarRuns.push(ms(t0));
  }
  const tarBytes = tarball.length;
  const tarS = round(median(tarRuns) / 1000, 2);
  rec.step(`docker stop the database, then: docker run --rm -v <volume>:/data:ro ${TOOL} tar cf - -C /data .`, `${tarBytes} bytes of tar stream`, `A file copy of the volume with the database stopped: ${round(tarBytes / 1048576, 1)} MB, ${tarS} s (median of 3). Copying the files of a running database gives a broken copy, so the database was stopped first.`);
  dc(['start', 'db']);
  await waitReady();

  // 3. Lose the volume.
  dc(['down', '-v']);
  const gone = run(['volume', 'inspect', vol]).code !== 0;
  dc(['up', '-d']);
  await waitReady();
  noteVolumes();
  const afterLoss = rowCount();
  rec.step(`docker compose -p ${PROJECT} down -v && docker compose -p ${PROJECT} up -d   (then count rows)`, `volume ${vol.length > 30 ? `${vol.slice(0, 12)}...` : vol} removed: ${gone}\nrows: ${afterLoss}`, 'The -v flag removes the volumes of the project. One flag, and the data is gone. The database starts again, empty and healthy, and nothing complains.');

  // 4a. Restore the dump (three times on the same database; the dump drops and recreates the table).
  const restoreRuns = [];
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync('docker', ['compose', '-p', PROJECT, '-f', file, 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input: dump, encoding: 'utf8', windowsHide: true });
    restoreRuns.push(ms(t0));
    if (r.status !== 0) throw new Error(`restore of the dump failed: ${r.stderr}`);
  }
  const restoreDumpS = round(median(restoreRuns) / 1000, 2);
  const afterDump = rowCount();
  rec.step(`docker compose -p ${PROJECT} exec -T db psql -U postgres -q  < dump.sql   (then count rows)`, `rows: ${afterDump}`, `Restored from the logical backup in ${restoreDumpS} s (median of 3). The database was running the whole time.`);

  // 4b. Restore the volume copy: stop, empty the volume, unpack, start.
  const volNow = dataVolume();
  dc(['stop', 'db']);
  const untarRuns = [];
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    dockerBin(['run', '--rm', '-i', '--memory', '64m', '--pids-limit', '50', '--label', `dkr.challenge=${CHALLENGE}`, '-v', `${volNow}:/data`, TOOL, 'sh', '-c', 'rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xf - -C /data'], tarball);
    untarRuns.push(ms(t0));
  }
  const restoreTarS = round(median(untarRuns) / 1000, 2);
  dc(['start', 'db']);
  await waitReady();
  const afterTar = rowCount();
  rec.step(`docker run --rm -i -v <volume>:/data ${TOOL} sh -c "rm -rf /data/*; tar xf - -C /data"   (then start the database and count rows)`, `rows: ${afterTar}`, `Restored from the volume copy in ${restoreTarS} s (median of 3), with the database stopped. It brings back everything, including users and settings, but only for the same Postgres major version.`);

  const named = mounts().some((m) => m.destination === '/var/lib/postgresql' && m.name === `${PROJECT}_pgdata`);

  setFact('c7.p4.rows_before', before);
  setFact('c7.p4.rows_after_recreate', afterRecreate);
  setFact('c7.p4.same_volume_after_recreate', sameVolume);
  setFact('c7.p4.volume_is_named', named);
  setFact('c7.p4.rows_after_volume_loss', afterLoss);
  setFact('c7.p4.rows_after_restore_dump', afterDump);
  setFact('c7.p4.rows_after_restore_tar', afterTar);
  setFact('c7.p4.dump_bytes', dumpBytes);
  setFact('c7.p4.dump_s', dumpS);
  setFact('c7.p4.tar_mb', round(tarBytes / 1048576, 1));
  setFact('c7.p4.tar_s', tarS);
  setFact('c7.p4.restore_dump_s', restoreDumpS);
  setFact('c7.p4.restore_tar_s', restoreTarS);

  dc(['down', '-v']);
  for (const v of tracked) run(['volume', 'rm', v]); // volumes that our containers used, by exact name
  cleanup(CHALLENGE);
  const left = leftovers(CHALLENGE);
  if (left.containers + left.networks + left.volumes !== 0) throw new Error('objects with our label are left over');

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Docker Desktop, Docker Engine ${engine}, Compose ${run(['compose', 'version', '--short']).stdout.trim()}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Rows in the database after each event',
        unit: 'rows',
        bars: [
          { label: 'Written', value: before },
          { label: 'Container recreated', value: afterRecreate },
          { label: 'Volume removed', value: afterLoss },
          { label: 'Restored from dump', value: afterDump },
          { label: 'Restored from volume copy', value: afterTar },
        ],
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log('\nDone. See your numbers with: node toolkit/show-facts.mjs c7.p4');
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  process.exitCode = 1;
} finally {
  compose(PROJECT, file, ['down', '-v', '--remove-orphans'], {}, { timeoutMs: 120_000 });
  for (const v of tracked) run(['volume', 'rm', v]);
  cleanup(CHALLENGE);
}
