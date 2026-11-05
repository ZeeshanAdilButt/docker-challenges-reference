# Challenge 5 notes (maintainers)

## What each part proves

1. **Order, ignore rules, cache mounts.** With the install step after `COPY . .`, every one line code change reinstalls 275 packages. Copying only `package.json` and `package-lock.json` first keeps the install step CACHED. Without a `.dockerignore`, 46 MB of clutter (`.git`, `node_modules`, logs, coverage) is sent to the builder and lands in the image. A cache mount keeps npm's download cache out of the image. On this fast network its time saving is small and noisy (see below).
2. **Cache backends.** On a cold runner (a fresh BuildKit builder container for every build), a local folder cache and a registry cache both bring back the install step, but only with `mode=max`: the install runs in a stage that is not part of the final image, and `mode=min` (and the inline cache) keep only the final image's layers. A registry cache that is read from a different reference than it was written to saves nothing.
3. **Multi-platform (stretch, checks only).** The bake file and workflow describe amd64 and arm64. The arm64 build is learner-only, not recorded here.

The `type=gha` backend exists only on GitHub. This machine cannot run Actions, so there is no `gha` timing. The workflow in part 2 is the learner's own run.

## How starter and reference are checked

Every `run.mjs` accepts `--reference` (or `DKR_USE_REFERENCE=1`) and then uses the file in `reference/` instead of the learner's file. Tests read facts. To check by hand: run the starter with `DKR_FACTS_PATH` pointing to a scratch file, run the test with the same variable (fails), run `run.mjs --reference --record` on the real facts, run the test (passes).

## Deviations and problems

- **A separate builder.** Part 2 needs a cold runner with a cache that lives outside the builder. The default builder cannot do it: `--no-cache` also ignores an imported cache, and the shared build cache cannot be pruned (it belongs to everyone). So part 2 creates `dkr-c5-builder` (driver `docker-container`, image `moby/buildkit:buildx-stable-1`, 112 MB packed, 353 MB unpacked on disk) on a network with a `registry:3` container, and removes it at the end. This is over the 300 MB disk limit the coordinator set for builder pulls (it is under on download size). The builder image was removed after part 2 was recorded.
- **Dependencies.** `daftar-api` has none. The test app adds a realistic list (express, pino, zod, and dev tools: typescript, eslint, prettier, vitest; 275 packages in the lock file) so the install step has work to do. The app does not import them. Version bumps for the dependency change test are in `app/variants/`.
- **The cache mount saves little here.** With npm's cache inside a mount, a dependency change took about 2 s less in one run and 10 s less in another; between identical arms, noise was about 2 to 3 s. The download is a small part of an install on a fast link (the whole npm cache is about 21 MB); extracting 275 packages and committing the layer take most of the time. The README says so, and the test does not depend on that number. It checks the mount is used and that the npm cache is not in the image.
- **A mount id.** The reference uses `id=dkr-c5-npm`. Without an id the cache is keyed by the target path and is shared with every other build on the machine that mounts `/root/.npm`.
- **Pull limits.** Each fresh builder pulls `node:24-alpine` again (62 MB). A part 2 run does about 17 builder starts. Docker Hub's unauthenticated limit is 100 pulls per 6 hours per IP, so avoid running part 2 many times in a row on a shared address.
- **Action pins verified with `gh api repos/<owner>/<repo>/commits/<tag> -q .sha` on 2026-11-05:** actions/checkout v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`; docker/setup-buildx-action v4.4.1 `f87e5991a6d7451dcb8d9637bfbc97413f497069`; docker/build-push-action v7.4.0 `c3c9e263c25d99ce0380d002d59b67737d91b0dc`; docker/setup-qemu-action v4.4.0 `99012661954931238ded8c8b007157a8430204e1`.
- **Workflows ship pinned in both starter and reference.** The faults planted in the part 2 workflow are the cache write (unguarded, `mode=min`), not the pins. An unpinned workflow is never shipped for a learner to copy.
- **Docker Desktop went down** for about 40 minutes when C: filled up during a starter run (other work on the machine took the free space). Results were recorded after it came back.

## What the Docker Desktop learner sees differently

- Cache export to `type=local` and `type=registry` works on the default builder only with the containerd image store. The part uses a `docker-container` builder, so it works on any Docker.
- The builder reaches the registry by container name on a user-defined network, so no port needs publishing and `localhost` confusion does not arise.
- Part 3: Docker Desktop registers the QEMU emulators, so `--platform linux/arm64` works without setup. On plain Linux you may need to install them (needs `--privileged`, which this challenge does not allow).

## Not done

- No `type=gha` timing and no arm64 build (learner-only).
- No recording of the GitHub Actions runs.
- Compose `watch`, bake `--set` overrides and remote builders.
