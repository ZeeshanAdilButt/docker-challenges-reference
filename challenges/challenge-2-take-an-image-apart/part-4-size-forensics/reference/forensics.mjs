// Part 4 reference: find out where the bytes of an image went.

import { openImage, layerFiles, layerBytes } from '../../lib/image.mjs';

export function layerReport(tarPath) {
  const img = openImage(tarPath);
  const steps = img.history.filter((h) => h.empty_layer !== true);
  return img.layers.map((l) => ({
    index: l.index,
    packedBytes: l.size,
    unpackedBytes: layerBytes(l),
    createdBy: (steps[l.index]?.created_by ?? '').replace(/\s+/g, ' ').replace(/ # buildkit$/, ''),
  }));
}

export function biggestLayers(tarPath, n) {
  return layerReport(tarPath)
    .sort((a, b) => b.unpackedBytes - a.unpackedBytes)
    .slice(0, n);
}

export function wastedBytes(tarPath) {
  const visible = new Map(); // path -> bytes
  const items = [];
  let wasted = 0;
  for (const layer of openImage(tarPath).layers) {
    const files = layerFiles(layer);
    // deletions of this layer first, then additions: a layer can delete a path and add it again
    for (const f of files) {
      const parts = f.name.split('/');
      const last = parts.pop();
      if (!last.startsWith('.wh.') || last === '.wh..wh..opq') continue;
      const target = [...parts, last.slice(4)].join('/');
      for (const [path, bytes] of [...visible]) {
        if (path === target || path.startsWith(`${target}/`)) {
          items.push({ layerIndex: layer.index, path, bytes, reason: 'deleted' });
          wasted += bytes;
          visible.delete(path);
        }
      }
    }
    for (const f of files) {
      if (f.type !== 'file' || f.name.split('/').pop().startsWith('.wh.')) continue;
      if (visible.has(f.name)) {
        const old = visible.get(f.name);
        items.push({ layerIndex: layer.index, path: f.name, bytes: old, reason: 'replaced' });
        wasted += old;
      }
      visible.set(f.name, f.size);
    }
  }
  return { wasted, items };
}
