# Challenge 10, part 2: logs and disk growth

**Time:** about 45 minutes. **Download:** `alpine:3.23` only (about 4 MB packed). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A server stops at 3 am. The app is fine, the memory is fine, and nobody changed anything. The disk is full. Very often the cause is a log file that nobody rotated, or a container that wrote into its own layer for weeks. Nothing warned you, because a full disk looks normal until the last minute.

## The idea

A container can put data in four places, and each one is limited in a different way.

| Place | Limited by | When it grows without a limit |
|---|---|---|
| Its logs (everything it prints) | `--log-opt max-size` and `max-file` | The log file grows forever on the host disk. |
| A `tmpfs` mount | `size=` on the mount. It lives in memory, so it also counts against `--memory`. | A tmpfs bigger than your memory headroom gets the container killed. |
| The writable layer (any path that is not a mount) | nothing, by default | It grows on the host disk and `docker logs` shows nothing. |
| A volume | nothing, by default | Same as the writable layer. |

Log rotation keeps a fixed number of files of a fixed size. When the newest file is full, Docker starts a new one and deletes the oldest. Your disk use is then bounded: `max-size` times `max-file`. The cost is that old lines are gone.

You will make a container print about 12 MB of log lines, look at the log with and without rotation, then fill a tmpfs and a writable layer on purpose. Then you will edit `settings.json` so that logs stay inside an 8 MiB budget and a runaway writer gets an error instead of killing the container.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-10-fill-the-box/part-2-logs-and-disk-growth/test.mjs` | Three live tests **fail** on purpose. |
| 2 | `node challenges/challenge-10-fill-the-box/part-2-logs-and-disk-growth/run.mjs` | Prints the numbers for the starter settings and saves facts. |
| 3 | Edit `settings.json`: `log.max_size`, `log.max_file` and `tmpfs_mb` | See the goals below. |
| 4 | `node challenges/challenge-10-fill-the-box/part-2-logs-and-disk-growth/run.mjs` | The last step prints PASS or FAIL for each goal. |
| 5 | `node toolkit/show-facts.mjs c10.p2` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-10-fill-the-box/part-2-logs-and-disk-growth/test.mjs` | All tests pass. |

The goals:

1. `max_size` times `max_file` is at most 8 MiB, and `max_file` is at least 2. (`max_size` takes `k` or `m`, for example `2m`.)
2. After about 12 MB of output, the log files on disk hold at most 8 MiB.
3. The newest log line is still there.
4. A 10 MB scratch job fits in the tmpfs (`tmpfs_mb` large enough).
5. A 100 MB runaway writer gets "no space left on device" instead of being killed by the kernel (`tmpfs_mb` small enough).

How the script reads the log size: it starts a second tiny container with one read-only bind mount of that one container's folder under `/var/lib/docker/containers`. It is not the Docker socket, and it only reads file sizes. If your Docker keeps logs somewhere else (rootless mode, for example), the log-size lines show zero and the budget test says so.

## What you should see

With no rotation, 11.2 MiB of printed text becomes a 14.9 MiB file, because `json-file` wraps every line in JSON with a time stamp. At 100 lines per second that grows by about 2.4 GB per day. A 10 GB disk lasts about four days.

With `max-size=2m` and `max-file=3`, the log holds 5.4 MiB in three files, and about 35,000 of the 55,000 lines are gone. The newest line, number 55000, is there.

A 10 MB scratch file in a tmpfs raises the container's `memory.current` by about 10 MB. A 100 MB writer on a 16 MB tmpfs stops at 16 MB with "no space". The same writer on a 64 MB tmpfs inside a 64 MB container is killed by the kernel.

Writing 20 MB to a normal path makes `docker ps -s` show 20 MB in the writable layer. Nothing stopped it.

The full recorded run is in [results.md](results.md).

![Log disk use after about 12 MB of output](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c10.p2.default_log_driver` | `docker info --format '{{.LoggingDriver}}'`. Measured. On the reference machine it is `local`, not `json-file`. |
| `c10.p2.norot_printed_mib`, `norot_disk_mib`, `norot_files`, `norot_lines_kept` | The container prints 55000 lines of 220 bytes. Disk size is the sum of the log file sizes. Lines kept are counted from `docker logs`. |
| `c10.p2.disk_bytes_per_line` | Disk bytes of the unrotated log divided by 55000. |
| `c10.p2.growth_mb_per_day_at_100_lines_s` | `disk_bytes_per_line` times 100 times 86400, divided by one million. |
| `c10.p2.days_to_fill_10gb_at_100_lines_s` | 10,000 MB divided by the line above. |
| `c10.p2.rot_disk_mib`, `rot_files`, `rot_lines_kept`, `rot_lines_lost`, `rot_newest_kept` | The same container with your `settings.json` log options. |
| `c10.p2.none_driver_logs_readable` | Whether `docker logs` can read a container started with `--log-driver none`. |
| `c10.p2.tmpfs_small_*`, `tmpfs_runaway_*`, `tmpfs_64_oomkilled` | `dd` into `/scratch`, `memory.current` read inside, `docker inspect` for `OOMKilled`. |
| `c10.p2.writable_layer_mb` | `docker inspect --size`, field `SizeRw`. |
| `c10.p2.goals_met_count` | How many of the five goals your settings meet. |

## What is different on Docker Desktop

- The log files live inside Docker Desktop's Linux virtual machine, not on your Windows or macOS disk. The bind mount in the script uses the path inside that machine, so it works. You cannot find these files with your file explorer.
- Free space on your computer is a different number from free space inside the virtual machine. `docker system df` shows the virtual machine side.
- The default log driver may differ. The reference run measured `local`, which rotates by default (20 MB, 5 files). The docs say `json-file`, which does not rotate. Check yours with the first step.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- The log budget says 0 MiB: the script could not read your log folder. Check `docker inspect --format '{{.LogPath}}' <container>` on a test container.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 10`.

## Next

Part 3 reads `docker inspect` and flags every missing limit, unrotated log and risky restart policy for you.
