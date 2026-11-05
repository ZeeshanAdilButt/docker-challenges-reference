// The worker. It keeps one connection to Valkey and one to Postgres, takes jobs from the list "jobs"
// and writes a row to jobs_done for each. If either connection breaks, it exits with code 1 and
// leaves the restart to the restart policy. That is the usual shape of a worker.

import { log, openCache, openDb, withRetry } from './common.mjs';
import { quote } from './pg.mjs';

let db;
let cache;
try {
  db = await withRetry('database at start-up', openDb);
  cache = await withRetry('cache at start-up', openCache);
} catch (e) {
  log({ event: 'fatal', message: 'dependency not reachable at start-up', error: e.code ?? e.message });
  process.exit(1);
}
log({ event: 'worker-started' });

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; });

try {
  while (!stopping) {
    const item = await cache.cmd('BRPOP', 'jobs', 1); // waits up to 1 s, returns null when the list is empty
    if (!item) {
      await db.query('SELECT 1'); // an idle worker still notices a dead database
      continue;
    }
    try {
      await db.query(`INSERT INTO jobs_done (job) VALUES (${quote(item[1])})`);
    } catch (e) {
      await cache.cmd('RPUSH', 'jobs', item[1]); // give the job back before leaving
      throw e;
    }
    log({ event: 'job-done', job: item[1] });
  }
  process.exit(0);
} catch (e) {
  log({ event: 'fatal', message: 'lost a connection', error: e.code ?? e.message });
  process.exit(1);
}
