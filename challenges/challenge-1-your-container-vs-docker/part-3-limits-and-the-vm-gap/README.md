# Challenge 1, part 3: your cgroup, Docker's limit, and the machine under both

**Time:** about 45 minutes. **Download:** the same three images as parts 1 and 2 (`node:24-alpine`, `ubuntu:24.04`, `alpine:3.23`; about 95 MB packed in total). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A container is killed with exit code 137. The memory graph says it used 60 MB. The limit is 128 MB. Nobody can explain it. Or the alarm is set on the "memory" number from `docker stats`, and it is never wrong and never useful.

Two things hide here. First: there are several memory numbers, and they are not the same. Second: the limit you set is only a promise to the kernel. If the machine under the container has less memory than the limit, the machine's wall comes first.

## The idea

You wrote `memory.max` by hand in your Linux course. `docker run --memory 128m` writes the same file. This part reads that file, and the files next to it, in both containers.

- **`memory.current`** is everything charged to the cgroup: the app's own memory and also page cache, the memory the kernel uses to remember file contents.
- **The working set** is `memory.current` minus `inactive_file`, the cache the kernel can drop at once. `docker stats` shows this number, not `memory.current`. It is the one to alarm on.
- **At the limit** the kernel's OOM killer picks a process in the cgroup. The counter `oom_kill` in `memory.events` goes up. Docker adds a friendlier ending: exit code 137 and `OOMKilled: true`.
- **A container does not see its limit.** `os.totalmem()` and the CPU count show the machine Docker runs on. On Docker Desktop that is a virtual machine, and it is smaller than your computer.

The last step is the gap. The host container has 256 MB. It stands in for Docker Desktop's virtual machine. You give your container a limit in `limit.json`, and the app asks for memory 10 MB at a time until something kills it. The starter limit, 512 MB, is **above** the machine. Who dies, and which counter shows it?

Your task: change `container_limit_mb` in `limit.json` so the container reaches its **own** wall first.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-1-your-container-vs-docker/part-3-limits-and-the-vm-gap/test.mjs` | Fails on purpose: `limit.json` says 512, above the 256 MB machine. |
| 2 | Edit `limit.json` | One number: `container_limit_mb`. |
| 3 | `node challenges/challenge-1-your-container-vs-docker/part-3-limits-and-the-vm-gap/run.mjs` | Runs the five measurements below. About 60 seconds. |
| 4 | `node toolkit/show-facts.mjs c1.p3` | Shows the saved facts. |
| 5 | Read the last step of the output | It names who killed the app and shows the counters. |
| 6 | `node --test challenges/challenge-1-your-container-vs-docker/part-3-limits-and-the-vm-gap/test.mjs` | All tests pass. |

What step 3 does:

1. Starts daftar-api with a 128 MB limit in your container (`memory.max` written by the script) and in Docker (`--memory 128m`). Reads `memory.max` in both.
2. Holds 40 MB in the app, writes a 30 MB file so there is page cache, and reads `memory.current`, `anon`, `file` and `inactive_file` in both. Then asks `docker stats`.
3. Asks for 200 MB from the 128 MB limit, in both, and reads what each leaves behind: `docker inspect` and `memory.events`.
4. Prints your computer's memory, the memory Docker reports, and what a container sees.
5. Starts one more container in the host with **your** `limit.json`, allocates 10 MB at a time until it dies, and reads `memory.events` of the container and `memory.events.local` of the host.

## What you should see

The same limit reads `134217728` in both. The three memory numbers differ:

```text
                        your container   docker
memory.current (MiB)    85               90
  inactive_file (MiB)   26.6             30
current - inactive_file 58.4             60
docker stats says       -                57.98MiB / 128MiB
```

`docker stats` matches the line `current - inactive_file`, not `memory.current`. That is the working set.

At the limit, Docker says `exited 137 true` (exit code 137, OOMKilled). Your script has `oom_kill 1` in `memory.events` and a process that is gone.

On this computer the machine reports less memory than your computer has, and a container sees the machine's number, not its limit. In the last step, with a limit above 256 MB the container's `max` counter stays at 0 and the host's `oom` counter goes up: the machine killed the app far below its own limit. With 192 MB the container's `max` counter climbs, and the host stays quiet.

The full recorded run is in [results.md](results.md).

![Memory: what you set, what Docker shows](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c1.p3.memory_max_mini_bytes`, `c1.p3.memory_max_docker_bytes` | `/sys/fs/cgroup/memory.max` inside each container. |
| `c1.p3.docker_current_mib`, `c1.p3.mini_current_mib` | `memory.current`, in MiB. |
| `c1.p3.docker_inactive_file_mib`, `c1.p3.mini_inactive_file_mib` | `inactive_file` in `memory.stat`, in MiB. |
| `c1.p3.docker_working_set_mib` | `memory.current` minus `inactive_file`. |
| `c1.p3.docker_stats_mib` | `docker stats --no-stream --format "{{.MemUsage}}"`, first number. |
| `c1.p3.stats_is_working_set` | The two numbers above differ by 2 MiB or less. |
| `c1.p3.docker_oom_killed`, `c1.p3.docker_exit_code` | `docker inspect`, `.State.OOMKilled` and `.State.ExitCode`. |
| `c1.p3.mini_oom_kill_events` | `oom_kill` in your container's `memory.events`. |
| `c1.p3.windows_ram_mb`, `c1.p3.windows_cpus` | `os.totalmem()` and `os.cpus()` on your computer. On Linux this equals the next line. |
| `c1.p3.vm_ram_mb`, `c1.p3.vm_cpus` | `docker info`, `MemTotal` and `NCPU`. |
| `c1.p3.container_sees_ram_mb`, `c1.p3.container_sees_cpus` | `os.totalmem()` and `os.availableParallelism()` inside a container with a 128 MB limit. |
| `c1.p3.gap_vm_mb` | The memory of the host container, 256 MB. |
| `c1.p3.gap_container_limit_mb` | Your `limit.json`. |
| `c1.p3.gap_held_mb` | How much the app had allocated when it died. |
| `c1.p3.gap_inner_max_events` | `max` in the container's `memory.events`: how often it hit its own limit. |
| `c1.p3.gap_outer_oom_events` | `oom` in the host's `memory.events.local`: how often the machine ran out. |
| `c1.p3.gap_killed_by_own_limit` | The machine's `oom` is 0. |

## What is different on Docker Desktop

This is the part where Docker Desktop is the point.

- Your computer and "the machine Docker runs on" are two machines. The second one is a Linux virtual machine. By default it gets about half of your computer's memory. On this computer: 32456 MB and 15835 MB. Change it in Docker Desktop, Settings, Resources (or `.wslconfig` with the WSL 2 backend).
- A container can be given `--memory 20g` on a machine with 16 GB. Docker accepts it. When the virtual machine runs out, the Linux OOM killer in the virtual machine picks a process, and the container dies below its own limit. This part shows the same effect safely, inside a 256 MB host container. The script never fills the real virtual machine, because other work shares it.
- On Docker Engine in Linux, "your computer" and "the machine" are the same, and the two lines match.
- `docker stats` on Docker Desktop reads the same cgroup files as on Linux.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- A test says `The last run used a different limit.json`: run step 3 again.
- The last step says `the machine under it`: your limit is too high. Lower it.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 1`.
