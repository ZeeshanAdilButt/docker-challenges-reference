// Part 1 reference: read an image with your own code. See ../readimage.mjs for the task.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const blobPath = (digest) => `blobs/${digest.replace(':', '/')}`;
export const readJson = (entries, path) => JSON.parse(entries.get(path).toString('utf8'));

export function readImage(entries) {
  const index = readJson(entries, 'index.json');
  const manifestDigest = index.manifests[0].digest;
  const manifest = readJson(entries, blobPath(manifestDigest));
  const configDigest = manifest.config.digest;
  const config = readJson(entries, blobPath(configDigest));
  return {
    manifestDigest,
    configDigest,
    architecture: config.architecture,
    os: config.os,
    layers: manifest.layers.map((l, i) => ({ digest: l.digest, size: l.size, mediaType: l.mediaType, diffId: config.rootfs.diff_ids[i] })),
    history: (config.history ?? []).map((h) => ({ createdBy: h.created_by, emptyLayer: h.empty_layer === true })),
  };
}

export function findBadDigests(entries) {
  const bad = [];
  for (const [path, bytes] of entries) {
    if (!path.startsWith('blobs/sha256/')) continue;
    const name = `sha256:${path.slice('blobs/sha256/'.length)}`;
    if (sha256(bytes) !== name) bad.push(name);
  }
  return bad;
}

export function findBadDiffIds(entries) {
  const bad = [];
  for (const layer of readImage(entries).layers) {
    const blob = entries.get(blobPath(layer.digest));
    const plain = blob[0] === 0x1f && blob[1] === 0x8b ? gunzipSync(blob) : blob;
    if (sha256(plain) !== layer.diffId) bad.push(layer.diffId);
  }
  return bad;
}
