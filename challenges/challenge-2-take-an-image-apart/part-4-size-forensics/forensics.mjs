// Part 4: find out where the bytes of an image went.
//
// From ../lib/image.mjs you may use:
//   openImage(tarPath)  -> { layers: [ { index, digest, size, blob } ], history, ... }
//   layerFiles(layer)   -> [ { name, type, size, data } ]   one entry per file, folder or link in the layer
//   layerBytes(layer)   -> unpacked bytes of the regular files in a layer
//
// Write the three functions below. Then run run.mjs and read what they say about Dockerfile.fat.

import { openImage, layerFiles, layerBytes } from '../lib/image.mjs';

/**
 * One row per layer, base layer first:
 * [{ index, packedBytes, unpackedBytes, createdBy }]
 * packedBytes is the blob size (layer.size). unpackedBytes is layerBytes(layer).
 * createdBy is the history text of the step that made the layer. History has one entry per Dockerfile step,
 * but steps with empty_layer === true made no layer: skip those when you match history to layers.
 */
export function layerReport(tarPath) {
  // TODO
  void openImage; void layerBytes;
  throw new Error('layerReport is not written yet. Open challenges/challenge-2-take-an-image-apart/part-4-size-forensics/forensics.mjs');
}

/**
 * The layers sorted by unpackedBytes, biggest first, cut to the first `n`. Same rows as layerReport.
 */
export function biggestLayers(tarPath, n) {
  // TODO
  throw new Error('biggestLayers is not written yet.');
}

/**
 * Wasted bytes: bytes that are shipped in a lower layer but can never be seen, because a higher layer
 * replaced the file or deleted it.
 *
 * Walk the layers from the bottom. Keep a Map from path to bytes of the files that are visible so far.
 *  - A regular file whose path is already in the Map: the old copy is now wasted (reason "replaced"). Store the new one.
 *  - A whiteout (".wh.<name>" in a folder) deletes the path "<folder>/<name>" and everything under it:
 *    all of those bytes are wasted (reason "deleted"). Remove them from the Map.
 *  - Folders and links count as 0 bytes. Ignore ".wh..wh..opq".
 *
 * Return { wasted: totalBytes, items: [{ layerIndex, path, bytes, reason }] } where layerIndex is the layer that
 * made the bytes useless (the replacing or deleting layer).
 */
export function wastedBytes(tarPath) {
  // TODO
  void layerFiles;
  throw new Error('wastedBytes is not written yet.');
}
