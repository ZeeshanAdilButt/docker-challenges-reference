# Challenge 2, part 4: size forensics

**Time:** about 40 minutes. **Download:** `alpine:3.23` (about 4 MB packed; the same image as parts 1 and 2). **Disk:** the build makes two images (88 MB and 8 MB of files) and removes them again. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

The pipeline pushes an image. It takes four minutes to pull on a new server, and the image is 90 MB. The app itself is a few hundred bytes of text. Somebody says "use a smaller base image". The base is 8 MB. The size is not there.

Guessing at size is how teams spend a week switching base images and save 3 MB. The fix is to look at the layers, find where the bytes are, and ask of each one: did this need to ship?

## The idea

Every layer is a tar. Its size is the sum of the files a build step added or changed. Two things make an image bigger than the app:

1. **Things you copied that you did not mean to copy.** `COPY . /app` sends the whole build context: `.git` history, test fixtures, notes. A `.dockerignore` file keeps them out of the context, before they reach any layer. That is the cheapest win, and it also speeds up every build.
2. **Bytes that are shipped and then made useless.**
   - `RUN chown -R` after `COPY` changes the owner of every file. A layer cannot change a file in place, so the layer holds a **full new copy** of every file. The first copy is still in the layer below. Use `COPY --chown` and the file is written once.
   - `RUN rm` of a file made in an earlier step only adds a whiteout note (part 2). Make and remove a temporary file in the **same** `RUN`, or do not write it into a layer at all.

Call the shipped but invisible bytes **wasted bytes**. They are in the download and on disk, and a running container cannot see them. A good image has none.

Packed size (what a pull downloads) and unpacked size (what lands on disk) are different numbers. Both are reported here, always with their name.

Your task, in two parts:

1. Write three functions in `forensics.mjs`: a report of every layer, the biggest layers, and the wasted bytes.
2. Use what they say about `Dockerfile.fat` to fix `Dockerfile.slim` and `Dockerfile.slim.dockerignore` (next to it).

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-2-take-an-image-apart/part-4-size-forensics/test.mjs` | Fails on purpose: `forensics.mjs` is not written and `Dockerfile.slim` is still the fat one. |
| 2 | Open `forensics.mjs`, write `layerReport`, `biggestLayers`, `wastedBytes` | Use `openImage`, `layerFiles` and `layerBytes` from `../lib/image.mjs`. |
| 3 | `node challenges/challenge-2-take-an-image-apart/part-4-size-forensics/run.mjs` | Prints your forensics report for the fat image. With the starter, the slim numbers equal the fat ones. About 40 seconds. |
| 4 | Edit `Dockerfile.slim` and `Dockerfile.slim.dockerignore` | Remove the waste you found. Keep the output and `USER 1000`. |
| 5 | `node challenges/challenge-2-take-an-image-apart/part-4-size-forensics/run.mjs` | Builds your slim image and compares. |
| 6 | `node toolkit/show-facts.mjs c2.p4` | Shows the saved facts. |
| 7 | `node --test challenges/challenge-2-take-an-image-apart/part-4-size-forensics/test.mjs` | All tests pass. |

The build context (`.git` with 12 MB, `fixtures` with 18 MB, a few small files) is made on the fly by `context.mjs`, so the repository stays small.

## What you should see

For the fat image, your report shows a small base layer and three big ones:

```text
layer 0     3.85 MB packed    8.42 MB unpacked  ADD alpine-minirootfs ...
layer 2    30.0  MB packed   30.0  MB unpacked  COPY . /app
layer 3    30.0  MB packed   30.0  MB unpacked  RUN chown -R 1000:1000 /app
layer 4    20.0  MB packed   20.0  MB unpacked  RUN head -c 20000000 /dev/urandom > /var/cache/build.tmp
wasted: 50 MB of 88.4 MB (57 percent)
  replaced in a later layer: about 30 MB   deleted in a later layer: 20 MB
```

(The exact numbers are in [results.md](results.md).) The chown layer holds the same 30 MB again. The 20 MB temporary file is still shipped after `rm`. About half the image is waste, and the app needs none of the 30 MB that was copied.

After your fix, the slim image is about a tenth of the size (8.4 MB) and wastes nothing.

![Unpacked size of each layer of the fat image, and the slim image](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c2.p4.fat_layer_count` | Rows in your `layerReport`. |
| `c2.p4.fat_packed_mb` | Sum of `packedBytes`, divided by 1e6. What a pull downloads. |
| `c2.p4.fat_unpacked_mb` | Bytes of all files in all layers, divided by 1e6. |
| `c2.p4.fat_docker_size_field_mb` | `docker image inspect`, field `Size`. With the containerd store it adds the compressed blobs to the unpacked files, so it is larger than both. |
| `c2.p4.fat_biggest_layer_mb` | First row of your `biggestLayers`. |
| `c2.p4.fat_chown_layer_mb` | The row whose step contains `chown`. |
| `c2.p4.fat_wasted_mb`, `c2.p4.fat_wasted_percent` | Your `wastedBytes`, and its share of the unpacked size. |
| `c2.p4.fat_wasted_replaced_mb`, `c2.p4.fat_wasted_deleted_mb` | The two reasons in your `items`. |
| `c2.p4.slim_packed_mb`, `c2.p4.slim_unpacked_mb` | The same two sizes for your slim image. |
| `c2.p4.slim_wasted_mb` | Your `wastedBytes` on the slim image. Must be 0. |
| `c2.p4.slim_saved_percent` | How much smaller the slim image is on disk. |
| `c2.p4.slim_runs_same`, `c2.p4.slim_user_id`, `c2.p4.slim_has_git` | The slim image prints the same text, runs as user 1000, and has no `.git` folder. |

## What is different on Docker Desktop

- The `Size` field of `docker image inspect` differs between image stores. With the containerd store (the default in Docker Engine 29 and Docker Desktop) it counts the compressed blobs and the unpacked files together: here 173 MB for an image whose files total 88 MB. With the older store it is the unpacked size. This challenge counts the files in the layers itself, so its numbers do not depend on the store.
- `COPY --chown` and `.dockerignore` behave the same everywhere. A Windows checkout may change line endings in `run.sh`: the repository's `.gitattributes` keeps them as LF.

## Stuck?

- `layerReport is not written yet`: that is the starter. Open `forensics.mjs`.
- `createdBy` is empty for some layers: history has entries with `empty_layer: true` that made no layer. Skip those before matching.
- The slim image still has `.git`: the file must be named `Dockerfile.slim.dockerignore` and sit next to `Dockerfile.slim`.
- `USER 1000` and `COPY --chown=1000:1000` go together: the files must be readable by that user.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 2`. Image tags: `docker image rm dkr-c2-fat:1 dkr-c2-slim:1`.
