// Part 1: read an image with your own code.
//
// `docker save` writes a tar. You get it as `entries`: a Map from a path inside the tar to the bytes
// of that file. For example entries.get('index.json') is a Buffer with the text of index.json.
//
// The layout inside the tar (OCI layout):
//   index.json                     points to the manifest by digest
//   blobs/sha256/<hex>             manifest, config and layers. The file name IS the sha256 of the bytes.
//   manifest.json                  an older index that docker also writes. You do not need it.
//
// Fill in the three functions. The test tells you which one fails and why.
// Allowed: node:crypto and node:zlib. No other packages.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

/** "sha256:<hex>" of some bytes. Provided. */
export const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** Where a blob lives in the tar. blobPath('sha256:ab12') is 'blobs/sha256/ab12'. Provided. */
export const blobPath = (digest) => `blobs/${digest.replace(':', '/')}`;

/** The parsed JSON of a file in the tar. Provided. */
export const readJson = (entries, path) => JSON.parse(entries.get(path).toString('utf8'));

/**
 * Follow the image from the top and return:
 * {
 *   manifestDigest: 'sha256:...',   // the manifest that index.json points to
 *   configDigest:   'sha256:...',   // the config that the manifest points to
 *   architecture:   'amd64',        // from the config
 *   os:             'linux',        // from the config
 *   layers: [ { digest, size, mediaType, diffId } ],   // in order, base layer first
 *   history: [ { createdBy, emptyLayer } ],            // from the config, one per Dockerfile step
 * }
 *
 * digest, size and mediaType come from the manifest. diffId comes from the config (rootfs.diff_ids),
 * at the same position. emptyLayer is true when a history entry made no layer (ENV, CMD, LABEL ...).
 */
export function readImage(entries) {
  // TODO: 1. read index.json. 2. take manifests[0].digest. 3. read that blob: it is the manifest.
  // 4. read manifest.config.digest: it is the config. 5. build the layers and history lists.
  throw new Error('readImage is not written yet. Open challenges/challenge-2-take-an-image-apart/part-1-read-the-manifest/readimage.mjs');
}

/**
 * Check that every file under blobs/sha256/ really has the digest in its name.
 * Return the list of digests ('sha256:<hex>') whose bytes do NOT hash to their name. A good image gives [].
 */
export function findBadDigests(entries) {
  // TODO: loop over entries. For each path that starts with 'blobs/sha256/', hash the bytes with sha256()
  // and compare with the name.
  throw new Error('findBadDigests is not written yet.');
}

/**
 * A layer has two digests. The digest in the manifest is the hash of the compressed bytes (the blob).
 * The diffId in the config is the hash of the same layer after gunzip. Check that they agree.
 * Return the list of diffIds whose uncompressed bytes do NOT hash to the diffId. A good image gives [].
 * Layers may be gzip (first two bytes 1f 8b) or plain tar. Use readImage() to get the layers.
 */
export function findBadDiffIds(entries) {
  // TODO: for each layer, take its blob, gunzipSync it if it starts with 0x1f 0x8b, hash it, compare with diffId.
  throw new Error('findBadDiffIds is not written yet.');
}
