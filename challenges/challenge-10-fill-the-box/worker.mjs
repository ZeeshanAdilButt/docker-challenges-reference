// The little program that runs INSIDE the capped container in challenge 10.
// It is sent to `node -` on standard input, so nothing is mounted from your computer.
// WORK says what to do:
//   legit        a real job: hold 8 MB in the JS heap, start 3 helper processes, open 20 files
//   heap-leak    keep adding 1 MB of JavaScript objects until something stops it
//   buffer-leak  keep adding 1 MB Buffers (memory outside the JS heap) until something stops it
//   fork         start `sleep` processes until Docker says no (at most 200)
//   fds          open /etc/hostname again and again until the open-file limit says no (at most 20000)
// Every step prints one JSON line, so the last line tells how far it got.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const mode = process.env.WORK;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const mb1 = () => Array.from({ length: 131072 }, (_, i) => i + 0.5); // 131072 numbers of 8 bytes = 1 MB
const keep = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (mode === 'heap-leak' || mode === 'legit') {
  const limit = mode === 'legit' ? 8 : 1000;
  for (let i = 1; i <= limit; i++) {
    keep.push(mb1());
    out({ held_mb: i });
    await sleep(10);
  }
}

if (mode === 'buffer-leak') {
  for (let i = 1; i <= 1000; i++) {
    keep.push(Buffer.alloc(1048576, 1)); // fill(1) touches every page, so the memory is really used
    out({ held_mb: i });
    await sleep(10);
  }
}

if (mode === 'fork' || mode === 'legit') {
  const want = mode === 'legit' ? 3 : 200;
  const kids = [];
  let err = null;
  for (let i = 0; i < want; i++) {
    try {
      const c = spawn('sleep', ['5'], { stdio: 'ignore' });
      await new Promise((res, rej) => {
        c.once('spawn', res);
        c.once('error', rej);
      });
      kids.push(c);
    } catch (e) {
      err = e.code || e.message;
      break;
    }
  }
  out({ children: kids.length, error: err });
  for (const k of kids) k.kill();
}

if (mode === 'fds' || mode === 'legit') {
  const want = mode === 'legit' ? 20 : 20000;
  const fds = [];
  let err = null;
  for (let i = 0; i < want; i++) {
    try {
      fds.push(fs.openSync('/etc/hostname', 'r'));
    } catch (e) {
      err = e.code;
      break;
    }
  }
  out({ files: fds.length, error: err });
  for (const f of fds) fs.closeSync(f);
}

if (mode === 'legit') out({ legit: 'ok' });
