// read-only-root: a tiny HTTP service. GET /health answers 200 when the service is fine.
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';

const port = Number(process.env.PORT ?? 8080);
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
// Keep a small cache file on disk.
const cacheDir = process.env.CACHE_DIR ?? '/app/cache';
mkdirSync(cacheDir, { recursive: true });
writeFileSync(`${cacheDir}/warm.json`, JSON.stringify({ warmed_at: new Date().toISOString() }));
log({ event: 'cache written', dir: cacheDir });

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { status: 'ok', service: 'read-only-root' });
  return send(200, { service: 'read-only-root', ok: true });
});
server.listen(port, '0.0.0.0', () => log({ event: 'listening', service: 'read-only-root', port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
