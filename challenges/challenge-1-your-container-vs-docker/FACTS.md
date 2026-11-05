# Facts of challenge 1

Every fact is saved by `run.mjs` through `toolkit/facts.js` into `facts.json`. Names are `c1.p<part>.<what>_<unit>`. Values below are from the reference run on Windows 11, Docker Desktop 29.9.2, Node 22.22.2, 2026-11-05. "Mini" is the container made by `mini/mini-container.sh` inside the host container `dkr-c1-host`. Timings are the median of three runs.

## Part 1: the same app in your container and in Docker

| Fact | Meaning | How it was measured |
|---|---|---|
| `c1.p1.image_mb` | Size on disk of `dkr-c1-daftar:1` (daftar-api and `probe.mjs` on `node:24-alpine`) | `docker image inspect` field `Size`, divided by 1e6 |
| `c1.p1.start_mini_s` | Seconds from `mini-container.sh run` until `GET /health` answers | Median of 3 |
| `c1.p1.start_docker_s` | Seconds from `docker run -d` until `GET /health` answers on the published port | Median of 3. Noisy on Desktop: 0.68 s to 1.96 s in different runs |
| `c1.p1.ns_new_mini` | Namespace types of mini that differ from the host container's PID 1 | `readlink /proc/self/ns/*` inside, compared with `/proc/1/ns/*` of the host |
| `c1.p1.ns_new_docker` | The same for the Docker container (compared with the host container, which is also a Docker container) | Same |
| `c1.p1.ns_new_mini_count`, `c1.p1.ns_new_docker_count` | How many types are in the two lists | Length of the list |
| `c1.p1.uid_mini`, `c1.p1.uid_docker` | User id of the app | `process.getuid()` |
| `c1.p1.caps_mini_count`, `c1.p1.caps_docker_count` | Capabilities in the bounding set | Bits set in `CapBnd` of `/proc/self/status`. Mini inherits the host container's set (14 default + SYS_ADMIN + NET_ADMIN = 16) |
| `c1.p1.mounts_mini`, `c1.p1.mounts_docker` | Mounts the process sees | Lines in `/proc/self/mountinfo` |
| `c1.p1.root_fstype_mini`, `c1.p1.root_fstype_docker` | File system type of the root | First mountinfo line |
| `c1.p1.memory_max_mini_bytes`, `c1.p1.memory_max_docker_bytes` | The memory limit seen inside | `/sys/fs/cgroup/memory.max` |
| `c1.p1.node_limit_seen_mini_mb`, `c1.p1.node_limit_seen_docker_mb` | The limit as node reads it | `process.constrainedMemory()` / 1 MiB. 0 means node found no limit |
| `c1.p1.proc_sys_writable_mini`, `c1.p1.proc_sys_writable_docker` | Whether `/proc/sys/kernel/hostname` is writable | `fs.accessSync(..., W_OK)` |
| `c1.p1.nameservers_mini`, `c1.p1.nameservers_docker` | DNS servers in `/etc/resolv.conf` | Count of `nameserver` lines |
| `c1.p1.pid1_both_node` | PID 1 is `node server.mjs` in both | `/proc/1/cmdline` |
| `c1.p1.vm_cpus`, `c1.p1.vm_ram_mb` | CPUs and memory a container sees (the machine Docker runs on) | `os.availableParallelism()`, `os.totalmem()` inside the Docker container |
| `c1.p1.answers_match` | Whether the learner's `answers.json` matched the measurement | Comparison in `run.mjs` |
| `c1.p1.leftover_count` | Objects with the label after cleanup | `leftovers(1)` |

## Part 2: join two containers

