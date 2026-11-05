// wrong-user: a tiny HTTP service. GET /health answers 200 when the service is fine.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number(process.env.PORT ?? 8080);
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const config = JSON.parse(readFileSync('/app/config.json', 'utf8'));

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { status: 'ok', service: 'wrong-user' });
  if (req.url === '/') return send(200, { service: 'wrong-user', greeting: config.greeting, uid: process.getuid() });
  return send(200, { service: 'wrong-user', ok: true });
});
server.listen(port, '0.0.0.0', () => log({ event: 'listening', service: 'wrong-user', port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
