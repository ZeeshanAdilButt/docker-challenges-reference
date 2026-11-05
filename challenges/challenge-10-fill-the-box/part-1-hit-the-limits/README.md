# Challenge 10, part 1: hit the limits on purpose

**Time:** about 45 minutes. **Download:** `node:24-alpine` (about 62 MB packed) and `alpine:3.23` (about 4 MB packed). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A service has a memory leak at 3 am. Without a limit it eats the whole host, and then the database and everything else dies with it. With a limit, only that one container dies. But a limit set blindly causes its own outage: the container is killed and restarted in a loop, or a "limit" does not stop the thing you worried about. You need to know what each limit really does before you set it.

## The idea

A container limit is a rule the Linux kernel enforces. There are four you will hit in this part.

- **Memory** (`--memory`). When the container goes over, the kernel kills it. Docker records `OOMKilled: true` and exit code 137 (128 plus signal 9). This is a kill, not a slow-down.
- **Processes** (`--pids-limit`). When the container reaches the number, `fork` fails with `EAGAIN`. Nothing is killed. The program gets an error. Threads count too, not only processes.
- **Open files** (`--ulimit nofile`). When a process holds that many files or sockets, the next `open` fails with `EMFILE` ("too many open files").
- **CPU** (`--cpus`). The container is paused between short time slices. Nothing is killed. It is only slower.

A programming language runtime adds its own limit on top. Node's JavaScript heap has a ceiling (`--max-old-space-size`). If that ceiling is lower than the container limit, Node stops itself with a clear message before the kernel kills it. If it is higher, the kernel wins and you only see exit 137.

You will leak memory, fork and open files on purpose, inside a cage of 64 MB, 50 processes and a 16 MB `/tmp`. Then you will set three numbers in `limits.json` so each runaway job is stopped, while the real job (hold 8 MB, start 3 helpers, open 20 files) still works.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-10-fill-the-box/part-1-hit-the-limits/test.mjs` | Three live tests **fail** on purpose. Read the messages. |
| 2 | `node challenges/challenge-10-fill-the-box/part-1-hit-the-limits/run.mjs` | Measures the default open-file limit, runs four runaway jobs with no tuning, then with your `limits.json`, then a CPU throttle test. Saves the facts. |
| 3 | Edit `limits.json`: `heap_mb`, `pids`, `nofile` | See the goals below. `heap_mb` of 0 means "leave Node's default". |
| 4 | `node challenges/challenge-10-fill-the-box/part-1-hit-the-limits/run.mjs` | The last step prints PASS or FAIL for each goal. |
| 5 | `node toolkit/show-facts.mjs c10.p1` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-10-fill-the-box/part-1-hit-the-limits/test.mjs` | All tests pass. |

The four goals:

1. The real job still works (8 MB held, 3 helper processes, 20 files open).
2. A JavaScript memory leak ends because **Node** stops it, not because the kernel killed the container (`OOMKilled` must be `false`).
3. The fork loop starts at most 17 helper processes.
4. The file loop opens at most 256 files.

The memory cap of the cage is fixed at 64 MB. You cannot raise it. You tune what runs inside it.

## What you should see

With no tuning, the JavaScript leak is killed by the kernel after about 43 MB of data (exit 137, `OOMKilled: true`). Node itself needs about 46 MB before your data, so the 64 MB wall comes quickly. The fork loop stops at 43 helpers. The file loop reaches its safety cap of 20000 without any error, because the default limit here is 1,048,576.

With the reference numbers, the JavaScript leak stops at about 22 MB with a V8 message and exit code 139, and `OOMKilled` is `false`. Notice the exit code: the kernel kill is 137, but the V8 abort is 139 on this machine. The fork loop stops at 13 and the file loop at 110.

One more result is a trap. A memory leak in **Buffers** still ends in exit 137 even with the heap cap, because Buffers are outside the JavaScript heap.

The full recorded run is in [results.md](results.md). Your numbers will differ a little.

![How far a runaway job got](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c10.p1.default_nofile` | `ulimit -n` inside a new container. Measured, not assumed. The release notes imply 1024. |
| `c10.p1.base_heap_held_mb`, `base_heap_exit_code`, `base_heap_oomkilled` | The last `held_mb` line printed by the JavaScript leak, and `docker inspect` `State.ExitCode` and `State.OOMKilled`. |
| `c10.p1.base_buffer_held_mb`, `base_buffer_exit_code` | The same for the Buffer leak. |
| `c10.p1.base_fork_children` | Helper processes started before `fork` failed with `EAGAIN`, with `--pids-limit 50`. |
| `c10.p1.base_fds_opened` | Files opened before the loop stopped. Its own cap is 20000. |
| `c10.p1.mine_*` | The same jobs with the numbers from `limits.json`. `mine_legit_ok` is true when the real job finished. |
| `c10.p1.buffer_capped_*` | The Buffer leak with a heap cap set. Shows the cap does not help. |
| `c10.p1.cpu_free_loops`, `cpu_quarter_loops` | Loops done in 2 seconds, without and with `--cpus 0.25`. Median of three runs each. |
| `c10.p1.cpu_quarter_ratio` | The second divided by the first. |
| `c10.p1.cpu_quarter_throttled_periods` | `nr_throttled` in `/sys/fs/cgroup/cpu.stat`, from the last throttled run. |
| `c10.p1.goals_met_count` | How many of the four goals your `limits.json` meets. |

## What is different on Docker Desktop

- The memory, process and file limits are enforced by the kernel of Docker Desktop's Linux virtual machine. The numbers match what you would see on Linux.
- On Docker Desktop the default `nofile` limit was 1,048,576 in the reference run. On another setup it can be 1024. This is why the script measures it.
- The exact point where the kernel kills the container (about 43 MB held here) depends on what else the virtual machine caches. Expect a few MB of difference.
- `--cpus 0.25` throttles inside the virtual machine. The ratio you see depends on how busy your computer is.

## Why Node exits with 139 and not 134

A V8 "heap out of memory" is normally an abort (signal 6, exit 134). On this machine, with Node 24 on Alpine, the exit code was 139. Do not rely on one number. Look for the message `JavaScript heap out of memory` in the logs, and for `OOMKilled: false`.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- A goal says `FAIL`: the message says what happened. Fork loop too long: lower `pids`. File loop too long: set `nofile`. Leak killed by the kernel: set `heap_mb` below the point where the kernel kills (about 43 MB) but above 8 MB for the real job.
- The real job breaks: your `pids` or `nofile` is too low. Node uses about 7 threads and about 15 files by itself.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 10`.

## Next

Part 2 grows logs and disk. Same cage, different resource.
