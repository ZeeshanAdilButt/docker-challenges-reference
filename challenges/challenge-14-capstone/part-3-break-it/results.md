# Results: Challenge 14, part 3: break it

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
curl http://127.0.0.1:<api port>/crash   (the api answers, then exits with code 137, while 6 jobs are queued and in flight)
poll GET /api/ready through the web page every 100 ms; poll /api/jobs until every job is done
```

**Output**

```text
restart policy of the api in your compose.yaml: unless-stopped
api answering again after 1.4 s   (restart count 1)
jobs: 6 of 6 done after 4.1 s   lost: 0
```

**Note:** Docker restarted the api, and no job was lost: a job claimed by a worker that cannot report back goes back in the queue after a few seconds, and is done again. Delivery is at least once.

## Step 2

**Command**

```sh
GET /alloc?mb=200 on the api, up to three times (each call holds 200 MB)
docker events --filter event=oom --filter container=<api>
poll GET /api/ready until the api is back, then queue 3 jobs
```

**Output**

```text
memory limit of the api in your compose.yaml: 256 MB
answers to the three /alloc calls: 200, 0   (0 means the connection died)
out-of-memory kill events: 1   api restarts: 1   worker restarts: 0   db restarts: 0
api answering again 2.3 s after the last call
jobs queued afterwards: 3, done: 3
```

**Note:** The kernel stopped the hog at its limit (exit 137, an OOM kill event), Docker started it again, and nothing else on the host noticed. A limit turns "the whole machine is slow" into "one container restarted".

## Step 3

**Command**

```sh
start the api with DATABASE_URL pointing at the right host and the wrong password:  docker compose up -d --wait --wait-timeout 40 api
curl http://127.0.0.1:<web port>/api/ready
```

**Output**

```text
compose up --wait: FAILED after 23.1 s (container dkr-c14-stack-api-1 is unhealthy)
api health status: unhealthy   GET /api/ready through the web page: 503
```

**Note:** The health gate refused the release: /ready checks the database, the health check calls /ready, and "up --wait" says no. You find out in seconds, from the command that made the change.

## Step 4

**Command**

```sh
read RUNBOOK.md: one entry each for kill, starve and misconfigure; check the fields and the Measured: numbers
```

**Output**

```text
kill      "Kill: the api process dies"  complete   measured 1.5 s, experiment 1.4 s
starve    "Starve: the api eats its memory"  complete   measured 3.6 s, experiment 2.3 s
misconfig "Misconfigure: the api has the wrong data"  complete   measured 22 s, experiment 23.1 s
```

**Note:** Three complete entries, and each quotes the number your own experiment measured. That is what a person at 3 am needs: what to look at, what to type, and what normal looks like.
