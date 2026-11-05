// bad-healthcheck: a tiny HTTP service. GET /health answers 200 when the service is fine.
import http from 'node:http';

const port = Number(process.env.PORT ?? 8080);
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { status: 'ok', service: 'bad-healthcheck' });
  return send(200, { service: 'bad-healthcheck', ok: true });
});
server.listen(port, '0.0.0.0', () => log({ event: 'listening', service: 'bad-healthcheck', port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
