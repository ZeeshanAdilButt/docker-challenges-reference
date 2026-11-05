# Challenge 5, part 3 (stretch): one image name, two CPU architectures

**Time:** about 30 minutes. **Download:** none for the checks in this part. The arm64 build in the "Learner only" box downloads the arm64 layers of `node:24-alpine` (about 60 MB) and is not run by the test. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

You build on a Windows or Intel laptop. Your colleague has an Apple silicon laptop. Your production moves to arm64 servers because they cost less. You push `daftar-api:1.4`. On the arm64 machine it fails with `exec format error`, or it runs through slow emulation. The image was built for one CPU architecture, and the machine has another.

## The idea

A **multi-platform image** is one tag that points to an **index**. The index lists one manifest per platform (`linux/amd64`, `linux/arm64`, and others). When a machine pulls the tag, Docker picks the manifest that matches its own CPU. You do not need two tags.

There are three ways to build the non-native half:

| Way | How it works | Cost |
|---|---|---|
| Emulation (QEMU) | An amd64 machine runs arm64 programs by translating each instruction | Works everywhere. Slow, often several times slower than native |
| A native runner | You build arm64 on an arm64 machine and amd64 on an amd64 machine, then join the results | Fast. Needs two kinds of runners |
| Cross-compiling | The compiler on the amd64 machine produces arm64 code (Go and Rust do this well) | Fast. Only for languages that support it |

A **bake file** (`docker-bake.hcl`) describes builds as data: targets, platforms, tags. The same file works on your laptop and in CI, and reviewers can read it.

## Your job

`docker-bake.hcl` builds for amd64 only. `workflow/multiplatform.yml` has no QEMU step. Edit both in this folder (not the files in `reference/`).

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-5-fast-builds/part-3-multi-platform/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-5-fast-builds/part-3-multi-platform/run.mjs` | Prints the platforms in your bake file (`docker buildx bake --print`), checks the workflow, and shows how many platforms your builder and the official Node image support. Builds nothing. About 10 seconds. |
| 3 | Edit `docker-bake.hcl`: set `platforms = ["linux/amd64", "linux/arm64"]` on target `app`. Add a target `app-local` that inherits from `app`, sets `platforms = []` and `output = ["type=docker"]`. | `bake --print` shows both platforms. |
| 4 | Edit `workflow/multiplatform.yml`: add `docker/setup-qemu-action` before `setup-buildx-action`. Pin it to a full commit SHA: `gh api repos/docker/setup-qemu-action/commits/v4.4.0 -q .sha`. Set `platforms: linux/amd64,linux/arm64` on the build step. | The workflow can build for both platforms. |
| 5 | `node challenges/challenge-5-fast-builds/part-3-multi-platform/run.mjs` | Every check is green. |
| 6 | `node toolkit/show-facts.mjs c5.p3` | Shows the saved numbers. |
| 7 | `node --test challenges/challenge-5-fast-builds/part-3-multi-platform/test.mjs` | The test passes. |

### Learner only, not recorded here

The reference run does **not** build for arm64. An emulated arm64 build is slow, needs QEMU support in your Docker, and downloads another set of layers. The test does not run it either. If you want to see it on your own machine:

```text
mkdir build-ctx
cp challenges/challenge-5-fast-builds/app/package.json challenges/challenge-5-fast-builds/app/package-lock.json daftar-api/server.mjs build-ctx/
cp challenges/challenge-5-fast-builds/part-2-cache-backends/Dockerfile build-ctx/
docker buildx build --platform linux/amd64,linux/arm64 -t daftar-api:multi --output type=cacheonly build-ctx
```

Time it, then time the same build with `--platform linux/amd64` alone. The arm64 half runs under emulation, so it takes noticeably longer on an amd64 machine. Write both times in your notes. (A multi-platform image cannot be loaded into the classic Docker image store. With the containerd image store you can use `--load`; otherwise push to a registry, as in challenge 6.) The GitHub Actions workflow is also your own run: this part cannot run Actions for you. Expect the arm64 half of the build to be the slowest step in the job log.

## What you should see

Step 2 on the reference machine:

```text
platforms: linux/amd64, linux/arm64
target app-local: one platform, output type=docker
QEMU is set up, and the build asks for arm64.
this builder can build for 9 platforms
node:24-alpine ships for 3: linux/amd64, linux/arm64/v8, linux/s390x
```

The last two lines teach the idea. Your Docker can build for nine platforms because it has emulators registered. The official Node image ships for three, and the registry hands each machine the right one from the same tag. The full recorded run is in [results.md](results.md).

![Platforms: your bake file, this builder, the official Node image](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c5.p3.bake_platforms`, `bake_has_amd64`, `bake_has_arm64` | `docker buildx bake --print -f docker-bake.hcl app`, field `platforms` of target `app`. |
| `c5.p3.bake_local_target` | `docker buildx bake --print ... app-local` succeeds. |
| `c5.p3.workflow_actions`, `workflow_unpinned` | Every `uses:` line of the workflow, and how many of them do not end in a 40 character SHA. |
| `c5.p3.workflow_has_qemu`, `workflow_platforms_arm64` | The workflow uses `docker/setup-qemu-action` and asks for `linux/arm64`. |
| `c5.p3.builder_platforms` | The `Platforms:` line of `docker buildx inspect`, counted. |
| `c5.p3.node_alpine_platforms` | `docker buildx imagetools inspect --raw node:24-alpine`: Linux manifests in the index that are real platforms (not attestations). Needs the network. |

## What is different on Docker Desktop

Docker Desktop registers the QEMU emulators for you, so `--platform linux/arm64` works without setup, and the platform list is long. On Docker Engine on plain Linux you may have to install the emulators once (`docker run --privileged --rm tonistiigi/binfmt --install all`). That command needs `--privileged`, so this challenge does not run it for you. In GitHub Actions, the `setup-qemu-action` step does the same job on the runner.

## Stuck?

- `failed to find target app-local`: the bake file has no such target yet.
- `docker buildx bake` cannot read the file: look at the line number in the error. HCL needs `=` between a name and its value.
- `node:24-alpine ships for 0`: the check needs the network. Run it again when you are online.

## Next

Challenge 6, [your own registry](../../challenge-6-registry-and-tags/part-1-run-a-registry/README.md).
