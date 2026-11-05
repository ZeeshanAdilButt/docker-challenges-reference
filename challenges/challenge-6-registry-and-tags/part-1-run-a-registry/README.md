# Challenge 6, part 1: run your own registry

**Time:** about 30 minutes. **Download:** `registry:3` (about 21 MB packed) and `alpine:3.23` (4 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Your deploy fails at 8 am with "too many requests". Your whole office shares one IP address, and the public registry counts pulls per address. You cannot fix their limit. You can run a registry of your own, and many teams do: as a cache in front of the public one, or as the place their own images live. Before you trust one, you should know what it is. It is smaller than most people think, and the three ways to run it badly are easy to find.

## The idea

A registry is a web server with one job: store **blobs** (layers and configs) and **manifests** (small JSON files that say which blobs make an image), and give them back by name and by digest. `registry:3` is one container. It speaks HTTP on `/v2/`.

| Piece | What it is |
|---|---|
| Blob | One layer, or the image config, stored under its digest. The same blob is stored once, however many images use it |
| Manifest | A JSON file that lists the config blob and the layer blobs. Its digest is the digest of the image |
| Tag | A name that points at a manifest. A tag can move. A digest cannot |
| Repository | A name such as `dkr-c6/hello` that groups tags |

Three mistakes show up in almost every first registry:

| Mistake | What goes wrong |
|---|---|
| Published on every network interface | The registry has no password. Anyone who can reach your machine can push to it or pull from it |
| No volume | The images live inside the container. Remove the container and they are gone |
| Delete not enabled | `DELETE` on a manifest answers `405`, so you cannot clean up (part 2) |

## Your job

`registry-flags.txt` holds the extra flags for `docker run`. Today it has one line, and that line is the first mistake. Fix all three in this folder (not in `reference/`).

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-6-registry-and-tags/part-1-run-a-registry/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-6-registry-and-tags/part-1-run-a-registry/run.mjs` | Starts the registry with your flags, builds two small images that share a base layer, pushes both, pulls one back three times, then removes the registry container and starts a new one with the same flags. About 1 minute. |
| 3 | Edit `registry-flags.txt` (keep `{PORT}`): publish on `127.0.0.1` only, mount the volume `dkr-c6-registry-data` on `/var/lib/registry`, set `REGISTRY_STORAGE_DELETE_ENABLED=true`. | Each change fixes one line of the output. |
| 4 | Run step 2 again. | The catalog is not empty after the container is recreated. |
| 5 | `node toolkit/show-facts.mjs c6.p1` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-6-registry-and-tags/part-1-run-a-registry/test.mjs` | The test passes. |

## What you should see

The step that teaches the most is the second push. The first image uploads its base layer, its own small layer, a config and a manifest. The second image uploads only its own layer, config and manifest, because the registry already has the base layer:

```text
first push:  <n> blobs stored
second push: the base layer says "Layer already exists"
```

The exact numbers are in [results.md](results.md). The chart compares the storage after the second image with the storage you would need if nothing were shared.

![Registry storage on disk](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c6.p1.bound_host` | The first line of `docker port <registry> 5000/tcp`. `0.0.0.0` means every interface. |
| `c6.p1.blobs_after_push1`, `c6.p1.blobs_after_push2` | Files named `data` under `blobs/` in `/var/lib/registry`, counted inside the registry container. |
| `c6.p1.storage_kb_after_push1`, `c6.p1.storage_kb_after_push2` | `du -sk /var/lib/registry` inside the registry container. |
| `c6.p1.push2_layers_reused` | Lines with `already exists` in the output of the second `docker push`. |
| `c6.p1.pull_s` | Median of three `docker pull` runs. The local copy is removed before each one. This is a registry on the same machine, so it measures the steps, not the internet. |
| `c6.p1.survives_recreate` | `GET /v2/_catalog` of the new container lists `dkr-c6/hello`. |
| `c6.p1.delete_enabled` | The container has `REGISTRY_STORAGE_DELETE_ENABLED=true` in `docker inspect`. |
| `c6.p1.registry_image_unpacked_mb`, `c6.p1.registry_image_packed_mb` | `docker save` of `registry:3`, then the layers are added up: the files they hold (unpacked) and their own size (packed). |

## What is different on Docker Desktop

`127.0.0.1` is treated as a registry you may talk to over plain HTTP, so `docker push 127.0.0.1:<port>/...` needs no extra setting. Any other address for a registry without HTTPS needs an "insecure registries" entry in the Docker settings, which this challenge does not use.

On Docker Desktop the Docker engine runs in a virtual machine, and one thing surprised us. If you let Docker pick the port (`-p 127.0.0.1::5000`), your computer can call the registry, but the engine cannot push to it: the push stops with `connection refused`. When you choose the port yourself (`-p 127.0.0.1:5000:5000`), it works. That is why `run.mjs` picks a free port and puts it where the flags file says `{PORT}`. On Docker Engine on Linux both ways work.

## Stuck?

- `could not start the registry`: another program may use the port. The port here is chosen by Docker, so look at the message under it.
- `push failed ... connection refused`: the engine cannot reach the registry port. Keep the port fixed with `{PORT}`; do not let Docker choose it.
- Left-over objects after a crash: `node toolkit/cleanup.mjs 6`. It removes only objects labelled `dkr.challenge=6`, including the volume.

## Next

Part 2: [call the registry API yourself](../part-2-call-the-api/README.md).
