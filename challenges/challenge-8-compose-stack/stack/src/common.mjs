// Settings and helpers shared by the api and the worker. Everything comes from environment variables.

import { PgClient } from './pg.mjs';
import { RespClient } from './resp.mjs';

export const env = {
  dbHost: process.env.DB_HOST ?? 'db',
  dbPort: Number(process.env.DB_PORT ?? 5432),
  dbPassword: process.env.DB_PASSWORD ?? '',
  cacheHost: process.env.CACHE_HOST ?? 'cache',
  cachePort: Number(process.env.CACHE_PORT ?? 6379),
  // How many times to try again at start-up before giving up and exiting, and how long to wait between tries.
  retries: Number(process.env.STARTUP_RETRIES ?? 0),
  retryMs: Number(process.env.STARTUP_RETRY_MS ?? 1000),
  version: process.env.APP_VERSION ?? '1',
  // Pretend to warm up: wait this long before listening (used by the CI part to model a slow start).
  startDelayMs: Number(process.env.STARTUP_DELAY_MS ?? 0),
};

export const log = (obj) => process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...obj })}\n`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openDb() {
  const c = new PgClient({ host: env.dbHost, port: env.dbPort, password: env.dbPassword });
  await c.connect();
  return c;
}

export async function openCache() {
  const c = new RespClient({ host: env.cacheHost, port: env.cachePort });
  await c.connect();
  return c;
}

/** Run fn() until it works, up to env.retries more times. Throws the last error. */
export async function withRetry(what, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      log({ event: 'retry', what, attempt, error: e.code ?? e.message });
      if (attempt >= env.retries) throw e;
      await sleep(env.retryMs);
    }
  }
}
