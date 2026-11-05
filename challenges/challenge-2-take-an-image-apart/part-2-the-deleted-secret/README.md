# Challenge 2, part 2: a deleted secret is still in the image

**Time:** about 40 minutes. **Download:** `alpine:3.23` (about 4 MB packed; the same image as part 1). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A team ships an image. Someone finds a password in it. The Dockerfile copies the config in, uses it, then runs `rm` on it. The container looks clean: the file is not there, `cat` cannot find it, `ls` shows nothing. The team says "we deleted it". A security scanner says "your image contains a credential". Both are telling the truth.

If you cannot explain this, you will either leak secrets or waste hours arguing with the scanner.

## The idea

An image is a stack of layers. A layer is never changed after it is made. Each build step adds a **new** layer on top.

When a later step "deletes" a file, Docker cannot reach back and edit the old layer. It adds a new layer with a small note that means "hide this path". That note is called a **whiteout**: an empty file named `.wh.<name>` next to where the file was. When the container starts, the layers are merged and the note hides the file. But the old layer is still in the image, byte for byte, and anyone who pulls the image can read it with `tar`.

So deleting in a later layer:

- does **not** remove the bytes (the secret is still there),
- does **not** make the image smaller (the bytes are still shipped and pulled),
- only hides the path from the running container.

The only safe secret is one that **never enters a layer of the image you ship**. In a multi-stage build, only the last stage becomes the image. Earlier stages can use anything, and none of it ships.

The secret in this challenge is made up: `config/prod.env` holds a fake key that opens nothing. The build also copies a 3 MB file, `seed.bin`, and deletes it, so you can see the size too.

Your task, in two parts:

1. Write three functions in `recover.mjs` that find the secret in the layers of a saved image, get it back, and list the whiteouts.
2. Fix `Dockerfile.fixed` so the final image prints the same output but has the secret in no layer and deletes nothing.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-2-take-an-image-apart/part-2-the-deleted-secret/test.mjs` | Fails on purpose: `recover.mjs` is not written and `Dockerfile.fixed` still leaks. |
| 2 | Open `recover.mjs`, write `findInLayers`, `recoverFile`, `whiteouts` | You may use `openImage` and `layerFiles` from `../lib/image.mjs`. Part 1 showed you how they work. |
| 3 | Open `Dockerfile.fixed`, stop the leak | Read the comment at the top. |
| 4 | `node challenges/challenge-2-take-an-image-apart/part-2-the-deleted-secret/run.mjs` | Builds both images, searches the layers, recovers the secret, checks your fix. About 15 seconds. |
| 5 | `node toolkit/show-facts.mjs c2.p2` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-2-take-an-image-apart/part-2-the-deleted-secret/test.mjs` | All tests pass. |

## What you should see

The running leaky container shows nothing: `ls /app` lists `app.sh warm.txt`, and `cat /app/prod.env` fails. But the layers say otherwise:

```text
7 layers:
  layer 2       234 bytes packed       108 bytes unpacked  COPY config/prod.env /app/prod.env
  layer 3   3001162 bytes packed   3000000 bytes unpacked  COPY seed.bin /app/seed.bin
  layer 6       148 bytes packed         0 bytes unpacked  RUN /bin/sh -c rm /app/prod.env /app/seed.bin
findInLayers: layer 2 file app/prod.env
whiteouts:    layer 6 hides app/prod.env; layer 6 hides app/seed.bin
recovered: DEMO_API_KEY="dkr-demo-fake-key-9e1b7c44-not-real"
```

The `rm` layer is 148 bytes. It is a note, not a deletion. The 3 MB layer is still 3 MB. After your fix, the image has four layers, no whiteouts, no secret, and is smaller by about 3 MB packed.

The full recorded run is in [results.md](results.md).

![Packed size: the deleted file is still shipped](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c2.p2.leaky_layer_count` | Layers in the saved leaky image. |
| `c2.p2.secret_layer_index`, `c2.p2.secret_found_layers_count` | Your `findInLayers`: which layer holds the secret, and in how many. |
| `c2.p2.whiteout_layer_index`, `c2.p2.whiteout_count` | Your `whiteouts`: the layer with the notes, and how many. |
| `c2.p2.secret_recovered` | Your `recoverFile` returned a file that contains the secret. |
| `c2.p2.deleted_file_visible_in_container` | `docker run ... cat /app/prod.env` exited 0. It must be `false`: the file is hidden. |
| `c2.p2.seed_layer_packed_mb`, `c2.p2.seed_file_bytes` | Packed size of the layer that copied `seed.bin`, and the file's size. |
| `c2.p2.seed_deleted_still_shipped_bytes` | Unpacked bytes of that layer: what `rm` did not remove. |
| `c2.p2.leaky_packed_mb`, `c2.p2.fixed_packed_mb` | Sum of the layer sizes in the manifest, divided by 1e6. This is what a pull downloads. |
| `c2.p2.leaky_unpacked_mb`, `c2.p2.fixed_unpacked_mb` | `docker image inspect`, field `Size`, divided by 1e6. This is what lands on disk. |
| `c2.p2.fixed_secret_hits_count`, `c2.p2.fixed_whiteout_count` | The same searches on your fixed image. Both must be 0. |
| `c2.p2.fixed_runs_same` | Your fixed image prints the same lines as the leaky one. |

## What is different on Docker Desktop

Nothing in this part. Layers, whiteouts and `docker save` behave the same on Windows, macOS and Linux.

## Real secrets are different from this one

This is a made-up string. Never put a real credential in a challenge, a Dockerfile or a test. If a real secret has been in an image that was ever pushed, deleting it from the next version is not enough: treat it as leaked and rotate it. Part 4 of challenge 3 shows how to use a secret at build time without it entering a layer (`RUN --mount=type=secret`).

## Stuck?

- `findInLayers is not written yet`: that is the starter. Open `recover.mjs`.
- Your fixed image still has the secret: a `COPY` or `ADD` of `prod.env` in the **last** stage puts it in a layer. Only the last stage is shipped.
- `COPY --from=build` fails: the first stage needs `AS build`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 2`. Image tags: `docker image rm dkr-c2-leaky:1 dkr-c2-fixed:1`.
