# Results: Challenge 8, part 1: the full stack, then kill the database

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Compose 5.6.1, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker compose -p dkr-c8 up -d   (then: docker compose -p dkr-c8 ps -a)
```

**Output**

```text
service  state     exit  health
api      running   0     starting
cache    running   0     healthy
db       running   0     healthy
migrate  exited    0     -
worker   running   0     -
```

**Note:** The api answered /ready after 10.6 s. The migrate job ran once and exited with 0.

## Step 2

**Command**

```sh
(boot timing: 10.6 s, 10 s, 11.8 s)
```

**Output**

```text
time to ready, median of 3: 10.6 s
```

**Note:** From docker compose up -d until the api answers /ready with 200. This includes the database starting for the first time.

## Step 3

**Command**

```sh
curl -X POST http://127.0.0.1:64393/notes?body=hello ; curl -X POST http://127.0.0.1:64393/jobs?n=5 ; curl http://127.0.0.1:64393/stats
```

**Output**

```text
{"notes":1,"jobs_done":5,"queue":0,"version":"1"}
```

**Note:** The api wrote a note and put 5 jobs on the cache list. The worker took them and wrote 5 rows to the database.

## Step 4

**Command**

```sh
docker compose -p dkr-c8 --profile tools run --rm psql -c "\dt"
```

**Output**

```text
List of tables
 Schema |   Name    | Type  |  Owner   
--------+-----------+-------+----------
 public | jobs_done | table | postgres
 public | notes     | table | postgres
(2 rows)
```

**Note:** The psql tool only exists when you ask for the "tools" profile. It found 2 tables.

## Step 5

**Command**

```sh
docker exec dkr-c8-db-1 kill -QUIT 1 ; curl http://127.0.0.1:64393/ready ; curl http://127.0.0.1:64393/health
```

**Output**

```text
/ready -> 503 after 0.3 s
/health -> 200
```

**Note:** The api noticed within a moment. /ready says 503 because the database is gone, but the api process itself is alive: that is what /health is for.

## Step 6

**Command**

```sh
docker compose -p dkr-c8 ps -a   (after waiting up to 45 s for /ready)
```

**Output**

```text
service  state     exit  health
api      running   0     healthy
cache    running   0     healthy
db       running   0     starting
migrate  exited    0     -
worker   running   0     -
```

**Note:** Everything came back by itself, 2.4 s after the kill. The restart policy brought the database back, and the api found it on its next request.

## Step 7

**Command**

```sh
curl -X POST http://127.0.0.1:64393/jobs?n=5 ; curl http://127.0.0.1:64393/stats ; docker inspect dkr-c8-worker-1 --format "{{.RestartCount}}"
```

**Output**

```text
{"notes":1,"jobs_done":10,"queue":0,"version":"1"}
worker restarts: 1
```

**Note:** The worker held a connection to the old database, so it exited and the restart policy started it again (1 restart). 5 of the new 5 jobs were processed, and the note written before the kill is still there.

## Step 8

**Command**

```sh
docker kill dkr-c8-db-1 ; sleep 8 ; docker inspect dkr-c8-db-1 --format "{{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}"
```

**Output**

```text
exited exit=137 restarts=1
```

**Note:** docker kill counts as stopping the container by hand. A restart policy never undoes a manual stop, so the database stays down until someone starts it. Only a crash is restarted.
