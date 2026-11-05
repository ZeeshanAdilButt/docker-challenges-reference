// A very small Valkey/Redis client (the RESP protocol). No dependencies.

import net from 'node:net';

export class RespClient {
  constructor({ host, port = 6379, timeoutMs = 3000 }) {
    Object.assign(this, { host, port, timeoutMs });
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const s = net.connect({ host: this.host, port: this.port });
      this.socket = s;
      s.setTimeout(this.timeoutMs, () => s.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })));
      s.once('connect', resolve);
      s.once('error', reject);
    });
    this.socket.setTimeout(0);
    this.socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
    this.socket.on('error', (e) => this.fail(e));
    this.socket.on('close', () => this.fail(Object.assign(new Error('connection closed'), { code: 'ECLOSED' })));
  }

  fail(err) {
    this.closed = true;
    this.error = err;
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  // Parse one reply from the start of the buffer. Returns { value, rest } or null when incomplete.
  parse(b, at = 0) {
    const eol = b.indexOf('\r\n', at);
    if (eol < 0) return null;
    const type = String.fromCharCode(b[at]);
    const line = b.toString('utf8', at + 1, eol);
    const after = eol + 2;
    if (type === '+') return { value: line, end: after };
    if (type === '-') return { value: Object.assign(new Error(line), { resp: true }), end: after };
    if (type === ':') return { value: Number(line), end: after };
    if (type === '$') {
      const n = Number(line);
      if (n < 0) return { value: null, end: after };
      if (b.length < after + n + 2) return null;
      return { value: b.toString('utf8', after, after + n), end: after + n + 2 };
    }
    if (type === '*') {
      const n = Number(line);
      if (n < 0) return { value: null, end: after };
      const items = [];
      let pos = after;
      for (let i = 0; i < n; i++) {
        const r = this.parse(b, pos);
        if (!r) return null;
        items.push(r.value);
        pos = r.end;
      }
      return { value: items, end: pos };
    }
    throw new Error(`unexpected reply type ${type}`);
  }

  pump() {
    while (this.waiters.length) {
      const r = this.parse(this.buf);
      if (!r) return;
      this.buf = this.buf.subarray(r.end);
      const w = this.waiters.shift();
      if (r.value instanceof Error) w.reject(r.value);
      else w.resolve(r.value);
    }
  }

  /** Send one command, for example cmd('LPUSH', 'jobs', 'a'). Resolves with the reply. */
  cmd(...args) {
    if (this.closed) return Promise.reject(this.error);
    const parts = [`*${args.length}\r\n`];
    for (const a of args) {
      const s = String(a);
      parts.push(`$${Buffer.byteLength(s)}\r\n${s}\r\n`);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.socket.write(parts.join(''));
    });
  }

  close() {
    this.closed = true;
    this.socket?.destroy();
  }
}
