// The shared part of the ledger service: HTTP, health, warm-up and shutdown.
// Each release (v1.mjs, v2-expand.mjs, v2-rename.mjs) says how it migrates, reads and writes the database.
// The database is one SQLite file (node:sqlite, built into Node), kept on a volume at DB_PATH.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

export function start({ migrate, list, add }) {
  const db = new DatabaseSync(process.env.DB_PATH ?? ':memory:');
  migrate(db);
  const version = process.env.APP_VERSION ?? '1.0.0';
  const warmupMs = Number(process.env.WARMUP_MS ?? 0);
  const t0 = Date.now();
  const columns = () => db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);

  const send = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /health') return send(res, 200, { status: 'ok' });
      if (route === 'GET /ready') return Date.now() - t0 >= warmupMs ? send(res, 200, { ready: true }) : send(res, 503, { ready: false });
      if (route === 'GET /') return send(res, 200, { app: 'ledger', version, columns: columns() });
      if (route === 'GET /customers') return send(res, 200, { customers: list(db) });
      if (route === 'POST /customers') {
        const name = url.searchParams.get('name');
        if (!name) return send(res, 400, { error: 'name is required' });
        add(db, name);
        return send(res, 201, { added: name });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: String(e.message) });
    }
  });

  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => {
    process.stdout.write(`${JSON.stringify({ event: 'listening', version, columns: columns() })}\n`);
  });
}
