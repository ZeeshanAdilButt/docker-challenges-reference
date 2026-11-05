# Notes for challenge 1: your container next to Docker's

Builder notes. Not for learners.

## What each part proves

1. **Same app two ways.** The same daftar-api image, run by `mini-container.sh` and by `docker run`, and probed from the inside. Proves: Docker adds a cgroup namespace (and a time namespace on this runtime), applies the image's `USER`, mounts a read-only `/proc/sys`, writes `resolv.conf`, builds an overlay root, and that without the cgroup namespace node cannot find its own limit (`constrainedMemory()` is 0).
2. **Join namespaces.** `--pid`, `--network` and `--ipc container:<name>` each change exactly one slice, and match `nsenter` flags. Proves the shared `/dev/shm` effect and the "shareable" rule for IPC.
3. **Limits and the gap.** The same `memory.max` two ways, `docker stats` equals memory.current minus inactive_file, the OOM kill leaves exit 137 in Docker and `oom_kill` in `memory.events`, a container does not see its limit, and a limit above the machine's memory means the machine kills the app (shown safely in a 256 MB host container, with counters).

## Design decisions and why

- **The Linux host is a container.** The learner's machine may be Windows. `dkr-c1-host` (ubuntu:24.04) plays the Linux host of the Linux course. `mini/mini-container.sh` is a stand-in for the learner's own script from Linux module 14, which does not exist yet. Its interface (`run`, `exec`, `sidecar`, `stop`) is ours. If the Linux course's script has another interface, the lib needs a small adapter.
- **The host needs `--cap-add SYS_ADMIN --cap-add NET_ADMIN` and a seccomp profile.** Docker's default seccomp profile blocks `pivot_root` even with SYS_ADMIN. `mini/seccomp-pivot-root.json` is the default profile from `moby/profiles` (Apache-2.0, fetched 2026-11-05) with `pivot_root` added to the CAP_SYS_ADMIN block. This is not `--privileged`, there is no Docker socket, and the container is capped (256 MB, 200 processes). The brief says "no `--privileged` and no Docker socket", so this fits the letter of the rules, but it is a deviation in spirit from `SAFETY.md` rule 5 ("No `--privileged`..."). The orchestrator should decide whether SAFETY.md needs one more line.
- **Root file system.** `docker export` of the same image, extracted into a labelled volume `dkr-c1-rootfs` (173 MB on disk). The veth pair is made with busybox `ip` taken from that root, because ubuntu has no `ip`.
- **Docker's `time` namespace.** Docker containers got a separate time namespace compared with the host container on this runtime (Docker Desktop 29.9.2). Mini inherits the host's. The answer file includes it, because it is measured.

## Problems hit

- Git Bash rewrites `/rootfs` arguments to `C:/Program Files/Git/rootfs`. Use `MSYS_NO_PATHCONV=1` in manual tests. Node scripts are not affected.
- `[ -x /rootfs/sbin/ip ]` is false, because the symlink points to an absolute path. The script checks `/rootfs/bin/busybox`.
- busybox `ip link add ... type veth peer name X` ignores the name and calls the peer `vethN`. The script finds it by the `@vh-<name>` suffix.
- The nested kernel counters: `memory.events` of the host cgroup includes events from cgroups inside it. Part 3 reads `memory.events.local` for the host to tell "the machine ran out" from "the container ran out".
- Part 3, first approach reported "killed by the machine" for a 192 MB limit because of the above. Fixed.
- Part 3: the 200 MB request through Docker Desktop's port proxy was lost once (container kept running). The script now repeats it up to three times and waits for the container to show as exited.
- Docker start time (`c1.p1.start_docker_s`) varied between 0.68 s and 1.96 s between runs, while C: was nearly full. Median of 3 is still noisy on this machine.

## What the Docker Desktop learner will see differently

- "The host" for `/proc`, `/sys` and `docker info` is Docker Desktop's Linux VM. `c1.p3.windows_ram_mb` (32456) differs from `c1.p3.vm_ram_mb` (15835). On Engine in Linux or WSL2 they are equal.
- Published ports use Desktop's proxy: use 127.0.0.1.
- Everything else (namespaces, cgroup files, `docker stats`) reads the same files as on Engine.

## Things not done

- The real Docker Desktop VM is never driven to its memory limit, because other work shares it. The gap is shown with a 256 MB host container instead. The README says so.
- No test of `mini-container.sh` on a real Linux host (only inside the host container).
- The capability and seccomp rows in part 1 are shaped by the host container (mini inherits both). The README says so. On a real Linux host mini would show a full capability set and Seccomp 0.
- Image pulls: `ubuntu:24.04` (about 29 MB packed) is extra to the roadmap's 66 MB figure. The challenge needs `node:24-alpine` (62.5 MB), `ubuntu:24.04` and `alpine:3.23` (3.9 MB), about 95 MB packed.
