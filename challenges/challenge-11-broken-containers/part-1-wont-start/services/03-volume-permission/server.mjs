// volume-permission: a tiny HTTP service. GET /health answers 200 when the service is fine.
import http from 'node:http';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const port = Number(process.env.PORT ?? 8080);
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
// Keep the data in the volume at /var/lib/shop.
mkdirSync('/var/lib/shop/db', { recursive: true });
writeFileSync('/var/lib/shop/db/started.txt', new Date().toISOString());

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { status: 'ok', service: 'volume-permission' });
  if (req.url === '/') return send(200, { service: 'volume-permission', started_at: readFileSync('/var/lib/shop/db/started.txt', 'utf8') });
  return send(200, { service: 'volume-permission', ok: true });
});
server.listen(port, '0.0.0.0', () => log({ event: 'listening', service: 'volume-permission', port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
