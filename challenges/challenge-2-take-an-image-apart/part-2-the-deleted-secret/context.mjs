// Makes the build context for part 2: the files in context/ plus seed.bin, 3 MB of bytes that
// do not compress. It is made on the fly so the repository stays small. Provided, nothing to edit.

import { createHash } from 'node:crypto';
import { cpSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const SECRET = 'dkr-demo-fake-key-9e1b7c44-not-real'; // made up. Opens nothing.
export const SEED_BYTES = 3_000_000;

/** Copy context/ to dir and add seed.bin. The bytes are always the same, so builds can use the cache. */
export function makeContext(dir) {
  cpSync(join(here, 'context'), dir, { recursive: true });
  const out = Buffer.alloc(SEED_BYTES);
  let block = createHash('sha256').update('dkr-c2-seed').digest();
  for (let i = 0; i < SEED_BYTES; i += 32) {
    block.copy(out, i, 0, Math.min(32, SEED_BYTES - i));
    block = createHash('sha256').update(block).digest();
  }
  writeFileSync(join(dir, 'seed.bin'), out);
  return dir;
}
