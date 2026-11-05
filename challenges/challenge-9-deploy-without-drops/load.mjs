// A small load generator that counts failed requests.
//
// As a script:   node load.mjs http://127.0.0.1:41234 10        (send load for 10 seconds, print the counts)
// As a module:   const load = startLoad({ url }); ...do the restart...; const result = await load.stop();
//
// Every request opens a new connection (no keep-alive), so a restart shows up as what a new client would see.
// A request fails if the connection is refused, reset, times out, or the answer is not a 2xx status.
// Only use it on containers you started yourself.

import http from 'node:http';

const classify = (err) => {
  const c = err.code ?? '';
  if (c === 'ECONNREFUSED') return 'refused';
  if (c === 'ECONNRESET' || c === 'EPIPE' || /socket hang up/i.test(err.message)) return 'reset';
  if (c === 'ETIMEDOUT' || err.message === 'timeout') return 'timeout';
  return 'other';
};

/**
 * Start sending requests. Options:
 *   url          base URL, for example http://127.0.0.1:41234
 *   paths        the paths to cycle through. Default: a slow request (150 ms) and a quick one.
 *   concurrency  how many requests are in flight at once (default 8)
 *   intervalMs   each worker starts one request every intervalMs (default 100), so the load stays at
 *                about concurrency x 10 requests per second even when requests fail at once
 *   timeoutMs    give up on one request after this long (default 3000)
 * Returns { stop() }. stop() resolves with the counts and a list of every failure with its time.
 */
export function startLoad({ url, paths = ['/slow?ms=150', '/'], concurrency = 8, intervalMs = 100, timeoutMs = 3000 }) {
  const t0 = Date.now();
  const result = { total: 0, ok: 0, failed: 0, refused: 0, reset: 0, timeout: 0, http_5xx: 0, other: 0, versions: {}, failures: [] };
  let running = true;
  let n = 0;

  const one = (path) =>
    new Promise((resolve) => {
      const started = Date.now();
      const fail = (kind) => {
        result.failed += 1;
        result[kind] += 1;
        result.failures.push({ at: started - t0, kind });
        resolve();
      };
      const req = http.get(new URL(path, url), { agent: false, timeout: timeoutMs }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            result.ok += 1;
            try {
              const v = JSON.parse(body).version;
              if (v) result.versions[v] = (result.versions[v] ?? 0) + 1;
            } catch { /* not JSON */ }
            resolve();
          } else fail('http_5xx');
        });
        res.on('error', (e) => fail(classify(e)));
        res.on('aborted', () => fail('reset'));
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', (e) => fail(classify(e)));
    });

  const worker = async () => {
    while (running) {
      result.total += 1;
      const started = Date.now();
      await one(paths[n++ % paths.length]);
      const wait = intervalMs - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  };
  const workers = Array.from({ length: concurrency }, worker);

  return {
    /** Milliseconds since the load started. */
    elapsed: () => Date.now() - t0,
    async stop() {
      running = false;
      await Promise.all(workers);
      const times = result.failures.map((f) => f.at);
      result.outage_ms = times.length ? Math.max(...times) - Math.min(...times) : 0; // first failure to last failure
      result.duration_ms = Date.now() - t0;
      return result;
    },
  };
}

// Command line use.
if (import.meta.filename === process.argv[1]) {
  const [url, seconds = '10'] = process.argv.slice(2);
  if (url) {
    const load = startLoad({ url });
    setTimeout(async () => {
      const r = await load.stop();
      const { failures, ...counts } = r;
      console.log(JSON.stringify(counts, null, 2));
    }, Number(seconds) * 1000);
  }
}
