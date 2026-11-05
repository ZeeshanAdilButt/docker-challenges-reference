// A small tar reader. Plain Node, no packages.
// It reads the tar that `docker save` writes, and the layer tars inside it.
// It understands the classic ustar header and the two long-name extensions (pax and GNU).

const str = (buf, start, len) => {
  const end = buf.indexOf(0, start);
  return buf.toString('utf8', start, end >= 0 && end < start + len ? end : start + len);
};

// Sizes are octal text. Very large files use a base-256 number (high bit of the first byte set).
function readSize(buf, start) {
  if (buf[start] & 0x80) {
    let n = 0;
    for (let i = start + 1; i < start + 12; i++) n = n * 256 + buf[i];
    return n;
  }
  return parseInt(str(buf, start, 12).trim() || '0', 8);
}

function paxRecords(data) {
  const out = {};
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space < 0) break;
    const len = Number(data.toString('utf8', pos, space));
    if (!len) break;
    const rec = data.toString('utf8', space + 1, pos + len - 1); // key=value
    const eq = rec.indexOf('=');
    out[rec.slice(0, eq)] = rec.slice(eq + 1);
    pos += len;
  }
  return out;
}

/**
 * Parse a tar held in memory. Returns entries: { name, type, size, linkname, data }.
 * type is "file", "dir", "symlink", "hardlink" or "other". data is a view into buf (no copy).
 * Names have no leading "./" and no trailing "/".
 */
export function parseTar(buf) {
  const entries = [];
  let pos = 0;
  let pending = {};
  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    const flag = String.fromCharCode(header[156] || 48);
    let name = str(header, 0, 100);
    if (str(header, 257, 6).startsWith('ustar')) {
      const prefix = str(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    let size = readSize(header, 124);
    let linkname = str(header, 157, 100);
    const data = buf.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;

    if (flag === 'x') {
      pending = paxRecords(data);
      continue;
    }
    if (flag === 'g') continue;
    if (flag === 'L') {
      pending.path = data.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (flag === 'K') {
      pending.linkpath = data.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (pending.path) name = pending.path;
    if (pending.linkpath) linkname = pending.linkpath;
    if (pending.size) size = Number(pending.size);
    pending = {};

    const type = { 0: 'file', 5: 'dir', 2: 'symlink', 1: 'hardlink' }[flag] ?? 'other';
    entries.push({ name: name.replace(/^\.\//, '').replace(/\/+$/, ''), type, size, linkname, data: data.subarray(0, size) });
  }
  return entries.filter((e) => e.name !== '' && e.name !== '.');
}
