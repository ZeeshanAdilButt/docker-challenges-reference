# Notes for challenge 2: take an image apart

Builder notes. Not for learners.

## What each part proves

1. **Read the manifest.** `docker save` writes a tar of small files named by digest. Learners write the reader (manifest, config, layers, diffIds, history) and a digest check, and see that one flipped bit is caught. Proves: packed versus unpacked size, two digests per layer, steps without layers.
2. **The deleted secret.** A made-up secret copied in one layer and removed in the next is recoverable from the saved image, and the deleted 3 MB still ships. Learners write the search, the recovery and the whiteout list, then fix the build with a multi-stage `Dockerfile.fixed`.
3. **A tag that moves.** A real `registry:3` in a labelled container. Version 1 is pushed as `:stable` and `:1.0.0`, server A pulls it, version 2 is pushed under the same tag, server B pulls and gets other code, server A stays on version 1 after a restart, server C deployed by digest keeps version 1. Learners write `digestOf`, `listTags`, `layersOf` against the registry API. An update downloads 147 bytes instead of 62 MB.
4. **Size forensics.** Learners write `layerReport`, `biggestLayers`, `wastedBytes` for a fat image (COPY of everything, `chown -R`, a temp file removed in a later layer) and fix `Dockerfile.slim` and `Dockerfile.slim.dockerignore`.

## Design decisions

- **The reader is shared.** `lib/tar.mjs` and `lib/image.mjs` are a finished reader that parts 2 to 4 use. Part 1's learner writes the same logic in `readimage.mjs`. A learner could copy from `lib/image.mjs`; the README tells them not to open it first. This is a known shortcut, accepted for brevity.
- **Images are not removed by `cleanup(2)`.** It handles containers, networks and volumes only. Each `run.mjs` removes its own images by full tag (`removeImages` refuses any tag without `dkr-c2-`), also in the `finally` block.
- **The secret is made up.** `dkr-demo-fake-key-9e1b7c44-not-real`. It opens nothing. The 3 MB `seed.bin` and the part 4 files are pseudo-random bytes made on the fly (`context.mjs`), so the repository stays small.
- **The test builds what the learner edits.** Tests build the learner's Dockerfile and use an independent reader (`lib/image.mjs`, or copies of the logic in the test) so they do not trust the learner's code to judge the learner's image.

## Problems hit

- **Docker Desktop cannot push to a random published port.** `docker push 127.0.0.1:<port>` with `-p 127.0.0.1::5000` fails with `connection refused`, also for `localhost`. With a fixed port (`-p 127.0.0.1:5331:5000`) it works. `run.mjs` of part 3 picks a free port itself. Written in the README.
- With the containerd image store, `docker image inspect` `Id` is the manifest digest, not the config digest. Fact `c2.p1.image_id_is_manifest_digest` records it.
- After `docker run repo@sha256:...` a `repo:<none>` entry stays in `docker image ls`. Part 3's `removeOurImages` removes it by ID, and only for the repository `127.0.0.1:<port>/dkr-c2-app`.
- The shell tool in this environment fails on very long here-documents; source files were written with a file tool instead.

## What the Docker Desktop learner will see differently

- `docker image inspect` sizes differ between image stores. Compare two sizes of one image, not across machines.
- The registry push needs a fixed port on Docker Desktop (see above). Registries on `127.0.0.0/8` are insecure (HTTP) by default.

## More problems hit (second session)

- **`docker image inspect` Size is not the unpacked size with the containerd store.** It is packed plus unpacked (173 MB for an 88 MB image in part 4; 13 MB for 8.4 MB of files in part 1). All unpacked numbers are now counted from the layers; the raw field is kept as `docker_size_field_mb`. The dossier says to label packed and unpacked: this is a third number to label.
- `docker image rm <id>` fails for an image that was pulled by digest only ("referenced in multiple repositories"). Part 3 removes such images as `repo@digest`.
- Docker Desktop crashed once with a socket error after C: filled up and had to be restarted by the coordinator. No data of mine was lost.

## Things not done

- The expected wasted share in part 4 is 50 MB of 88.4 MB (57 percent), measured.
- No test of the learner flow on a classic (non-containerd) image store: the reader supports `manifest.json` as a fallback but it was not exercised.
