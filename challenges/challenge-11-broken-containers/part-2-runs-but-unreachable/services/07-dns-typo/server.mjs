// dns-typo: a tiny HTTP service. GET /health answers 200 when the service is fine.
import http from 'node:http';

const port = Number(process.env.PORT ?? 8080);
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const role = process.env.ROLE ?? 'backend';
const backendUrl = process.env.BACKEND_URL;

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { status: 'ok', service: 'dns-typo' });
  if (req.url === '/orders') {
    if (role === 'backend') return send(200, { orders: [{ id: 1, item: 'tea' }, { id: 2, item: 'sugar' }] });
    try {
      const r = await fetch(`${backendUrl}/orders`, { signal: AbortSignal.timeout(3000) });
      return send(200, await r.json());
    } catch (e) {
      log({ event: 'backend call failed', url: backendUrl, error: String(e.cause?.message ?? e.message) });
      return send(502, { error: 'backend unreachable', detail: String(e.cause?.message ?? e.message) });
    }
  }
  return send(200, { service: 'dns-typo', ok: true });
});
server.listen(port, '0.0.0.0', () => log({ event: 'listening', service: 'dns-typo', port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
