# Results: Challenge 14, part 1: containerize the Daftar platform

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
grep -n FROM api/Dockerfile worker/Dockerfile web/Dockerfile   and   ls -a <service>/.dockerignore
```

**Output**

```text
api     FROM node:24-alpine@sha256:8a32c8cf649a... ; node:24-alpine@sha256:8a32c8cf649a...   .dockerignore: yes
worker  FROM python:3.12-slim@sha256:a0f57064cbdc...   .dockerignore: yes
web     FROM nginx:1.27-alpine@sha256:65645c7bb6a0...   .dockerignore: yes
```

**Note:** A digest after the tag (@sha256:...) names exactly one image; the tag alone can move. A .dockerignore keeps secrets and junk out of the build context.

## Step 2

**Command**

```sh
docker build --check api   (and worker, web)
```

**Output**

```text
api     0 warning(s)
worker  0 warning(s)
web     0 warning(s)
```

**Note:** Clean. Buildx read each Dockerfile and found nothing to complain about.

## Step 3

**Command**

```sh
docker build --no-cache -t <image> <service>   (3 times each, median)
docker image inspect <image> --format "{{.Size}}"
docker run --rm --entrypoint id <image> -u
```

**Output**

```text
api       245 MB   cold build 5.4 s (median of 3)   runs as uid 1000
worker    177 MB   cold build 1.9 s (median of 3)   runs as uid 10001
web        74 MB   cold build 1.8 s (median of 3)   runs as uid 101
```

**Note:** Size follows the base image and what you copy into it. A process that runs as uid 0 is root inside the container; the rubric asks for an unprivileged user.

## Step 4

**Command**

```sh
docker image history --no-trunc <image> | grep supersecret
docker image inspect <image> (Config.Env)
docker run --rm --entrypoint grep <image> -rl supersecret <app folders>
```

**Output**

```text
api     history: clean   environment: clean   files: clean
worker  history: clean   environment: clean   files: clean
web     history: clean   environment: clean   files: clean
```

**Note:** A secret in an ENV line stays in the image history for ever. A .env file copied by COPY . . ends up in a layer. Both are found in seconds by anyone who can pull the image.

## Step 5

**Command**

```sh
docker run -d <image>; docker stop -t 5 <container>   (3 times each, median)
```

**Output**

```text
api     docker stop took 0.3 s (median of 3)   exit code 0
worker  docker stop took 0.6 s (median of 3)   exit code 0
web     docker stop took 0.3 s (median of 3)   exit code 0
```

**Note:** 137 means the process ignored SIGTERM and Docker killed it after the limit. A shell in front of the program, or a program with no signal handler as PID 1, is the usual cause. Exec-form CMD fixes the first.

## Step 6

**Command**

```sh
append a comment to api/server.mjs, then docker build api   (3 edits; the npm step is looked for in the build log)
```

**Output**

```text
npm install step reused from the cache after an edit: yes
rebuild after an edit: 1.3 s (median of 3), cold build: 5.4 s
```

**Note:** Packages are copied and installed before the source, so a source edit leaves that layer alone.

## Step 7

**Command**

```sh
docker compose config --format json   (read: ports, healthchecks, depends_on, limits, hardening, profiles, watch)
```

**Output**

```text
services: api, db, psql, web, worker
database publishes a port to the host: false
health checks: 4 of 4   dependants wait for healthy: true
memory limits: 4 of 4   hardened (read-only, no capabilities, no-new-privileges): 3 of 3   restart policy: 4 of 4
a profile for tools: true   watch on the api: true
secret written in the file: false   obsolete "version:" key: false   database image pinned: true
```

**Note:** Each line is a thing a reviewer looks for. A published database port is reachable from your network. A password in the file is in git for good.

## Step 8

**Command**

```sh
docker compose up -d --build --wait
docker compose ps   then queue 5 jobs through the web page path (POST /api/jobs) and wait until all are done
```

**Output**

```text
up took 15.8 s
api     running  health: healthy
db      running  health: healthy
web     running  health: healthy
worker  running  health: healthy
jobs: 5 queued by the web path and all done after 1.9 s
```

**Note:** Every container reports healthy, and a job goes web, API, database, worker, database, web. That is the whole system working.

## Step 9

**Command**

```sh
grep -ci "mysql|docker-compose|node 16|pm2" README.md   and   grep for "docker compose up", ".env", "POSTGRES_PASSWORD"
```

**Output**

```text
stale words found: none
missing words: none
```

**Note:** The README tells the truth about how to run it.
