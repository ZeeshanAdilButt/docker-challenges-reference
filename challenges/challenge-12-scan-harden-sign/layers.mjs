// Look inside a saved image for strings. No scanner, no npm packages.
//
// `docker save <image>` writes a tar file. Inside it are the image config (a JSON file) and one blob per layer.
// A layer is a tar file too, often compressed with gzip. This reads all of it and reports where each string
// was found. That includes files that a LATER layer deleted: a delete hides the file, it does not remove it.

import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

/** Parse a tar stream held in one Buffer. Yields { name, type, data } for each file. */
function* tarEntries(buf) {
  let pos = 0;
  let longName = null;
  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    let name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const size = parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
    if (prefix) name = `${prefix}/${name}`;
    const data = buf.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0.*$/, '');
      continue;
    }
    if (type === 'x' || type === 'g') continue;
    yield { name: longName ?? name, type, data };
    longName = null;
  }
}

const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Read the whole output of `docker save`. Returns a Buffer. */
function save(image) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', ['save', image], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`docker save ${image} failed: ${err.trim()}`))));
  });
}

/**
 * Find strings in an image. needles is { label: "text" }.
 * Returns { found: { label: [where, ...] }, layers, configs } where "where" says which blob held it:
 * "config" (the image configuration: environment, history, build arguments) or "layer".
 */
export async function findInImage(image, needles) {
  const tar = await save(image);
  const found = Object.fromEntries(Object.keys(needles).map((k) => [k, []]));
  let layers = 0;
  let configs = 0;
  const look = (buf, where, name) => {
    for (const [label, text] of Object.entries(needles)) if (buf.includes(text)) found[label].push(`${where} ${name.replace(/^blobs\/sha256\//, '').slice(0, 12)}`);
  };
  for (const e of tarEntries(tar)) {
    if (e.type !== '0' || e.data.length === 0) continue;
    // JSON files (config, manifest, index) and layer blobs. Blobs have no extension in the OCI layout.
    let data = e.data;
    if (isGzip(data)) {
      try {
        data = gunzipSync(data);
      } catch {
        continue;
      }
    }
    const asText = data.subarray(0, 1).toString() === '{';
    if (asText) {
      configs += 1;
      look(data, 'config', e.name);
    } else if (data.length > 512 && data.toString('ascii', 257, 262) === 'ustar') {
      layers += 1;
      look(data, 'layer', e.name);
    } else if (e.name.endsWith('.tar')) {
      layers += 1;
      look(data, 'layer', e.name);
    }
  }
  return { found, layers, configs };
}
