// Part 3: ask a registry what a tag points to right now.
//
// A registry is a web server. The part of its API you need here (the "distribution" API):
//
//   GET /v2/<repo>/manifests/<tag or digest>   the manifest. Send an Accept header that lists the types you accept:
//                                              application/vnd.oci.image.index.v1+json
//                                              application/vnd.oci.image.manifest.v1+json
//                                              application/vnd.docker.distribution.manifest.v2+json
//                                              application/vnd.docker.distribution.manifest.list.v2+json
//                                              The answer has a header "Docker-Content-Digest": the digest of the manifest.
//   GET /v2/<repo>/tags/list                   {"name": "...", "tags": ["a", "b"]}
//
// `base` is like "http://127.0.0.1:5000" and `repo` is like "dkr-c2-app". Use the global fetch(). No packages.
//
// Write the three functions below.

export const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ');

/**
 * The digest ("sha256:...") that `tag` points to right now. Read it from the Docker-Content-Digest header
 * of the manifest answer. Throw an Error with the status code if the registry does not answer 200.
 */
export async function digestOf(base, repo, tag) {
  // TODO: fetch `${base}/v2/${repo}/manifests/${tag}` with the Accept header above and return the header value.
  throw new Error('digestOf is not written yet. Open challenges/challenge-2-take-an-image-apart/part-3-a-tag-that-moves/resolve.mjs');
}

/** The tags of a repository, sorted. */
export async function listTags(base, repo) {
  // TODO: fetch `${base}/v2/${repo}/tags/list` and return the sorted `tags` array.
  throw new Error('listTags is not written yet.');
}

/**
 * The layer digests of the image that `ref` (a tag or a digest) points to, in order, base layer first.
 * Fetch the manifest by `ref`. If the answer is an index (it has a `manifests` list instead of `layers`),
 * fetch the first manifest of that list by its digest, then read `layers`.
 * Return [{ digest, size }].
 */
export async function layersOf(base, repo, ref) {
  // TODO
  throw new Error('layersOf is not written yet.');
}
