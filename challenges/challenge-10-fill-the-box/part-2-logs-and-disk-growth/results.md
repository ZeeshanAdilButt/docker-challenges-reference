# Results: Challenge 10, part 2: logs and disk growth

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker info --format '{{.LoggingDriver}}'
```

**Output**

```text
local
```

**Note:** This daemon logs with "local" when you choose nothing. The docs say json-file with no rotation. Check yours: the default decides whether a log can fill the disk.

## Step 2

**Command**

```sh
docker run -d --log-driver json-file ... awk (prints 55000 lines of 220 bytes)
```

**Output**

```text
printed:   11.2 MiB (55000 lines)
on disk:   14.9 MiB in 1 file
kept:      55000 lines, first 1, last 55000
15613772  <id>-json.log
```

**Note:** With no rotation every line stays. The file is bigger than what was printed because json-file adds about 63 bytes of JSON and time per line.

## Step 3

**Command**

```sh
docker run -d --log-driver json-file --log-opt max-size=2m --log-opt max-file=3 ... awk
```

**Output**

```text
printed:   11.2 MiB (55000 lines)
on disk:   5.4 MiB in 3 files
kept:      19775 lines, first 35226, last 55000
 1613667  <id>-json.log
 2000236  <id>-json.log.1
 2000055  <id>-json.log.2
```

**Note:** Rotation keeps the newest lines and drops the oldest. 35225 lines are gone for good. That is the price of a bounded disk.

## Step 4

**Command**

```sh
arithmetic: measured bytes per line x 100 lines per second x 86400 seconds
```

**Output**

```text
284 bytes per line x 100 x 86400 = 2453 MB per day
10 GB of free disk lasts 4.1 days at that rate with no rotation
```

**Note:** This is the 3 am story: nothing is wrong for days, then the disk is full.

## Step 5

**Command**

```sh
docker logs <container started with --log-driver none>
```

**Output**

```text
Error response from daemon: configured logging driver does not support reading
```

**Note:** With the none driver nothing is kept and docker logs cannot read it. No disk use, and no evidence when it breaks.

## Step 6

**Command**

```sh
docker run --tmpfs /scratch:rw,size=16m ... dd 10 MB into /scratch
```

**Output**

```text
wrote 10 MB, memory.current now 12 MB of 64
```

**Note:** A tmpfs file counts against the container memory. 10 MB of scratch took about 10 MB of the 64 MB.

## Step 7

**Command**

```sh
same tmpfs (size=16m), dd 100 MB
```

**Output**

```text
stopped at 16 MB, no-space error: true, OOMKilled: false, memory.current 18 MB
```

**Note:** The writer got "no space left on device" at the tmpfs size. The kernel killed nothing.

## Step 8

**Command**

```sh
same test with --tmpfs /scratch:rw,size=64m
```

**Output**

```text
stopped at 62 MB, OOMKilled: true
```

**Note:** A 64 MB tmpfs inside a 64 MB container cannot work: the kernel runs out of memory first.

## Step 9

**Command**

```sh
docker ps -s --filter name=dkr-c10-layer
```

**Output**

```text
NAMES           SIZE
dkr-c10-layer   21MB (virtual 30.1MB)
```

**Note:** Writing 20 MB to a normal path made the writable layer 20 MB. Nothing capped it. This is the space that fills a host while docker logs looks fine.

## Step 10

**Command**

```sh
check settings.json against the goals
```

**Output**

```text
PASS  log rotation is set: max_size "2m" times max_file "3" must be at most 8 MiB and max_file at least 2
PASS  log disk use stays inside the budget: the log files hold 5.4 MiB after about 12 MB of output; budget is 8 MiB
PASS  newest log line is kept: last kept line is 55000; the program printed 55000 lines
PASS  scratch space fits the real job: a 10 MB scratch file was written with tmpfs_mb 16
PASS  runaway writer gets "no space", not a kill: a 100 MB writer stopped at 16 MB with "no space left"
```

**Note:** All goals are met.
