# Challenge 4, part 1: five bases for one app

**Time:** about 45 minutes. **Download:** `node:24-slim` (81 MB packed), `gcr.io/distroless/nodejs24-debian13` (55 MB packed), plus `node:24` (410 MB packed), `node:24-alpine` (62 MB), `alpine:3.23` and `ubuntu:24.04` (both small) if you do not have them yet. About 650 MB in total. If disk is short, skip `node:24` and say so in your notes. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Your team ships one small Node service. The image is 1.6 GB. Someone says "use Alpine", someone else says "use distroless", and a third person says "Alpine broke our build once". Each of them is right about something. You need numbers, not opinions: how big is each choice, what is in it, and what do you lose?

## The idea

An image is your app plus a **base**: the operating system files under it. The base is most of the size. Bases differ in three ways.

| Difference | What it means |
|---|---|
| Size and packages | A full Debian image carries hundreds of packages you never call. Every package is size to pull and a place for a security finding. |
| C library | Debian and distroless use **glibc**. Alpine uses **musl**. A program built for glibc (many prebuilt native add-ons are) does not run on Alpine. |
| Tools | Most bases have a shell. Distroless has none. That is safer, and it also means `docker exec ... sh` does not work. |

Smaller is a rule of thumb, not a law. You choose by weighing size, compatibility, how you will debug, and how the base gets patched.

In this part you build the same service, `daftar-api`, on five bases, and measure each one.

| Key | Base | Dockerfile |
|---|---|---|
| `full` | `node:24` (Debian) | `Dockerfile.full` |
| `slim` | `node:24-slim` (Debian, fewer packages) | `Dockerfile.slim` |
| `alpine` | `node:24-alpine` (musl) | `Dockerfile.alpine` |
| `alpine_os` | `alpine:3.23` plus Alpine's own `nodejs` package | `Dockerfile.alpine-os` |
| `distroless` | `gcr.io/distroless/nodejs24-debian13`, pinned by digest | `Dockerfile.distroless` |

Docker Hardened Images are a sixth option. They need a Docker login, so this part only checks whether they can be pulled without one (see "Where each number comes from").

## Your job

Two of the five Dockerfiles have a fault. The test tells you which one. Fix the files in this folder (not the ones in `reference/`).

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/test.mjs` | The test fails on purpose. Read the messages. |
| 2 | `node challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/run.mjs` | Builds all five images, measures them, starts each one three times. About 3 minutes. Prints a table. |
| 3 | Open `Dockerfile.distroless` and `Dockerfile.alpine-os`. Fix the faults. | The run in step 2 prints `no answer` for one base and a number of KB for the other. Those are your two hints. |
| 4 | `node challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/run.mjs` | All five answer `/health`. The apk cache is `0 KB`. |
| 5 | `node toolkit/show-facts.mjs c4.p1` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/test.mjs` | The test passes. |
| 7 | Write three sentences in your notes: which base you would pick for `daftar-api`, which for a service with a prebuilt native add-on, and why. | Use your own numbers. |

Add `--record` to step 4 if you want your own `results.md` and `chart.svg`.

## What you should see

The table printed at the end of step 4 (reference machine, your numbers will differ a little):

```text
base                          unpacked  packed  packages  shell  glibc  start   idle mem
node:24 (Debian, full)        1630.5 MB 410 MB  413       yes    yes    1019 ms 16.2 MiB
node:24-slim (Debian, slim)   330.4 MB  81.1 MB 88        yes    yes    1411 ms 16.2 MiB
node:24-alpine (musl)         243.6 MB  62.5 MB 19        yes    no     1021 ms 17.1 MiB
alpine:3.23 + apk nodejs      108.6 MB  29.9 MB 30        yes    no     1094 ms 16.4 MiB
distroless nodejs24           214.8 MB  55.5 MB 14        no     yes    1767 ms 17.3 MiB
```

Read it like this:

- The same 150 lines of code give images from 109 MB to 1.6 GB.
- Idle memory is the same on every base. The base changes the disk and the pull, not the running process.
- Start time is about one second everywhere and changes from run to run. Do not pick a base for start time.
- `glibc: no` on both Alpine rows is the compatibility cost. A program built for Ubuntu (`uname` here) cannot start.
- `shell: no` on distroless is the debugging cost.
- `alpine:3.23 + apk nodejs` is the smallest, but it is Alpine's own Node build without `npm`. It is not the same thing as the official `node:24-alpine`.

The full recorded run is in [results.md](results.md).

![daftar-api image size on five bases](chart.svg)

## Where each number comes from

Facts are named `c4.p1.<key>_<what>`, for example `c4.p1.slim_size_mb`.

| Fact | Where it comes from |
|---|---|
| `*_size_mb` | `docker image inspect --format {{.Size}}`, divided by 1,000,000. This is the unpacked size, the one `docker images` shows. |
| `*_packed_mb` | The size of the layers and config in the image when exported with `docker buildx build --output type=oci`. This is what a registry stores and a pull downloads. |
| `*_packages` | Counted inside the image by its own `node`: `Package:` lines in `/var/lib/dpkg/status`, files in `/var/lib/dpkg/status.d` (distroless), or `P:` lines in `/lib/apk/db/installed` (Alpine). |
| `*_has_shell` | `docker run --entrypoint sh <image> -c true` exits with 0. |
| `*_glibc_ok` | The `uname` program from `ubuntu:24.04` is copied into a stopped container of the image and started. |
| `*_start_ms` | From `docker run -d` until `GET /health` answers 200. Median of three starts. |
| `*_idle_mem_mb` | `docker stats --no-stream`, memory in use after the third start. |
| `alpine_os_apk_cache_kb` | Size of the files in `/var/cache/apk` inside the image. |
| `dhi_anonymous_ok` | `docker buildx imagetools inspect dhi.io/node:24` without logging in. On the reference machine it answered `401 Unauthorized`, so `false`. |

## What is different on Docker Desktop

Docker Desktop on Windows or Mac keeps its images in a disk file inside its virtual machine, so the first build of `node:24` may take a minute while Docker unpacks 1.6 GB. The numbers above were recorded on Docker Desktop with the containerd image store (the default since Docker Engine 29). With the older classic image store, `docker image inspect` can report a slightly different unpacked size, and the packed size is the number that stays the same. On Linux, startup is usually faster than the numbers above, because there is no virtual machine between you and the container.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- A pull fails for `gcr.io`: check your network, then run the step again. The image is pinned by digest, so you get the same bytes every time.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 4`. It removes only containers labelled `dkr.challenge=4`. The images this part builds are named `dkr-c4-p1-*`; remove one by its full name with `docker rmi dkr-c4-p1-full:test`.

## Next

Part 2: [run as non-root with a read-only root](../part-2-non-root-read-only/README.md).
