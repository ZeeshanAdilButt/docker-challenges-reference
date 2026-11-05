// Part 2 reference: find a "deleted" secret in the layers of a saved image, and get it back.

import { openImage, layerFiles } from '../../lib/image.mjs';

export function findInLayers(tarPath, needle) {
  const hits = [];
  for (const layer of openImage(tarPath).layers) {
    for (const f of layerFiles(layer)) {
      if (f.type === 'file' && f.data.includes(needle)) hits.push({ layerIndex: layer.index, layerDigest: layer.digest, path: f.name });
    }
  }
  return hits;
}

export function recoverFile(tarPath, layerIndex, path) {
  const layer = openImage(tarPath).layers[layerIndex];
  const file = layerFiles(layer).find((f) => f.name === path && f.type === 'file');
  if (!file) throw new Error(`${path} is not in layer ${layerIndex}`);
  return Buffer.from(file.data);
}

export function whiteouts(tarPath) {
  const out = [];
  for (const layer of openImage(tarPath).layers) {
    for (const f of layerFiles(layer)) {
      const parts = f.name.split('/');
      const last = parts.pop();
      if (last.startsWith('.wh.') && last !== '.wh..wh..opq') out.push({ layerIndex: layer.index, deleted: [...parts, last.slice(4)].join('/') });
    }
  }
  return out;
}
