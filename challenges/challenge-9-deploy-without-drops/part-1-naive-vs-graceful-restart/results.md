# Results: Challenge 9, part 1: restart a service under load

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -f daftar-api/Dockerfile.naive daftar-api ; load.mjs while: docker restart dkr-c9-p1-app   (median of 3)
```

**Output**

```text
requests: 267   failed: 17   (refused 8, reset 9, timeout 0, 5xx 0)
docker restart took 6.1 s; first to last failure: 355 ms
```

**Note:** The naive image ignores SIGTERM (the shell in front of node does not pass it on), so docker restart has to wait for the stop timeout and then kills node: 6.1 s for the restart, and a later docker stop ends with exit code 137 (killed). While it waits, the old process keeps serving. When it is killed, requests in flight are cut.

## Step 2

**Command**

```sh
docker build -f reference/Dockerfile daftar-api ; load.mjs while: docker restart dkr-c9-p1-app   (median of 3)
```

**Output**

```text
requests: 261   failed: 16   (refused 5, reset 9, timeout 0, 5xx 0)
docker restart took 1.7 s; first to last failure: 1746 ms
```

**Note:** Your image restarts in 1.7 s and a docker stop ends with exit code 0: node received SIGTERM and finished cleanly. Requests still fail during the restart (16, of which 5 refused and 9 reset), because for a moment nobody is listening. A graceful stop is necessary and not enough. Part 2 closes the gap.
