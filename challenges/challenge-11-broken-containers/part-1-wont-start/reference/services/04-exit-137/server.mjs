// exit-137: a tiny HTTP service. GET /health answers 200 when the service is fine.
import http from 'node:http';

const port = Number(process.env.PORT ?? 8080);
const log = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
// Load a cache into memory at start-up. PRELOAD_MB says how big it is.
const preloadMb = Number(process.env.PRELOAD_MB ?? 0);
const cache = Buffer.alloc(preloadMb * 1024 * 1024, 1);
log({ event: 'cache loaded', mb: preloadMb });

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return send(200, { status: 'ok', service: 'exit-137' });
  if (req.url === '/') return send(200, { service: 'exit-137', preloaded_mb: cache.length / 1048576 });
  return send(200, { service: 'exit-137', ok: true });
});
server.listen(port, '0.0.0.0', () => log({ event: 'listening', service: 'exit-137', port }));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
