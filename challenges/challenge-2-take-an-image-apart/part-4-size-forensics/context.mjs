// Makes the build context for part 4: a small app plus the kind of junk that gets copied by accident.
// The big files are made on the fly (pseudo-random bytes that do not compress), so the repository stays small.
// Provided, nothing to edit.

import { createCipheriv } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GIT_PACK_BYTES = 12_000_000; // pretend .git history
export const VIDEO_BYTES = 18_000_000; // pretend test fixture that the app never reads
export const CACHE_BYTES = 20_000_000; // written and deleted inside Dockerfile.fat

/** Same bytes every time: AES in counter mode over zeros. */
function noise(bytes, seed) {
  const key = Buffer.alloc(16, seed);
  const cipher = createCipheriv('aes-128-ctr', key, Buffer.alloc(16));
  return cipher.update(Buffer.alloc(bytes));
}

export function makeContext(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, '.git', 'objects', 'pack'), { recursive: true });
  mkdirSync(join(dir, 'fixtures'), { recursive: true });
  writeFileSync(join(dir, 'run.sh'), 'echo "daftar ok"\nwc -c /app/src/app.mjs | cut -d" " -f1 | sed "s/^/app.mjs bytes: /"\n');
  writeFileSync(join(dir, 'src', 'app.mjs'), `// the app\nexport const hello = () => 'hello';\n${'// padding so the file has some size\n'.repeat(40)}`);
  writeFileSync(join(dir, 'README.md'), '# daftar\nNotes for people. The image does not need them.\n');
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(dir, '.git', 'objects', 'pack', 'pack-0001.pack'), noise(GIT_PACK_BYTES, 1));
  writeFileSync(join(dir, 'fixtures', 'sample-video.bin'), noise(VIDEO_BYTES, 2));
  return dir;
}