| Fact | Meaning | How it was measured |
|---|---|---|
| `c1.p2.join_pid`, `c1.p2.join_network`, `c1.p2.join_ipc` | The learner's switches at the time of the run | `join.json` |
| `c1.p2.docker_reaches_app`, `c1.p2.mini_reaches_app` | The sidecar with the learner's switches opened `127.0.0.1:8080` | busybox `wget` in the sidecar |
| `c1.p2.docker_sees_node`, `c1.p2.mini_sees_node` | The sidecar's `ps` lists `node server.mjs` | `ps \| grep -c '[n]ode server.mjs'` |
| `c1.p2.docker_shares_ipc`, `c1.p2.mini_shares_ipc` | The sidecar's IPC namespace is the app's | `readlink /proc/self/ns/ipc` equality |
| `c1.p2.none_reaches_app` | With nothing joined, the sidecar reached the app (either world) | Fixed row of the table |
| `c1.p2.net_only_reaches_app` | With only the network joined, the sidecar reached the app (both worlds) | Fixed row |
| `c1.p2.pid_only_sees_node` | With only the pid namespace joined, `ps` shows node (both worlds) | Fixed row |
| `c1.p2.shm_file_seen_with_ipc_join` | A file in the app's `/dev/shm` was readable after joining IPC | `cat /dev/shm/token` in an `--ipc container:` sidecar (Docker) |
| `c1.p2.private_ipc_join_refused` | Joining the IPC namespace of a container started without `--ipc shareable` failed | Exit code of `docker run --ipc container:<private>` was not 0 |
| `c1.p2.leftover_count` | Objects with the label after cleanup | `leftovers(1)` |

## Part 3: limits and the gap

| Fact | Meaning | How it was measured |
|---|---|---|
| `c1.p3.limit_mb` | The limit used in steps 1 to 3 | Constant, 128 |
| `c1.p3.memory_max_mini_bytes`, `c1.p3.memory_max_docker_bytes` | `memory.max` inside each | `cat /sys/fs/cgroup/memory.max` |
| `c1.p3.docker_current_mib`, `c1.p3.mini_current_mib` | `memory.current` after holding 40 MB and writing a 30 MB file | cgroup file, in MiB |
| `c1.p3.docker_inactive_file_mib`, `c1.p3.mini_inactive_file_mib` | `inactive_file` from `memory.stat` | cgroup file, in MiB |
| `c1.p3.docker_working_set_mib` | `memory.current` minus `inactive_file` | Computed |
| `c1.p3.docker_stats_mib` | The number `docker stats` prints | `docker stats --no-stream --format "{{.MemUsage}}"`, first number |
| `c1.p3.stats_is_working_set` | The two numbers above are within 2 MiB | Computed |
| `c1.p3.docker_oom_killed`, `c1.p3.docker_exit_code` | State after asking for 200 MB from 128 MB | `docker inspect` |
| `c1.p3.mini_oom_kill_events` | `oom_kill` counter of mini's cgroup after the same request | `memory.events` |
| `c1.p3.mini_alive_after_oom` | Mini's PID 1 still exists | `test -d /proc/<pid>` in the host |
| `c1.p3.windows_ram_mb`, `c1.p3.windows_cpus` | Memory and CPUs of the computer running the script | `os.totalmem()`, `os.cpus()` |
| `c1.p3.vm_ram_mb`, `c1.p3.vm_cpus` | Memory and CPUs of the machine Docker runs on | `docker info` `MemTotal`, `NCPU` |
| `c1.p3.container_sees_ram_mb`, `c1.p3.container_sees_cpus` | What a container with a 128 MB limit reports | `os.totalmem()`, `os.availableParallelism()` inside |
| `c1.p3.gap_vm_mb` | Memory of the host container (stand-in for the VM) | Constant, 256 |
| `c1.p3.gap_container_limit_mb` | Learner's `limit.json` | File |
| `c1.p3.gap_held_mb` | MB the app held when it was killed | `held_mb` of the last successful `/alloc` |
| `c1.p3.gap_inner_max_events` | Times the container hit its own `memory.max` | `max` in the container's `memory.events` |
| `c1.p3.gap_outer_oom_events` | Times the host container ran out of memory | `oom` in the host's `memory.events.local` |
| `c1.p3.gap_killed_by_own_limit` | `gap_outer_oom_events` is 0 | Computed |
| `c1.p3.leftover_count` | Objects with the label after cleanup | `leftovers(1)` |
