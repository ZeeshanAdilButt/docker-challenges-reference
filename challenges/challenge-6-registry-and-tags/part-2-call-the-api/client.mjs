// A small client for the registry HTTP API (starter: three of these functions are wrong)
// A small client for the registry HTTP API (the "distribution" API, version 2).
// Docs: every call is a plain HTTP request. No library is needed.

// Tell the registry which manifest types we understand. Without this header it may answer
// with an older format, or with "manifest unknown".
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** GET /v2/ : is this a v2 registry, and which version does it say it speaks? */
export async function ping(base) {
  const res = await fetch(`${base}/v2/`);
  return { status: res.status, apiVersion: res.headers.get('docker-distribution-api-version') };
}

/** GET /v2/_catalog : the names of the repositories. */
export async function catalog(base) {
  const res = await fetch(`${base}/v2/_catalog`);
  return ((await res.json()).repositories ?? []).sort();
}

/** GET /v2/<repo>/tags/list : the tags of one repository. */
export async function tags(base, repo) {
  const res = await fetch(`${base}/v2/${repo}/tags/list`);
  if (!res.ok) return [];
  return ((await res.json()).tag ?? []).sort();
}

/** HEAD /v2/<repo>/manifests/<tag> : the digest a tag points to right now. Nothing is downloaded. */
export async function digestOf(base, repo, ref) {
  const res = await fetch(`${base}/v2/${repo}/manifests/${ref}`, { method: 'HEAD', headers: { accept: ACCEPT } });
  return res.ok ? res.headers.get('digest') : null;
}

/** GET /v2/<repo>/manifests/<tag or digest> : the manifest, with its digest from the response header. */
export async function manifest(base, repo, ref) {
  const res = await fetch(`${base}/v2/${repo}/manifests/${ref}`, { headers: { accept: ACCEPT } });
  if (!res.ok) return { status: res.status, digest: null, layers: [] };
  const body = await res.json();
  return { status: res.status, digest: res.headers.get('docker-content-digest'), mediaType: body.mediaType, config: body.config, layers: body.layers ?? [] };
}

/** The bytes a pull would download for one image: config plus all layers (compressed). */
export async function packedBytes(base, repo, ref) {
  const m = await manifest(base, repo, ref);
  return (m.config?.size ?? 0) + m.layers.reduce((sum, l) => sum + l.size, 0);
}

/** DELETE /v2/<repo>/manifests/<digest> : a registry deletes by digest only, never by tag. Returns the HTTP status. */
export async function deleteTag(base, repo, tag) {
  const res = await fetch(`${base}/v2/${repo}/manifests/${tag}`, { method: 'DELETE' });
  return res.status;
}
