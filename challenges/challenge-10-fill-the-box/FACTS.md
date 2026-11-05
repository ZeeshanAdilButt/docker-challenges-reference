# Facts for challenge 10

Every number a chapter may quote. The values are in `facts.json`. All runs: Windows 11, Docker Desktop, Docker Engine 29.9.2, cgroup v2, containerd image store, Node 22 on the host. Every container has a 64 MB memory cap. Only the CPU loop counts are a median of three runs. The other numbers are single, deterministic measurements (kernel kill point, process count, file count, byte counts).

## Part 1: hit the limits

| Fact | Meaning | How it was measured |
|---|---|---|
| `c10.p1.default_nofile` | Open-file limit in a new container, with no `--ulimit` | `ulimit -n` inside `alpine:3.23` |
| `c10.p1.base_heap_held_mb` | MB of JavaScript data a leak held before the kernel killed the container (no heap cap) | Last `held_mb` line of `worker.mjs` in `node:24-alpine`, `--memory 64m` |
| `c10.p1.base_heap_exit_code` | Exit code of that run (137) | `docker inspect` `State.ExitCode` |
| `c10.p1.base_heap_oomkilled` | Whether Docker recorded an OOM kill | `docker inspect` `State.OOMKilled` |
| `c10.p1.base_buffer_held_mb` | MB of Buffers held before the kill | Same, `WORK=buffer-leak` |
| `c10.p1.base_buffer_exit_code` | Exit code of the Buffer leak (137) | `docker inspect` |
| `c10.p1.base_fork_children` | Helper processes the fork loop started with `--pids-limit 50` before `EAGAIN` | Count printed by `worker.mjs` |
| `c10.p1.base_fds_opened` | Files opened by the loop with the default `nofile` (stopped by its own cap of 20000) | Count printed by `worker.mjs` |
| `c10.p1.mine_heap_exit_code` | Exit code when V8 stops the leak at `--max-old-space-size=28` (139 here) | `docker inspect` |
| `c10.p1.mine_heap_oomkilled` | OOM flag for that run (false) | `docker inspect` |
| `c10.p1.mine_heap_held_mb` | MB held when V8 stopped it | Last `held_mb` line |
| `c10.p1.mine_heap_abort` | The text `JavaScript heap out of memory` was in the output | Output of the run |
| `c10.p1.mine_fork_children` | Helpers started with `--pids-limit 20` | Count printed by `worker.mjs` |
| `c10.p1.mine_fds_opened` | Files opened with `--ulimit nofile=128:128` before `EMFILE` | Count printed by `worker.mjs` |
| `c10.p1.mine_legit_ok` | The real job (8 MB, 3 helpers, 20 files) finished with the reference limits | `worker.mjs` `WORK=legit` |
| `c10.p1.buffer_capped_exit_code` / `buffer_capped_oomkilled` | The Buffer leak with a heap cap set: still killed (137, true) | `docker inspect` |
| `c10.p1.cpu_free_loops` | Loops done in 2 seconds with no CPU limit | Median of three runs |
| `c10.p1.cpu_quarter_loops` | Loops done in 2 seconds with `--cpus 0.25` | Median of three runs |
| `c10.p1.cpu_quarter_ratio` | The second divided by the first | Computed |
| `c10.p1.cpu_quarter_throttled_periods` | `nr_throttled` from `cpu.stat` in the last throttled run | `/sys/fs/cgroup/cpu.stat` read inside |
| `c10.p1.goals_met_count` | Goals met by the `limits.json` that was used (4 of 4 for the reference) | Live checks in `gradeLimits` |

## Part 2: logs and disk growth

| Fact | Meaning | How it was measured |
|---|---|---|
| `c10.p2.default_log_driver` | The daemon's default log driver (`local` here, not `json-file`) | `docker info --format '{{.LoggingDriver}}'` |
| `c10.p2.norot_printed_mib` | MiB printed by the test program (55000 lines of 220 bytes) | Computed from the program |
| `c10.p2.norot_disk_mib` | MiB the unrotated `json-file` log takes on disk | Sum of file sizes, read through a read-only bind mount of that container's folder |
| `c10.p2.norot_files`, `norot_lines_kept` | Files and lines kept without rotation | File listing, and lines counted from `docker logs` |
| `c10.p2.disk_bytes_per_line` | Disk bytes per line, JSON wrapper included | Disk bytes divided by 55000 |
| `c10.p2.growth_mb_per_day_at_100_lines_s` | Log growth per day at 100 lines per second | Computed from the line above |
| `c10.p2.days_to_fill_10gb_at_100_lines_s` | Days until 10 GB is full at that rate | Computed |
| `c10.p2.rot_disk_mib`, `rot_files` | Disk use and file count with `max-size=2m`, `max-file=3` | Same as above |
| `c10.p2.rot_lines_kept`, `rot_lines_lost` | Lines kept and lost with that rotation | `docker logs` |
| `c10.p2.rot_newest_kept` | The last line printed is still in the log | `docker logs` |
| `c10.p2.none_driver_logs_readable` | `docker logs` works with `--log-driver none` (false) | Exit code of `docker logs` |
| `c10.p2.tmpfs_small_wrote_mb`, `tmpfs_small_memory_mb` | A 10 MB file in a tmpfs and the container's `memory.current` afterwards | `dd`, then `/sys/fs/cgroup/memory.current` |
| `c10.p2.tmpfs_runaway_wrote_mb` | MB written by a 100 MB writer to a 16 MB tmpfs | `stat` of the file |
| `c10.p2.tmpfs_runaway_enospc`, `tmpfs_runaway_oomkilled` | The writer got "no space" (true) and was not killed (false) | `dd` exit code, `docker inspect` |
| `c10.p2.tmpfs_64_oomkilled` | A 64 MB tmpfs in a 64 MB container ends in an OOM kill (true) | `docker inspect` |
| `c10.p2.writable_layer_mb` | Writable layer size after writing 20 MB to a normal path | `docker inspect --size`, `SizeRw` |
| `c10.p2.goals_met_count` | Goals met by the `settings.json` that was used (5 of 5 for the reference) | `gradeSettings` |

## Part 3: audit the host

| Fact | Meaning | How it was measured |
|---|---|---|
| `c10.p3.ps_size_text` | The text `docker ps -s` prints for a created container | `docker ps -a -s --format '{{.Size}}'` |
| `c10.p3.ps_size_parsed_bytes` | That text parsed to bytes (decimal units) | `parseSize` |
| `c10.p3.audit_exit_code`, `live_exit_code` | Exit code of the audit on a file and live (1: a high finding exists) | Process exit code |
| `c10.p3.containers_audited_count`, `containers_correct_count` | Containers audited and containers whose findings match the expected ones | Comparison in `run.mjs` |
| `c10.p3.findings_critical_count`, `findings_high_count`, `findings_medium_count`, `findings_low_count` | Findings per severity over the four containers | `summarize` |
