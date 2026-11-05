# Challenge 5, part 2: cache backends on a cold runner

**Time:** about 60 minutes (the run takes 15 to 25 minutes: it starts about 17 fresh builders). **Download:** `moby/buildkit:buildx-stable-1` (112 MB packed, 353 MB on disk, removed at the end), `registry:3` (20.5 MB packed) and `node:24-alpine` (62 MB packed, pulled again by every fresh builder). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

On your laptop the second build is fast, because Docker kept the layers. In CI it is not. A CI job starts on a clean machine, builds, and throws the machine away. Every push starts from nothing: it pulls the base image and installs every package again. The 14-minute pipeline is that, repeated. A **cache backend** is a place outside the runner where the layers wait for the next job.

## The idea

BuildKit can export its cache when a build ends (`--cache-to`) and import it when the next one starts (`--cache-from`). Where the cache lives is the **backend**.

| Backend | Where the cache lives | Good for | Watch out for |
|---|---|---|---|
| `inline` | Inside the image you push, as an extra field | The simplest setup: the image and its cache in one place | Only the layers of the final image. `min` mode only |
| `registry` | A separate image tag in a registry | Any CI, and shared teams. Supports `mode=max` | You pay for the storage and the transfer |
| `local` | A folder | A self-hosted runner, or with a CI cache action that saves the folder | The folder grows. Something must save and restore it |
| `gha` | The GitHub Actions cache service | Jobs on GitHub-hosted runners | It exists only on GitHub. Pull requests from forks and `pull_request_target` cannot write to it |

**min or max.** In `mode=min` BuildKit exports only the layers of the final image. In `mode=max` it exports every layer of every stage. A multi-stage Dockerfile that installs packages in a build stage and copies the result into a small final image keeps the slow install out of the final image. With `min`, that install is not in the cache, and a cold runner does it again. With `max`, it comes from the cache.

**Do not trust a cache by its name.** Check the build log for `CACHED` on the step you care about. A cache that is written under one reference and read from another is the commonest mistake, and it fails silently.

This part uses a **cold runner** that you can control: for every build, `run.mjs` creates a new BuildKit builder (a container), uses it once and removes it. The cache lives outside the builder, in a folder or in a `registry:3` container on a Docker network.

## Your job

1. `cache-flags.txt` has the flags for the `local` and `registry` backends. One has the wrong mode and the other reads from the wrong reference. Fix both (in this folder, not in `reference/`).
2. `workflow/build.yml` is the GitHub Actions workflow. The cache line writes on every event and uses the wrong mode. Make it write only on a push, with `mode=max`, so a pull request from a fork reads the cache and never writes it. Every action in the file is already pinned to a full commit SHA. Keep it that way.

**The GitHub run is your own.** This machine cannot run Actions, so the `gha` backend is not measured here. Copy `workflow/build.yml` to `.github/workflows/build.yml` in your own repository, push to a branch, push again, and compare the build step times in the two job logs. Expect the second run to show `CACHED` for the install step.

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-5-fast-builds/part-2-cache-backends/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-5-fast-builds/part-2-cache-backends/run.mjs` | Starts a registry, then runs five scenarios (no cache, local, registry, inline, and a runner that keeps its disk). Each cold scenario is three builds on fresh builders after one build that writes the cache. |
| 3 | Look at the `npm install` column of the summary. Which scenarios still run the install? | The starter shows `local` and `registry` still running it. |
| 4 | Fix `cache-flags.txt` and `workflow/build.yml`. Run step 2 again. | `local` and `registry` show `CACHED`. |
| 5 | `node toolkit/show-facts.mjs c5.p2` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-5-fast-builds/part-2-cache-backends/test.mjs` | The test passes. |
| 7 | Your own run on GitHub. | See the box above. |

## What you should see

The summary on the reference machine (the full recorded run is in [results.md](results.md)):

```text
none       whole build  22.3 s   base image  8.5 s   npm install  5.1 s
local      whole build  27.2 s   base image  0.1 s   npm install   CACHED
registry   whole build  18.5 s   base image  0.6 s   npm install   CACHED
inline     whole build  19.6 s   base image  0.1 s   npm install  5.8 s
warm disk  whole build   3.1 s   base image    0 s   npm install   CACHED
```

Read it with care.

- The **npm install** column is the part a cache can save, and it is clear: `local` and `registry` with `mode=max` bring it back, `inline` does not (it is `min` only), no cache does not.
- The **whole build** column is not clear. A cold build is mostly other things: the new builder pulls the base image (the `base image` column), exports its layers and uploads the cache. Here the `local` backend is the slowest, because importing a 117 MB folder costs more than running a 5 second install. The `registry` cache is a little faster than no cache. The install here takes only 5 seconds on a fast network, so a cache has little to win. On a slower install (compiled dependencies, a large dependency tree, a slow registry) it wins more. A cache is not free: measure the whole job before you keep it.
- The **warm disk** row is the upper bound: a runner that keeps its disk rebuilds in 3 seconds. Cache backends try to give a fresh runner that.

The chart shows the install step only, because that is the one number that does not depend on how the base image pull went.

![Time of the npm install step on a cold runner (median of 3)](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c5.p2.<b>_s` | Wall clock of `docker buildx build` after a one line code change, median of three builds on fresh builders. `<b>` is `none`, `local`, `registry`, `inline` or `warm` (the same builder, three rebuilds). |
| `c5.p2.<b>_install_s`, `c5.p2.<b>_install_cached` | The duration of the `npm ci` step in the last build, median of three, and whether it was `CACHED`. Read from the plain progress output. |
| `c5.p2.<b>_base_pull_s` | The duration of the `FROM` step (pulling `node:24-alpine` into the fresh builder). Median of three. |
| `c5.p2.<b>_steps_cached` | Steps marked `CACHED` in the last build. |
| `c5.p2.local_cache_mb`, `c5.p2.registry_cache_mb` | Size of the cache folder, and of the registry's storage after the registry and inline scenarios (`du -sk /var/lib/registry`). |
| `c5.p2.workflow_*` | Text checks on `workflow/build.yml`: every `uses:` line ends in a 40 character SHA, the cache is read with `type=gha`, written only when `github.event_name` says so, with `mode=max`, and `pull_request_target` is not used. |

## What is different on Docker Desktop

The default builder on Docker Desktop can export `type=local` and `type=registry` caches only with the containerd image store. This part avoids the question: it creates its own builder with the `docker-container` driver, which works on every Docker. That builder runs in a container on the same virtual machine as everything else. The builder reaches the registry by its container name on a Docker network, so no port is published and `localhost` is not involved. On Linux, the same commands work unchanged. The first run downloads the BuildKit image (112 MB). The script removes the builder at the end; remove the image with `docker rmi moby/buildkit:buildx-stable-1` if you do not need it.

## Stuck?

- `could not create a builder`: Docker must be able to pull `moby/buildkit:buildx-stable-1`. Check your network.
- `Docker Hub rate limit` while pulling `node:24-alpine`: each fresh builder pulls it again. Wait, or log in to Docker Hub.
- A run stopped half way: `docker buildx rm --force dkr-c5-builder` and `node toolkit/cleanup.mjs 5`.
- `local` is slower than no cache: that can be true. See "What you should see".

## Next

Part 3 (stretch): [one image name, two CPU architectures](../part-3-multi-platform/README.md).
