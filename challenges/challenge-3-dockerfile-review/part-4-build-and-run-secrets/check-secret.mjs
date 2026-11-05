// Prints how this container got its API key and a fingerprint of the key (the first 8 characters of its sha256).
// It never prints the key. It is copied into the image.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

let source;
let secret;
if (process.env.API_KEY_FILE) {
  source = 'file';
  secret = readFileSync(process.env.API_KEY_FILE, 'utf8').trim();
} else if (process.env.API_KEY) {
  source = 'env';
  secret = process.env.API_KEY;
} else {
  console.error('no API_KEY_FILE and no API_KEY');
  process.exit(1);
}
console.log(JSON.stringify({ source, fingerprint: createHash('sha256').update(secret).digest('hex').slice(0, 8) }));
