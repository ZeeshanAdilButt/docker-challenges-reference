# Challenge 2, part 1: read an image's manifest and layers with your own code

**Time:** about 40 minutes. **Download:** `alpine:3.23` (about 4 MB packed). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Someone says "this image is 1.6 GB". Another says "it pulls 600 MB". A third says "it has 14 layers". All three are right, about different things, and you cannot tell which number to trust. You also cannot answer the question every pull raises: how does Docker know the bytes it got are the bytes it asked for?

You cannot reason about an image until you have seen what is inside one. Not a diagram. The real files.

## The idea

An image is not one file. It is a handful of small files, each named after the SHA-256 hash of its own bytes. That name is called a **digest**.

- A **layer** is a tar of the files that one build step added or changed.
- The **config** says how to run it (environment, command, user) and lists the **diffIds**: the hash of each layer after it is uncompressed. It also keeps the **history**, one line per Dockerfile step.
- The **manifest** lists the config and the layers by digest, with sizes. The manifest digest is what a registry, and a `repo@sha256:...` reference, point to.
- `index.json` points at the manifest.

So there are two digests per layer. The manifest holds the hash of the **compressed** bytes: that is what you download (packed size). The config holds the hash of the **uncompressed** bytes: that is what lands on disk (unpacked size). Docker checks the first when it pulls, and the second when it unpacks.

Because every pointer is a hash of the thing it points to, one flipped bit anywhere makes the name wrong. That is the whole trick. You will prove it.

Your task: `readimage.mjs` has three empty functions. Write them. The test builds a small image, saves it with `docker save`, and runs your functions on it.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-2-take-an-image-apart/part-1-read-the-manifest/test.mjs` | Fails on purpose: the functions throw `not written yet`. |
| 2 | Open `readimage.mjs`, write `readImage`, `findBadDigests`, `findBadDiffIds` | The comments say what each returns. You need only `node:crypto` and `node:zlib`. |
| 3 | `node --test challenges/challenge-2-take-an-image-apart/part-1-read-the-manifest/test.mjs` | Repeat until the first tests pass. The facts test still fails. |
| 4 | `node challenges/challenge-2-take-an-image-apart/part-1-read-the-manifest/run.mjs` | Builds `dkr-c2-demo:1`, saves it, reads it with your code, flips one bit, compares with `docker image inspect`. About 10 seconds. |
| 5 | `node toolkit/show-facts.mjs c2.p1` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-2-take-an-image-apart/part-1-read-the-manifest/test.mjs` | All tests pass. |

The helper `lib/image.mjs` (one folder up) is a finished reader that later parts use. Do not open it before you try: it is the answer.

## What you should see

The saved tar holds ten small files. Your code prints the five layers and the nine history lines, and the numbers add up:

```text
5 layers:
  layer 0  5e9b4a97f639   3852227 bytes packed  diffId 54ea9baa1bbd  oci.image.layer.v1.tar+gzip
  layer 1  7b52a99efe69        93 bytes packed  ...
9 steps, 4 made no layer, 5 made a layer
good image:      0 bad digests, 0 bad diffIds
one bit flipped: 1 bad digest -> 5e9b4a97f639
Size        12986090 bytes (unpacked, on disk)
your layers 3852819 bytes (packed, what a pull downloads)
```

Notice three things:

1. The base layer, alpine, is almost all of the size. The four layers you wrote are 93 to 190 bytes each.
2. `ENV`, `LABEL` and `CMD` make history lines but no layers. Layers equal steps that write files.
3. Packed (3.9 MB) is much smaller than unpacked (13 MB). "How big is the image" has two honest answers.

The full recorded run is in [results.md](results.md).

![Packed size of each layer](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c2.p1.layer_count` | Length of `layers` that your `readImage` returned. |
| `c2.p1.history_count`, `c2.p1.history_empty_count` | Length of `history`, and how many entries have `emptyLayer: true`. |
| `c2.p1.layers_under_1kb_count` | Layers whose packed size is under 1024 bytes. |
| `c2.p1.manifest_bytes`, `c2.p1.config_bytes` | Size of those two blobs in the tar. |
| `c2.p1.packed_mb` | Sum of the layer sizes in the manifest, divided by 1e6. |
| `c2.p1.unpacked_mb` | `docker image inspect`, field `Size`, divided by 1e6. |
| `c2.p1.base_layer_packed_mb` | Size of layer 0. |
| `c2.p1.bad_digests_count`, `c2.p1.bad_diffids_count` | What your two checks found on the good image. Must be 0. |
| `c2.p1.tampered_detected_count` | What `findBadDigests` found after one bit was flipped in layer 0. Must be 1. |
| `c2.p1.diffids_match_inspect` | Your diffIds equal `RootFS.Layers` from `docker image inspect`. |
| `c2.p1.image_id_is_manifest_digest` | `docker image inspect` field `Id` equals your manifest digest. |

## What is different on Docker Desktop

- Docker Engine 29 and Docker Desktop use the containerd image store on a fresh install. `docker save` then writes an OCI layout (`index.json`, `blobs/`), which is what you read here. The image ID is the manifest digest. With the older "classic" store, the ID is the config digest and the tar has `manifest.json` and one folder per layer. This challenge reads the OCI layout.
- Sizes are the same on Windows, macOS and Linux. Only the time `docker save` takes differs.

## Stuck?

- `readImage is not written yet`: that is the starter. Open `readimage.mjs`.
- `index.json` is missing from the tar: your Docker uses the classic image store. Turn on the containerd image store in Docker Desktop (Settings, General) or use Engine 29.
- Your layer sizes are off by a few bytes: `size` is the size of the **blob** in the tar, not the unpacked size.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 2`. The image tag `dkr-c2-demo:1` can be removed with `docker image rm dkr-c2-demo:1`.
