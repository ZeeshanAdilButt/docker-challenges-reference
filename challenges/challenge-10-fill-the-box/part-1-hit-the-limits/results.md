# Results: Challenge 10, part 1: hit the limits on purpose

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker run --rm --name dkr-c10-defaults --label dkr.challenge=10 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges alpine:3.23 sh -c 'echo nofile=$(ulimit -n); cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max'
```

**Output**

```text
nofile=1048576
67108864
50
```

**Note:** The memory and process caps are there only because we asked. The open-file limit is 1048576 without us asking. The release notes imply 1024, so this number is measured, not assumed.

## Step 2

**Command**

```sh
WORK=heap-leak, no tuning (node:24-alpine, 64m cap)
```

**Output**

```text
last line: {"held_mb":43}
result: killed by the kernel (OOMKilled, exit 137)
```

**Note:** A JavaScript leak reached 43 MB of data and the kernel killed the whole container. Node's own heap limit is far above 64 MB, so V8 never gets the chance to stop first.

## Step 3

**Command**

```sh
WORK=buffer-leak, no tuning
```

**Output**

```text
last line: {"held_mb":52}
result: killed by the kernel (OOMKilled, exit 137)
```

**Note:** Buffers live outside the JavaScript heap. The result is the same kill.

## Step 4

**Command**

```sh
WORK=fork, no tuning (--pids-limit 50)
```

**Output**

```text
{"children":43,"error":"EAGAIN"}
```

**Note:** Docker stopped the fork loop at 43 helper processes. Node itself already uses about seven threads, and every thread counts against the limit.

## Step 5

**Command**

```sh
WORK=fds, no tuning
```

**Output**

```text
{"files":20000,"error":null}
```

**Note:** No limit was hit: the loop stopped at its own safety cap of 20000. With a limit of 1048576 a leak like this runs until memory or the kernel gives up.

## Step 6

**Command**

```sh
limits.json = {"heap_mb":28,"pids":20,"nofile":128}
```

**Output**

```text
heap-leak: stopped by V8 heap limit (exit 139), the kernel did not kill it at 22 MB
fork: 13 helpers, error EAGAIN
fds: 110 files, error EMFILE
legit job: ok
```

**Note:** The same jobs again, now with your limits. The real job must still work.

## Step 7

**Command**

```sh
WORK=buffer-leak with --max-old-space-size=28
```

**Output**

```text
last line: {"held_mb":52}
result: killed by the kernel (OOMKilled, exit 137)
```

**Note:** The heap cap did nothing here. Memory outside the heap is invisible to it, so the container limit still has to leave room for it.

## Step 8

**Command**

```sh
docker run --cpus 0.25 ... node -e "<spin for 2 seconds>"  (3 runs each, median)
```

**Output**

```text
no cpu limit:   5447 loops in 2 s
--cpus 0.25:    1225 loops in 2 s  (0.22 of full speed)
cpu.stat nr_throttled=22 throttled_usec=1608506
```

**Note:** A CPU limit throttles. The process is paused between slices and nothing is killed. That is the opposite of a memory limit.

## Step 9

**Command**

```sh
check limits.json against the four goals
```

**Output**

```text
PASS  legit job still works: the real job held 8 MB, started 3 helpers and opened 20 files
PASS  runaway heap stops before the kernel: heap leak: stopped by V8 heap limit (exit 139), the kernel did not kill it after 23 MB
PASS  fork loop is contained: fork loop started 13 helpers (error EAGAIN); goal: at most 17
PASS  open-file leak is contained: file loop opened 110 files (error EMFILE); goal: at most 256
```

**Note:** All four goals are met.
