// A tiny server for the dev loop. GET /message returns the text from message.mjs.
import http from 'node:http';
import { MESSAGE } from './message.mjs';

http
  .createServer((req, res) => {
    const body = JSON.stringify({ message: MESSAGE, pid: process.pid });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  })
  .listen(8080, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', message: MESSAGE })));
process.on('SIGTERM', () => process.exit(0));
