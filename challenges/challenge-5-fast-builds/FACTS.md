# Challenge 5 facts

Every number a chapter may quote, with its meaning and how it was measured. Values are in `facts.json` (reference repository). Timings are the median of three runs unless a fact says otherwise. The measuring machine: Windows 11, Docker Desktop, Docker Engine 29.9.2, Buildx 0.38.1, containerd image store, Node 22.22.2. The test app is `daftar-api` with a realistic dependency list (7 direct, 275 packages in the lock file) in `challenges/challenge-5-fast-builds/app/`.

## Part 1: order, ignore rules and cache mounts

| Fact | Meaning | How it was measured |
|---|---|---|
| `c5.p1.context_mb` | Build folder sent to the builder in the first build | `transferring context:` line of `docker build --progress=plain`. The folder holds 46 MB of clutter (`.git`, `node_modules`, `logs`, `coverage`) that `.dockerignore` should keep out |
| `c5.p1.image_unpacked_mb` | Unpacked image size: bytes of all files in all layers | `docker save`, then every layer is read (challenge 2 `lib/image.mjs`) |
| `c5.p1.image_docker_size_mb` | The `Size` field of `docker image inspect` | on the containerd image store it is not a size of the files; kept only so you can see the difference |
| `c5.p1.clutter_in_image` | Of `/app/.git`, `/app/logs`, `/app/coverage`, how many are inside the image | `ls -d` inside the image |
| `c5.p1.npm_cache_in_image_mb` | npm download cache stored in the image | `du -sk /root/.npm` inside the image (0 with a cache mount) |
| `c5.p1.code_change_s` | Rebuild time after a one line change in `server.mjs` | wall clock of `docker build`, median of 3 |
| `c5.p1.code_change_steps_cached`, `c5.p1.code_change_steps_total` | Numbered Dockerfile steps that were CACHED in the last code-change build, and the total | parsed from the plain progress output |
| `c5.p1.install_reran_on_code_change` | The `npm ci` step ran again after the code change | the step is not CACHED |
| `c5.p1.deps_change_s` | Rebuild time after a dependency version bump, with the learner's Dockerfile | wall clock, median of 3 (three different bumps) |
| `c5.p1.deps_change_nomount_s` | The same bumps with every `--mount=` option removed from the Dockerfile | wall clock, median of 3, taking turns with the line above |
| `c5.p1.mount_saving_s` | The difference of the two lines above | derived. It depends on the network: it was 2 to 10 s in three recorded runs |
| `c5.p1.mount_used` | The Dockerfile has `RUN --mount=type=cache` | read from the file |
| `c5.p1.copy_all_before_install` | A `COPY . .` comes before the install step | read from the file |

## Part 2: cache backends on a cold runner

A cold runner is a new BuildKit builder container (`docker buildx create --driver docker-container`) for every build: no layers, no cache, base image pulled again. The cache lives in a folder (`local`) or in a `registry:3` container. `<b>` is `none`, `local`, `registry`, `inline` or `warm`.

| Fact | Meaning | How it was measured |
|---|---|---|
| `c5.p2.<b>_s` | Time of the build after a one line code change | wall clock of `docker buildx build`, median of 3 fresh builders. `warm` reuses one builder (a runner that keeps its disk) |
| `c5.p2.<b>_install_cached` | The `npm ci` step in the `deps` stage was CACHED in the last build | parsed from the plain progress output |
| `c5.p2.<b>_steps_cached` | Steps CACHED in the last build | same |
| `c5.p2.steps_total` | Numbered steps in the two stage Dockerfile | same |
| `c5.p2.local_cache_mb` | Size of the local cache folder | sum of file sizes |
| `c5.p2.registry_cache_mb` | Size of what the registry holds after the registry backend runs | `du -sk /var/lib/registry`. It also holds the inline image |
| `c5.p2.workflow_actions`, `c5.p2.workflow_unpinned` | `uses:` lines in the workflow, and how many do not end in a 40 character SHA | read from the file |
| `c5.p2.workflow_cache_from_gha`, `c5.p2.workflow_cache_to_guarded`, `c5.p2.workflow_cache_to_max` | The workflow reads `type=gha`; writes the cache only on a push (`github.event_name`); uses `mode=max` | read from the file |
| `c5.p2.workflow_uses_pull_request_target` | The workflow uses `pull_request_target` | read from the file |

The `type=gha` backend only exists on GitHub. No `gha` timing is recorded; the workflow is the learner's own run.

## Part 3 (stretch): multi-platform, checks only

The arm64 build is learner-only and not recorded. These facts come from `docker buildx bake --print`, the workflow file and the registry.

| Fact | Meaning | How it was measured |
|---|---|---|
| `c5.p3.bake_platforms`, `c5.p3.bake_has_amd64`, `c5.p3.bake_has_arm64` | Platforms of target `app` in the bake file | `docker buildx bake --print` |
| `c5.p3.bake_local_target` | Target `app-local` exists | `docker buildx bake --print ... app-local` exits 0 |
| `c5.p3.workflow_actions`, `c5.p3.workflow_unpinned`, `c5.p3.workflow_has_qemu`, `c5.p3.workflow_platforms_arm64` | The multi-platform workflow: pinned actions, QEMU step, arm64 in `platforms:` | read from the file |
| `c5.p3.builder_platforms` | Platforms the default builder lists | `Platforms:` line of `docker buildx inspect`, counted |
| `c5.p3.node_alpine_platforms` | Real Linux platforms in the index of `node:24-alpine` | `docker buildx imagetools inspect --raw node:24-alpine` |
