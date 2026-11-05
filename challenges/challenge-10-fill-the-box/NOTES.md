# Notes for challenge 10: fill the box

## What each part proves

1. **Hit the limits.** A memory limit kills (exit 137, `OOMKilled`), a process limit makes `fork` fail (`EAGAIN`), a file limit makes `open` fail (`EMFILE`), and a CPU limit only slows the process. A Node heap cap stops a JavaScript leak before the kernel does, but not a Buffer leak. The learner sets three numbers (`heap_mb`, `pids`, `nofile`) so every runaway job is stopped and the real job still works. The test runs the jobs live and fails on the starter in three places.
2. **Logs and disk growth.** An unrotated `json-file` log keeps every line (14.9 MiB for 11.2 MiB printed). Rotation bounds the disk and loses the oldest lines. A tmpfs is bounded but lives in memory. The writable layer is not bounded. The learner sets log rotation and a tmpfs size.
3. **Audit the host.** The learner writes `parseSize` and `auditContainer` that read `docker inspect` JSON and flag missing limits, unrotated logs and risky restart policies. Tested on saved real inspect JSON, on small made-up objects (privileged, Docker socket) and on containers Docker makes today.

Tests: part 1 has 3 failing and 4 passing on the starter, 7 passing on the reference. Part 2 has 3 failing and 5 passing on the starter, 8 passing on the reference. Part 3 has 10 failing and 3 passing on the starter, 13 passing on the reference. The tests that pass on the starter are structure checks (the file parses, the README links the rules, nothing is left in Docker).

## Differences from the dossier (measured here, trust the measurement)

- **Default `nofile`:** 1,048,576 on Docker Desktop with Engine 29.9.2 (the dossier's own measure was the same). The release notes imply 1024. The part measures it with `ulimit -n` and never states it as a rule.
- **Default log driver:** `local`, not `json-file`. The dossier says json-file with no rotation. On this daemon the default already rotates (the `local` driver). The part therefore sets `--log-driver json-file` explicitly for the "no rotation" case and prints the daemon default as a measured fact (`c10.p2.default_log_driver`). The README tells the learner to check their own.
- **V8 heap abort exit code:** 139, not 134. Node 24 on Alpine ends a "JavaScript heap out of memory" run with exit 139. The tests look for the message and `OOMKilled: false`, not for a number.
- **Node heap limit is not cgroup aware here:** `v8.getHeapStatistics().heap_size_limit` is 259 MB inside a 64 MB container, so a plain Node leak is killed by the kernel after about 43 MB of data (the process alone needs about 46 MB of resident memory).
- **Threads count against `--pids-limit`.** Node itself uses about seven. A limit of 50 left room for 43 helper processes.

## Problems met

- A heap cap does not stop a Buffer leak. This is kept in the part on purpose.
- A tmpfs counts against the memory cap. A 64 MB tmpfs in a 64 MB container ends with an OOM kill of the writer even when the shell survives (`OOMKilled` is true while the container exit code is 0).
- Reading a container's log file size on Docker Desktop needs a path inside the virtual machine. A read-only bind mount of `/var/lib/docker/containers/<id>` into a throwaway alpine container works on Desktop and on Linux. It does not work for rootless Docker. The part says so and falls back to zero bytes with a clear message.
- Part 3's containers are made with `docker create` and never started, so containers without caps never run. Their `docker inspect` JSON is the same as for a running container for every field the audit reads.
- Windows: the helper script goes to `node -` on standard input, so nothing is mounted from the learner's disk.

## Docker Desktop learner

- Limits are enforced inside Docker Desktop's Linux virtual machine. The point where a container is killed shifts by a few MB.
- Log files and the writable layer live in the virtual machine's disk. Free space on the computer is a different number.
- `--live` in part 3 audits every container on the Docker, including Desktop's own and the learner's other projects. It only reads.

## Not done

- **Blocking versus non-blocking log delivery** (`--log-opt mode=non-blocking`) is not measured. It needs a slow log driver, and none runs offline without extra images. Chapter 11.4 should quote the Docker documentation for it and not a recorded run.
- **Host-level OOM** (kernel kills the Docker daemon) is not shown. It cannot be done safely on a shared machine. Only container-level kills are shown.
- Cleanup of images: the part builds no images. Only `node:24-alpine` and `alpine:3.23` are used.
