// Part 2: find a "deleted" secret in the layers of a saved image, and get it back.
//
// From ../lib/image.mjs you may use:
//   openImage(tarPath)  -> { layers: [ { index, digest, size, blob } ], ... }   (layers in order, base first)
//   layerFiles(layer)   -> [ { name, type, size, data } ]   the entries of one layer; data is a Buffer
//
// In a layer, a file that was deleted by a later step appears as a "whiteout": an empty file named
// ".wh.<name>" in the same folder. For example app/.wh.prod.env means "app/prod.env is deleted here".
//
// Write the three functions below.

import { openImage, layerFiles } from '../lib/image.mjs';

/**
 * Search every layer for regular files whose bytes contain `needle` (a string).
 * Return [{ layerIndex, layerDigest, path }], one entry per layer and file, in layer order.
 */
export function findInLayers(tarPath, needle) {
  // TODO: open the image, loop over image.layers, loop over layerFiles(layer), look at files only (type === 'file'),
  // and use f.data.includes(needle).
  void openImage; void layerFiles;
  throw new Error('findInLayers is not written yet. Open challenges/challenge-2-take-an-image-apart/part-2-the-deleted-secret/recover.mjs');
}

/** Return the bytes (a Buffer) of the file `path` as it is stored in layer number `layerIndex`. */
export function recoverFile(tarPath, layerIndex, path) {
  // TODO: find the layer, find the file by name, return its data.
  throw new Error('recoverFile is not written yet.');
}

/**
 * List what later layers deleted: [{ layerIndex, deleted }] where `deleted` is the path that the whiteout hides
 * (for the entry "app/.wh.prod.env" it is "app/prod.env").
 */
export function whiteouts(tarPath) {
  // TODO: look for entries whose last path part starts with ".wh.". Ignore ".wh..wh..opq".
  throw new Error('whiteouts is not written yet.');
}
