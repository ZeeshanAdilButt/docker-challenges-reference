// A very small Postgres client: simple queries over TCP with SCRAM-SHA-256 login.
// No dependencies. It is enough for this stack and nothing more. Use a real driver in real code.

import net from 'node:net';
import crypto from 'node:crypto';

const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const cstr = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
const msg = (type, body) => Buffer.concat([Buffer.from(type), int32(body.length + 4), body]);
const xor = (a, b) => Buffer.from(a.map((x, i) => x ^ b[i]));
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

export class PgClient {
  constructor({ host, port = 5432, user = 'postgres', password, database = 'postgres', timeoutMs = 3000 }) {
    Object.assign(this, { host, port, user, password, database, timeoutMs });
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;
  }

  /** Open the connection and log in. Rejects with an Error that has a .code such as ECONNREFUSED. */
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

    const params = Buffer.concat([cstr('user'), cstr(this.user), cstr('database'), cstr(this.database), Buffer.from([0])]);
    this.socket.write(Buffer.concat([int32(params.length + 8), int32(196608), params]));
    await this.login();
  }

  fail(err) {
    this.closed = true;
    this.error = err;
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  pump() {
    while (this.waiters.length) {
      if (this.buf.length < 5) return;
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const m = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, len + 1) };
      this.buf = this.buf.subarray(len + 1);
      this.waiters[0].resolve(m);
      this.waiters.shift();
    }
  }

  next() {
    if (this.closed) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.pump();
    });
  }

  async login() {
    const nonce = crypto.randomBytes(18).toString('base64');
    const first = `n=*,r=${nonce}`;
    let serverFirst;
    let clientFinalNoProof;
    let saltedKey;
    for (;;) {
      const m = await this.next();
      if (m.type === 'E') throw pgError(m.body);
      if (m.type === 'Z') return;
      if (m.type !== 'R') continue; // parameter status, backend key
      const code = m.body.readInt32BE(0);
      if (code === 0) continue; // AuthenticationOk
      if (code === 10) {
        const init = Buffer.from(`n,,${first}`);
        this.socket.write(msg('p', Buffer.concat([cstr('SCRAM-SHA-256'), int32(init.length), init])));
      } else if (code === 11) {
        serverFirst = m.body.subarray(4).toString();
        const f = Object.fromEntries(serverFirst.split(',').map((kv) => [kv[0], kv.slice(2)]));
        saltedKey = crypto.pbkdf2Sync(this.password, Buffer.from(f.s, 'base64'), Number(f.i), 32, 'sha256');
        clientFinalNoProof = `c=biws,r=${f.r}`;
        const authMessage = `${first},${serverFirst},${clientFinalNoProof}`;
        const clientKey = hmac(saltedKey, 'Client Key');
        const storedKey = crypto.createHash('sha256').update(clientKey).digest();
        const proof = xor(clientKey, hmac(storedKey, authMessage)).toString('base64');
        this.socket.write(msg('p', Buffer.from(`${clientFinalNoProof},p=${proof}`)));
      } else if (code === 12) {
        continue; // server signature; not verified in this small client
      } else {
        throw new Error(`unsupported authentication method ${code}`);
      }
    }
  }

  /** Run one SQL text with the simple protocol. Returns an array of rows, each an array of strings or null. */
  async query(sql) {
    this.socket.write(msg('Q', cstr(sql)));
    const rows = [];
    let error;
    for (;;) {
      const m = await this.next();
      if (m.type === 'D') {
        const n = m.body.readInt16BE(0);
        let off = 2;
        const row = [];
        for (let i = 0; i < n; i++) {
          const len = m.body.readInt32BE(off);
          off += 4;
          if (len < 0) row.push(null);
          else { row.push(m.body.subarray(off, off + len).toString('utf8')); off += len; }
        }
        rows.push(row);
      } else if (m.type === 'E') {
        error = pgError(m.body);
      } else if (m.type === 'Z') {
        if (error) throw error;
        return rows;
      }
    }
  }

  close() {
    this.closed = true;
    this.socket?.destroy();
  }
}

function pgError(body) {
  const fields = {};
  let i = 0;
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i]);
    const end = body.indexOf(0, i + 1);
    fields[code] = body.subarray(i + 1, end).toString();
    i = end + 1;
  }
  return Object.assign(new Error(fields.M ?? 'postgres error'), { code: fields.C });
}

export const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
