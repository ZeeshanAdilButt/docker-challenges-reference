# Challenge 4 facts

Every number a chapter may quote, with its meaning and how it was measured. Values are in `facts.json` (reference repository). Timings are the median of three runs. The measuring machine: Windows 11, Docker Desktop, Docker Engine 29.9.2, containerd image store, Node 22.22.2.

## Part 1: five bases

`<key>` is one of `full` (node:24), `slim` (node:24-slim), `alpine` (node:24-alpine), `alpine_os` (alpine:3.23 plus the `nodejs` package), `distroless` (gcr.io/distroless/nodejs24-debian13).

| Fact | Meaning | How it was measured |
|---|---|---|
| `c4.p1.<key>_built` | The Dockerfile built | exit code of `docker build` |
| `c4.p1.<key>_unpacked_mb` | Unpacked size in MB: bytes of all files in all layers | each layer of the OCI export is unzipped and its regular files are added up |
| `c4.p1.<key>_docker_size_mb` | The `Size` field of `docker image inspect`, in MB | `docker image inspect --format {{.Size}}` / 1,000,000. With the containerd image store it is about unpacked plus packed plus file system overhead, so do not quote it as a size |
| `c4.p1.<key>_packed_mb` | Packed size in MB (what a registry stores and a pull downloads) | layers plus config of the image exported with `docker buildx build --output type=oci` |
| `c4.p1.<key>_packages` | Operating system packages in the image | `Package:` lines in `/var/lib/dpkg/status`, files in `/var/lib/dpkg/status.d`, or `P:` lines in `/lib/apk/db/installed`, counted by the image's own node |
| `c4.p1.<key>_node_major` | Node major version in the image | `process.version` inside the image |
| `c4.p1.<key>_has_shell` | `sh` can be started | `docker run --entrypoint sh <image> -c true` exits 0 |
| `c4.p1.<key>_glibc_ok` | A program built for glibc (`uname` from ubuntu:24.04) starts | copied into a stopped container with `docker cp`, then `docker start -a` |
| `c4.p1.<key>_health_ok` | The container answered `GET /health` with 200 three times | `fetch` from the host on the published port |
| `c4.p1.<key>_start_ms` | Time from `docker run -d` to the first 200 on `/health` | median of three starts, host clock |
| `c4.p1.<key>_idle_mem_mb` | Memory the container uses when idle | `docker stats --no-stream`, after the third start |
| `c4.p1.alpine_os_apk_cache_kb` | Package index left in `/var/cache/apk` | sum of file sizes, KB, counted inside the image |
| `c4.p1.dhi_anonymous_ok` | Docker Hardened Images readable without login | `docker buildx imagetools inspect dhi.io/node:24` exit code (it was 401, so false) |

## Part 2: non-root with a read-only root

| Fact | Meaning | How it was measured |
|---|---|---|
| `c4.p2.writable_paths_baseline` | Of 6 probe paths, how many a root process can write (no flags) | `probe.mjs` creates and deletes a file in `/app`, `/app/data`, `/tmp`, `/etc`, `/usr/local/bin`, `/` |
| `c4.p2.writable_paths_yours` | The same, with the learner's user and flags | same probe |
| `c4.p2.caps_baseline`, `c4.p2.caps_yours` | Linux capabilities held by the probe process | bits set in `CapEff` of `/proc/self/status` |
| `c4.p2.service_uid` | User id of the real service (PID 1) | `docker exec ... grep Uid /proc/1/status` |
| `c4.p2.readonly_root` | The service runs with a read-only root | `docker inspect --format {{.HostConfig.ReadonlyRootfs}}` |
| `c4.p2.health_ok` | The service answers `/health` with the learner's flags | `fetch` from the host |
| `c4.p2.image_user_numeric` | `USER` in the image is a number other than 0 | `Config.User` from `docker image inspect` |
| `c4.p2.port_num` | The port in `ENV PORT` | `Config.Env` |
| `c4.p2.data_writable`, `c4.p2.etc_writable`, `c4.p2.code_writable` | Whether `/app/data`, `/etc`, `/app` are writable with the learner's setup | `probe.mjs` |
| `c4.p2.low_port_default_ok` | A non-root user (10001) can open port 80 with Docker's defaults | `probe.mjs`, `--user 10001:10001` (true on this machine) |
| `c4.p2.low_port_sysctl1024_ok` | The same with `--sysctl net.ipv4.ip_unprivileged_port_start=1024` | `probe.mjs` (false: EACCES) |

## Part 3: reproducible build

| Fact | Meaning | How it was measured |
|---|---|---|
| `c4.p3.digest_equal` | Two `--no-cache` builds of the same source (files touched between) have the same image digest | `index.json` of each OCI export |
| `c4.p3.config_equal` | The image config blob is the same | config digest from the manifest |
| `c4.p3.layers_total`, `c4.p3.layers_differ` | Layers in the image, and how many differ by position between the two builds | layer digests from the manifest |
| `c4.p3.base_pinned` | First `FROM` has `@sha256:` and 64 hex characters | read from the Dockerfile |
| `c4.p3.tag_drift_changed` | Building `FROM <local tag>` before and after the tag is moved gives different digests | `Dockerfile.drift`, fixed flags |
| `c4.p3.pin_drift_changed` | Building `FROM <digest>` before and after gives different digests | same (false) |
| `c4.p3.reproducible` | `digest_equal` and `base_pinned` | derived |
