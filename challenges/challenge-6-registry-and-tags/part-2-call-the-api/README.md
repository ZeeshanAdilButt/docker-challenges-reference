# Challenge 6, part 2: call the registry API yourself

**Time:** about 40 minutes. **Download:** `registry:3` and `alpine:3.23` (from part 1). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

`docker pull` works, or it does not, and you see one line. When it fails at 3 am with "manifest unknown" or "unauthorized", that one line is all you have. The registry API is plain HTTP, and you can call it with `fetch`. Once you have seen a pull as a list of requests, those errors stop being mysterious. You can also answer questions that the Docker CLI hides: what does this tag point to right now, how many bytes will a pull download, how do I delete an old tag.

## The idea

Every registry that follows the distribution API (Docker Hub, GHCR, a cloud registry, `registry:3`) answers the same few requests under `/v2/`.

| Request | Answers |
|---|---|
| `GET /v2/` | "I am a v2 registry." The header `Docker-Distribution-API-Version` names the version |
| `GET /v2/_catalog` | The list of repositories |
| `GET /v2/<repo>/tags/list` | The tags of one repository, in the field `tags` |
| `HEAD /v2/<repo>/manifests/<tag>` | The digest the tag points to now, in the header `Docker-Content-Digest`. No body |
| `GET /v2/<repo>/manifests/<tag or digest>` | The manifest: config blob, layer blobs, sizes. Send an `Accept` header that lists the types you understand |
| `GET /v2/<repo>/blobs/<digest>` | One blob: a layer or the config |
| `DELETE /v2/<repo>/manifests/<digest>` | Delete a manifest. By digest only. Answers `202` when accepted |

A **pull** of an image the machine does not have is these requests in this order: ping, manifest, then the config blob and one request per layer. If the machine already has every blob, it asks only for the manifest and downloads nothing. A real registry on the internet adds one step at the start: a token request, when the registry needs a login or counts pulls.

**Deleting** a tag removes the reference. The layers stay on disk until the registry runs garbage collection. If you delete tags to save money and storage does not drop, that is why.

## Your job

`client.mjs` is a small client with six functions and a function that deletes a tag. Three of them are wrong. `run.mjs` calls each one against a live registry and compares the answer with the truth: the digest that `docker push` printed, and the SHA-256 of the raw manifest bytes. Fix `client.mjs` in this folder (not the file in `reference/`).

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-6-registry-and-tags/part-2-call-the-api/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-6-registry-and-tags/part-2-call-the-api/run.mjs` | Starts a registry (deletes allowed), pushes two images, calls every function of your client, then pulls an image (with `docker pull`, and as a fresh machine would) and counts the requests in the registry log. Last it deletes a tag and runs garbage collection. About 1 minute. |
| 3 | Read the lines that start with `FAIL`. Fix `client.mjs`. Hints: which field holds the tags? which header holds the digest? what must a delete name, a tag or a digest? | Each fix turns one `FAIL` into `ok`. |
| 4 | Run step 2 again. | All lines say `ok`. Delete answers `202`. |
| 5 | `node toolkit/show-facts.mjs c6.p2` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-6-registry-and-tags/part-2-call-the-api/test.mjs` | The test passes. |

## What you should see

Two pulls, both read from the registry log (the full recorded run is in [results.md](results.md)).

A pull on a machine that already has every layer is one question:

```text
HEAD  /v2/dkr-c6/hello/manifests/3   200
```

A pull on a machine with nothing is the list the idea section describes:

```text
GET   /v2/                           200
GET   /v2/dkr-c6/hello/manifests/3   200
GET   /v2/dkr-c6/hello/blobs/sha256:f220b671...  200   (the config)
GET   /v2/dkr-c6/hello/blobs/sha256:5e9b4a97...  200   (a layer)
GET   /v2/dkr-c6/hello/blobs/sha256:650de554...  200   (a layer)
GET   /v2/dkr-c6/hello/blobs/sha256:3139008f...  200   (a layer)
```

The first case is why a repeated deploy is cheap: layers that the machine has are never downloaded again. The second pull is made by a few lines of Node (the blob requests are `fetch` calls that check each blob against its digest), because Docker on this machine keeps blobs by digest and would not ask for them again. The storage lines at the end show the other lesson: after the `DELETE`, the disk use is almost unchanged. It drops by the size of the unique layer only after garbage collection, which lists the blobs it found eligible. If your client deletes by tag, the registry answers `202` too, but garbage collection frees nothing, because the manifest is still there.

![HTTP requests when a fresh machine pulls one image](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c6.p2.<call>_ok` | The answer of your client function equals the truth: the digest printed by `docker push`, the layers in the manifest, and the SHA-256 of the manifest bytes. |
| `c6.p2.docker_pull_requests_layers_present` | Lines `response completed` in the registry log during a `docker pull` on a machine that already holds the blobs. |
| `c6.p2.pull_requests_total` and its parts | The same log lines during the fresh-machine pull made with `fetch`, grouped by what the path looks like (`/manifests/`, `/blobs/`, or the ping). |
| `c6.p2.delete_status` | The HTTP status of the `DELETE` that `client.deleteTag` sends. `202` is accepted. |
| `c6.p2.storage_kb_*` | `du -sk /var/lib/registry` before the delete, after it, and after `registry garbage-collect /etc/distribution/config.yml`. |
| `c6.p2.image_packed_mb` | Config size plus all layer sizes in the manifest. This is what a pull downloads. |

## What is different on Docker Desktop

Nothing in the API differs. The registry runs in a container and you call it on `127.0.0.1` from your computer, as on Linux. `docker pull` itself is done by the Docker engine inside the virtual machine, which then reaches the registry through the same forwarded port.

## Stuck?

- `FAIL tags()`: a registry answers `{"name": "...", "tags": [...]}`. Check the field name.
- `FAIL digestOf()`: print `res.headers` once. The digest is in a header, and header names are not case sensitive.
- Garbage collection frees nothing: you deleted by tag. Look up the digest first (a HEAD request), then delete the manifest by that digest.
- Left-over objects after a crash: `node toolkit/cleanup.mjs 6`.

## Next

Part 3: [a tag that moves under a second server](../part-3-a-tag-that-moves/README.md).
