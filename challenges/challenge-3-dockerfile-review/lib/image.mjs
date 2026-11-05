// Read an image that `docker save` wrote. Plain Node, no packages.
// An image on disk is a tar. Inside: index.json (or manifest.json), a manifest, a config and one blob per layer.
// Every blob is named after the sha256 of its own bytes. That name is the digest.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { parseTar } from './tar.mjs';

export const sha256 = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`;
export const blobPath = (digest) => `blobs/${digest.replace(':', '/')}`;
export const isGzip = (buf) => buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;

/** All regular files of a saved image tar as a Map: path in the tar to bytes. */
export function readTarFile(path) {
  const entries = new Map();
  for (const e of parseTar(readFileSync(path))) if (e.type === 'file') entries.set(e.name, e.data);
  return entries;
}

const json = (entries, path) => JSON.parse(entries.get(path).toString('utf8'));

/**
 * Follow the saved image from the top: index.json, the manifest, the config, the layers.
 * Returns { manifestDigest, manifest, configDigest, config, layers, history }.
 * Each layer is { index, digest, size, mediaType, diffId, blob }.
 */
export function openImage(entriesOrPath) {
  const entries = typeof entriesOrPath === 'string' ? readTarFile(entriesOrPath) : entriesOrPath;
  let manifestDigest = null;
  let manifest = null;
  if (entries.has('index.json')) {
    let node = json(entries, 'index.json');
    while (node.manifests) {
      const pick = node.manifests.find((m) => !m.platform || (m.platform.os === 'linux' && m.annotations?.['vnd.docker.reference.type'] !== 'attestation-manifest')) ?? node.manifests[0];
      manifestDigest = pick.digest;
      node = json(entries, blobPath(pick.digest));
    }
    manifest = node;
  }
  let configDigest;
  let layerDigests;
  let sizes;
  if (manifest) {
    configDigest = manifest.config.digest;
    layerDigests = manifest.layers.map((l) => l.digest);
    sizes = manifest.layers.map((l) => ({ size: l.size, mediaType: l.mediaType }));
  } else {
    // old style: manifest.json lists files, there is no manifest blob
    const m = json(entries, 'manifest.json')[0];
    configDigest = `sha256:${m.Config.replace(/^blobs\/sha256\//, '').replace(/\.json$/, '')}`;
    layerDigests = m.Layers.map((p) => `sha256:${p.replace(/^blobs\/sha256\//, '').replace(/\/layer\.tar$/, '')}`);
    sizes = m.Layers.map((p) => ({ size: entries.get(p)?.length ?? 0, mediaType: 'unknown' }));
  }
  const config = json(entries, blobPath(configDigest));
  const layers = layerDigests.map((digest, index) => ({
    index,
    digest,
    size: sizes[index].size,
    mediaType: sizes[index].mediaType,
    diffId: config.rootfs.diff_ids[index],
    blob: entries.get(blobPath(digest)),
  }));
  return { manifestDigest, manifest, configDigest, config, layers, history: config.history ?? [] };
}

/** The files of one layer: [{ name, type, size, data }]. Handles gzip. */
export function layerFiles(layer) {
  const raw = layer.blob;
  return parseTar(isGzip(raw) ? gunzipSync(raw) : raw);
}

/** Unpacked size of a layer: bytes of all regular files in it. */
export function layerBytes(layer) {
  return layerFiles(layer).reduce((sum, f) => sum + (f.type === 'file' ? f.size : 0), 0);
}
