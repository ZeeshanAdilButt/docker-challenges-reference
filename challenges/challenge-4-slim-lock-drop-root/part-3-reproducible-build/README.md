# Challenge 4, part 3: make the build reproducible

**Time:** about 40 minutes. **Download:** nothing new (`node:24-alpine`, 62 MB packed, from part 1). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A bug appears in production. You check out the commit that was deployed and build it, to test a fix on the same code. The image you get is not the image that runs in production. Is the bug still there? You cannot say, because the two images are not the same bytes. A build you cannot repeat is a build you cannot trust, audit or roll back to.

## The idea

A build is **reproducible** when the same source gives the same image, byte for byte, so the image has the same digest. Three things usually break it.

| What changes | How it gets into the image | The fix |
|---|---|---|
| The base image behind a tag | `FROM node:24-alpine` means "whatever that tag points to today" | Pin the digest: `FROM node:24-alpine@sha256:...` |
| The clock | A `RUN date > file` step, or a build time in the image config | Remove the step. Set `SOURCE_DATE_EPOCH` to the commit time |
| File modified times | A fresh `git clone` gives every file a new time, and `COPY` keeps it | Build with `rewrite-timestamp=true` so every file gets the same time |

Two things can still vary even after this: packages you install with `apk add` or `npm install` without exact versions, and the base itself when you update the pin on purpose. Pins are not forever. Keep them fresh with a bot (Dependabot supports `docker` as a package ecosystem), so that you move the pin in a pull request with a build and a test, not by accident.

A digest is the SHA-256 of the image manifest. Same digest, same bytes. That is also why you deploy by digest (challenge 6).

## Your job

`Dockerfile` has one step that breaks the build, and `build-flags.txt` is missing what is needed for the rest. `run.mjs` builds your image twice from the same source (the second time the files get a new modified time, as a fresh checkout would) and shows which layers differ. Fix `Dockerfile` and `build-flags.txt` in this folder, not the files in `reference/`.

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-4-slim-lock-drop-root/part-3-reproducible-build/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-4-slim-lock-drop-root/part-3-reproducible-build/run.mjs` | Builds twice without cache, compares the digests and the layers, then shows a base tag moving. About 1 minute. |
| 3 | Read the layer table. Remove the step that writes the date. Run step 2 again. | One layer is fixed. One still differs. Which one? |
| 4 | Edit `build-flags.txt`: add `--build-arg SOURCE_DATE_EPOCH=1700000000` and change the output line to `--output type=oci,rewrite-timestamp=true`. Run step 2 again. | Zero layers differ. |
| 5 | `docker buildx imagetools inspect node:24-alpine` and copy the line `Digest:`. Put it in the `FROM` line after the tag as `@sha256:...`. | The base can no longer move. |
| 6 | `node challenges/challenge-4-slim-lock-drop-root/part-3-reproducible-build/run.mjs` | `image digest SAME`. |
| 7 | `node toolkit/show-facts.mjs c4.p3` | Shows the saved numbers. |
| 8 | `node --test challenges/challenge-4-slim-lock-drop-root/part-3-reproducible-build/test.mjs` | The test passes. |

## What you should see

From the table that step 2 prints, before (the starter) and after (the reference run):

```text
starter:    image digest DIFFERENT      layer 6 DIFFERENT (COPY)    layer 7 DIFFERENT (RUN date)
reference:  image digest SAME           all 6 layers same
```

The last step of the run is the one to remember. A base tag moves under a Dockerfile that did not change. `FROM tag` gives a new image digest. `FROM digest` gives the same one. This run moves the tag on your own machine (a local name, `dkr-c4-base:moving`), so it needs no network and touches no registry. On Docker Hub the same thing happens when the maintainers publish a patched `node:24-alpine`.

The full recorded run is in [results.md](results.md).

![Layers that differ between two builds of the same source](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c4.p3.digest_equal` | The two builds export the image as an OCI tar (`docker buildx build --output type=oci`). The digest is in `index.json` of each tar. |
| `c4.p3.config_equal` | The digest of the image config blob in each tar. The config holds the creation time and the history. |
| `c4.p3.layers_total`, `c4.p3.layers_differ` | The layer digests from the manifest in each tar, compared by position. |
| `c4.p3.base_pinned` | The first `FROM` line of your Dockerfile contains `@sha256:` and 64 hex characters. |
| `c4.p3.tag_drift_changed`, `c4.p3.pin_drift_changed` | `Dockerfile.drift` is built before and after the local tag `dkr-c4-base:moving` is pointed at a patched copy of the base. One build uses the tag, one uses the digest of the first base. |
| `c4.p3.reproducible` | `digest_equal` and `base_pinned` are both true. |

## What is different on Docker Desktop

The OCI export (`--output type=oci`) works with the containerd image store, which is the default in Docker Engine 29 and later. If your Docker uses the older classic image store and says the OCI exporter is not supported for the docker driver, create a builder with `docker buildx create --use --name dkr-c4-builder --driver docker-container`, run this part, and remove the builder afterwards with `docker buildx rm dkr-c4-builder`. That downloads a BuildKit image of about 110 MB. Nothing else differs between Docker Desktop and Docker Engine on Linux.

## Stuck?

- `first build failed`: read the lines printed under it. A typo in the digest gives `not found`.
- The digests are different but all layers are the same: the image config still has a time in it. Check that both `SOURCE_DATE_EPOCH` and `rewrite-timestamp=true` are in `build-flags.txt`.
- Left-over objects after a crash: `node toolkit/cleanup.mjs 4`. Images this part builds are named `dkr-c4-*`.

## Next

Challenge 5, [make the build fast](../../challenge-5-fast-builds/part-1-order-ignore-mounts/README.md).
