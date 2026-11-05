// missing-env: a tiny HTTP service. GET /health answers 200 when the service is fine.
import http from 'node:http';

const port = Number(process.env.PORT ?? 8080);
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('FATAL: DATABASE_URL is not set. Set it to a postgres:// address.');
  process.exit(1);
}
const dbHost = new URL(databaseUrl).hostname;

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { status: 'ok', service: 'missing-env' });
  if (req.url === '/') return send(200, { service: 'missing-env', database_host: dbHost });
  return send(200, { service: 'missing-env', ok: true });
});
server.listen(port, '0.0.0.0', () => log({ event: 'listening', service: 'missing-env', port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
