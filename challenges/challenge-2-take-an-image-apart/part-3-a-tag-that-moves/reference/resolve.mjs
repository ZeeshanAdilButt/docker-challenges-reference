// Part 3 reference: ask a registry what a tag points to right now.

export const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
].join(', ');

async function getManifest(base, repo, ref) {
  const res = await fetch(`${base}/v2/${repo}/manifests/${ref}`, { headers: { accept: ACCEPT } });
  if (res.status !== 200) throw new Error(`registry answered ${res.status} for ${repo}:${ref}`);
  return { digest: res.headers.get('docker-content-digest'), body: await res.json() };
}

export async function digestOf(base, repo, tag) {
  return (await getManifest(base, repo, tag)).digest;
}

export async function listTags(base, repo) {
  const res = await fetch(`${base}/v2/${repo}/tags/list`);
  if (res.status !== 200) throw new Error(`registry answered ${res.status} for the tag list of ${repo}`);
  return [...(await res.json()).tags].sort();
}

export async function layersOf(base, repo, ref) {
  let { body } = await getManifest(base, repo, ref);
  if (body.manifests) body = (await getManifest(base, repo, body.manifests[0].digest)).body;
  return body.layers.map((l) => ({ digest: l.digest, size: l.size }));
}
