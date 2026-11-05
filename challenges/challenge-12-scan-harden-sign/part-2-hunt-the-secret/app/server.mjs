// A tiny service. `node server.mjs --check` prints what it can see and exits, so a test can ask it.
import http from 'node:http';
import { existsSync } from 'node:fs';

const key = process.env.API_KEY ?? '';
const facts = () => ({ api_key_configured: key.length > 0, api_key_length: key.length, env_file_in_image: existsSync('/app/.env'), deploy_key_in_image: existsSync('/app/deploy.key') });

if (process.argv.includes('--check')) {
  console.log(JSON.stringify(facts()));
  process.exit(0);
}

http
  .createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/health' ? { status: 'ok' } : facts()));
  })
  .listen(8080, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port: 8080 })));
