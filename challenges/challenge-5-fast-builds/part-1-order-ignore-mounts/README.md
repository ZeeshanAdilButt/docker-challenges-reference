# Challenge 5, part 1: order, ignore rules and cache mounts

**Time:** about 45 minutes. **Download:** `node:24-alpine` (62 MB packed, from challenge 4) and about 25 MB of npm packages per fresh install. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Your pipeline takes minutes to build an image after a change of one line. You look at the log: it downloads and installs 275 npm packages on every push, although you did not touch a single dependency. The log also says it sent 48 MB to the builder before it started. Both costs are in the Dockerfile and in the project folder, and both are cheap to remove.

## The idea

Docker builds an image in steps, one per instruction. It keeps the result of each step. On the next build it asks, step by step, "is this step the same as last time?" The first step that is different, and every step after it, runs again. Four things decide "the same":

| Step | It is the same when |
|---|---|
| `FROM` | the base image is the same |
| `COPY` | the files it copies are the same (compared by content) |
| `RUN` | the text of the command is the same, and every step before it was the same |
| `ARG` and `ENV` | the value is the same |

That gives three rules.

1. **Slow and rare first, fast and often last.** Copy only `package.json` and `package-lock.json`, run the install, and copy the code after. A code change then starts rebuilding at the `COPY` of the code. The install is CACHED.
2. **Send only what the build needs.** A `.dockerignore` file lists what must not go to the builder. Without it, `.git`, `node_modules` from your laptop, logs and coverage reports are sent every time, and `COPY . .` puts them into the image.
3. **Use a cache mount for downloads.** `RUN --mount=type=cache,target=/root/.npm npm ci` gives npm a folder that stays between builds. When the dependencies do change, npm finds the packages it already downloaded. The folder is not part of the image.

A cache mount is not the layer cache. The layer cache skips a whole step. A cache mount only makes a step that must run anyway a little faster. Do not expect the mount to rescue a bad step order.

## Your job

Edit `Dockerfile` and `.dockerignore` in this folder (not the files in `reference/`). `run.mjs` builds a project folder that looks like a real one after some weeks: your source, the dependency files, and 46 MB of clutter.

`daftar-api` has no dependencies of its own, so this part adds a realistic list (express, pino, zod, and dev tools such as typescript, eslint and vitest) in `challenges/challenge-5-fast-builds/app/`. The service does not import them. They give the install step real work to do.

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-5-fast-builds/part-1-order-ignore-mounts/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-5-fast-builds/part-1-order-ignore-mounts/run.mjs` | Builds your Dockerfile, then changes one line of code three times and rebuilds, then bumps a dependency three times and rebuilds, with and without the cache mount. About 4 minutes with the starter. |
| 3 | Read the step list under the code change. Move the `COPY` of the code after the install. Copy only the two dependency files before it. | The install line says CACHED. |
| 4 | Add the cache mount to the install step, with its own `id`: `--mount=type=cache,target=/root/.npm,id=dkr-c5-npm`. | The npm cache is not in the image any more. |
| 5 | Edit `.dockerignore`: `.git`, `node_modules`, `coverage`, `logs`, `*.log`. | The build folder shrinks from 48 MB to 0.1 MB. |
| 6 | Run step 2 again. | A code change rebuilds in seconds. |
| 7 | `node toolkit/show-facts.mjs c5.p1` | Shows the saved numbers. |
| 8 | `node --test challenges/challenge-5-fast-builds/part-1-order-ignore-mounts/test.mjs` | The test passes. |

## What you should see

The step list after a one line code change, reference Dockerfile:

```text
[1/5]   0.1 s  FROM docker.io/library/node:24-alpine@sha256:...
[2/5] CACHED   WORKDIR /app
[3/5] CACHED   COPY package.json package-lock.json ./
[4/5] CACHED   RUN --mount=type=cache,target=/root/.npm,id=dkr-c5-npm npm ci
[5/5]   0.1 s  COPY server.mjs ./
```

and the same list for the starter, where `COPY . .` comes first, so `npm ci` runs again. The recorded numbers are in [results.md](results.md) and in the chart.

![Rebuild time after a change (median of 3)](chart.svg)

Read the chart honestly. The code change is much faster once the order is right: 2 s against 19 s for the starter on the quiet machine that recorded this. The cache mount is a smaller and noisier win. The same three dependency bumps took 8.3 s with the mount and 14.6 s without it in the recorded run, and in earlier runs the saving was anywhere from 2 s to 10 s. Between two identical builds the noise was 2 to 3 s. npm's whole download cache is only about 21 MB, so the download is a small part of an install on a fast network. The mount matters more on a slow link, on a runner far from the registry, or where the registry limits downloads. Compare the shape, not the seconds.

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c5.p1.context_mb` | The `transferring context` line of `docker build --progress=plain` for the first build. |
| `c5.p1.image_unpacked_mb` | `docker save` of the image, then the files in all layers are added up. `c5.p1.image_docker_size_mb` keeps the `Size` field of `docker image inspect`, which on the containerd image store is not the size of the files. |
| `c5.p1.clutter_in_image`, `c5.p1.npm_cache_in_image_mb` | `ls -d` and `du -sk` inside the image. |
| `c5.p1.code_change_s` | Wall clock of `docker build` after a one line change in `server.mjs`. Median of three. |
| `c5.p1.code_change_steps_cached`, `c5.p1.code_change_steps_total`, `c5.p1.install_reran_on_code_change` | The numbered steps of the last code-change build. The `CACHED` markers are read from the plain progress output. |
| `c5.p1.deps_change_s` | Wall clock of `docker build` after a dependency version bump (three different bumps). Median of three. |
| `c5.p1.deps_change_nomount_s`, `c5.p1.mount_saving_s` | The same bumps with every `--mount=` option removed from your Dockerfile. The two kinds of build take turns. The saving is the difference of the medians. |
| `c5.p1.mount_used` | Your Dockerfile has `RUN --mount=type=cache`. |

## What is different on Docker Desktop

Timing differs. On Docker Desktop the build runs in a virtual machine, and your project folder is sent into it, so a large build folder costs more than on Linux. That makes the `.dockerignore` step matter even more. The step list and the CACHED markers are the same on every system. The cache mount lives inside the BuildKit cache of the Docker engine. If you clear the build cache, the mount is empty again.

## Stuck?

- The install still runs after a code change: check the order. A `COPY . .` before the install brings the code in early.
- `.dockerignore` does not seem to work: it must be in the build folder, next to the Dockerfile that `run.mjs` copies. Patterns are not regular expressions: `*.log` matches in the top folder only; `**/*.log` matches everywhere.
- Left-over objects after a crash: `node toolkit/cleanup.mjs 5`. The images this part builds are named `dkr-c5-p1-*`.

## Next

Part 2: [cache backends on a cold runner](../part-2-cache-backends/README.md).
