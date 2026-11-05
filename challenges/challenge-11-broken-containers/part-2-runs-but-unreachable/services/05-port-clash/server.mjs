// port-clash: a tiny HTTP service. GET /health answers 200 when the service is fine.
import http from 'node:http';

const port = Number(process.env.PORT ?? 8080);
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const role = process.env.ROLE ?? 'web';

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { status: 'ok', service: 'port-clash' });
  if (req.url === '/') return send(200, { service: 'port-clash', role });
  return send(200, { service: 'port-clash', ok: true });
});
server.listen(port, '0.0.0.0', () => log({ event: 'listening', service: 'port-clash', port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
