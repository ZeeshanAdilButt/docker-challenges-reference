# Challenge 4 notes (maintainers)

## What each part proves

1. **Five bases.** The same 150 lines of code give images from 109 MB to 1.6 GB unpacked (30 MB to 410 MB packed). Idle memory and start time do not depend on the base. What changes: package count, shell, C library. Alpine cannot run a glibc program; distroless has no shell.
2. **Non-root, read-only.** Root with no flags can write 6 of 6 probe paths and holds 14 capabilities. A numeric user, `--read-only` and `--cap-drop ALL` leave 2 writable paths and 0 capabilities. A new named volume copies the owner from the image folder.
3. **Reproducible build.** Two builds of the same source differ in the COPY layer (file times), in a `RUN date` layer and in the image config (created time). Pinned base, no date, `SOURCE_DATE_EPOCH` and `rewrite-timestamp=true` give an identical digest even after the source files are touched. A moved base tag changes the build of `FROM tag`, not of `FROM digest`.

## How starter and reference are checked

Every `run.mjs` accepts `--reference` (or `DKR_USE_REFERENCE=1`) and then uses the file in `reference/` instead of the learner's file. Tests read facts. To check by hand: run the starter with `DKR_FACTS_PATH` pointing to a scratch file, run the test with the same variable (fails), then run `run.mjs --reference` on the real facts and run the test (passes).

Test counts on the reference machine (tests failing on the starter / tests total): part 1 2 of 12 (3 before `results.md` existed), part 2 8 of 13, part 3 3 of 8. All pass on the reference.

## Deviations and problems

- **Five bases.** The roadmap lists Debian, slim, Alpine, distroless and hardened. Docker Hardened Images answered `401 Unauthorized` for an anonymous pull (`docker pull dhi.io/node:24-alpine3.23` and `docker buildx imagetools inspect dhi.io/node:24`), so they are not a required base. The fifth base is `alpine:3.23` plus Alpine's `nodejs` package, a common choice and a useful contrast with `node:24-alpine` (Alpine's package has no npm). `run.mjs` repeats the anonymous check and records the answer in `c4.p1.dhi_anonymous_ok`.
- **Images already on the machine.** `python:3.12-slim` and `ubuntu:24.04` were not used as app bases because the app is Node. `ubuntu:24.04` supplies the glibc `uname` for the compatibility test. New pulls: `node:24-slim` (81 MB packed) and the distroless Node image (55 MB packed, pinned by digest).
- **Distroless tag.** The distroless image has no version tags, only `latest`, so the Dockerfile pins the index digest. When it goes stale, update it on purpose.
- **Packed size.** Taken from the OCI export (layers plus config). It matches the dossier for `node:24-alpine` (62.5 MB), `node:24-slim` (81 MB) and `node:24` (410 MB).
- **Start time is noisy.** Across runs it ranged from 0.7 s to 1.8 s with no pattern by base. The README tells the learner not to choose a base by start time.
- **Docker's default for low ports.** The dossier and the roadmap suggest "ports below 1024" fail for non-root. On this Docker, a non-root user can bind port 80 by default (the kernel setting `net.ipv4.ip_unprivileged_port_start` is 0 in new containers). With the setting at 1024 it fails with `EACCES`. The part measures both and teaches "listen above 1024 anyway".
- **GNU tar and Windows paths.** `tar -xOf C:\...` treats `C:` as a host. `lib.mjs` extracts with a relative name and `cwd`.
- **Disk.** Unpacking `node:24` (1.65 GB) the first time it is a build base takes about 40 seconds and grows Docker's disk file. The OCI export of `node:24` writes a 410 MB temporary tar (put `TMP` on another drive if C: is tight). `run.mjs` removes every image it builds (`dkr-c4-*`) at the end; the bases stay.

## What the Docker Desktop learner sees differently

- Part 1: the first build of `node:24` is slow while Docker unpacks it. Sizes depend on the image store (containerd versus classic). The packed size does not.
- Part 2: nothing differs; bind mounts would (the host decides the owner), which is why the part uses a named volume.
- Part 3: needs the containerd image store for `--output type=oci` on the default builder. With the classic store, a `docker-container` builder (about 110 MB) is needed.

## Not done

- Image vulnerability counts per base. A scanner is challenge 12's tool, and pulling one here costs 63 MB. Chapters should quote package counts, not CVE counts.
- A distroless `:debug` or `docker debug` walk-through. The README only says there is no shell.
- A live "month apart" rebuild. Part 3 uses a local moving tag instead, because it is repeatable and needs no network.
