// Runs inside the container. It tries a few things an attacker who controls the process would try,
// and prints one line of JSON: who am I, what can I write, what powers do I have, can I open ports.
// Run it yourself: docker run --rm <image> node probe.mjs
import fs from 'node:fs';
import net from 'node:net';

const targets = ['/app', '/app/data', '/tmp', '/etc', '/usr/local/bin', '/'];
const writes = {};
for (const dir of targets) {
  const file = `${dir === '/' ? '' : dir}/.dkr-probe`;
  try {
    fs.writeFileSync(file, 'x');
    fs.unlinkSync(file);
    writes[dir] = 'ok';
  } catch (e) {
    writes[dir] = e.code || 'error'; // EACCES: not allowed. EROFS: read-only file system. ENOENT: no such folder.
  }
}

// CapEff is the set of Linux powers this process has right now, as a hex number. We count the bits.
const capEff = /^CapEff:\s*([0-9a-f]+)/m.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1];
const caps = [...BigInt(`0x${capEff}`).toString(2)].filter((c) => c === '1').length;

const listen = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e) => resolve(e.code || 'error'));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve('ok')));
  });

const out = { uid: process.getuid(), gid: process.getgid(), caps, writes, port80: await listen(80), port8080: await listen(8080) };
console.log(JSON.stringify(out));
