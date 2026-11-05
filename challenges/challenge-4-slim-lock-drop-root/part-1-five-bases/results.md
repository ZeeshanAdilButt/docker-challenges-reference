# Results: Challenge 4, part 1: five bases for one app

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -f Dockerfile.full -t dkr-c4-p1-full:test daftar-api
```

**Output**

```text
#3 DONE 0.0s
#4 [internal] load build context
#4 DONE 0.0s
#5 [1/3] FROM docker.io/library/node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413
#5 DONE 0.1s
#6 [2/3] WORKDIR /app
#7 [3/3] COPY package.json server.mjs ./
#8 DONE 0.4s
```

**Note:** Built node:24 (Debian, full).

## Step 2

**Command**

```sh
docker build -f Dockerfile.slim -t dkr-c4-p1-slim:test daftar-api
```

**Output**

```text
#3 DONE 0.0s
#4 [internal] load build context
#4 DONE 0.0s
#5 [1/3] FROM docker.io/library/node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
#5 DONE 0.1s
#6 [2/3] WORKDIR /app
#7 [3/3] COPY package.json server.mjs ./
#8 DONE 0.4s
```

**Note:** Built node:24-slim (Debian, slim).

## Step 3

**Command**

```sh
docker build -f Dockerfile.alpine -t dkr-c4-p1-alpine:test daftar-api
```

**Output**

```text
#3 DONE 0.0s
#4 [internal] load build context
#4 DONE 0.0s
#5 [1/3] FROM docker.io/library/node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
#5 DONE 0.1s
#6 [2/3] WORKDIR /app
#7 [3/3] COPY package.json server.mjs ./
#8 DONE 0.7s
```

**Note:** Built node:24-alpine (musl).

## Step 4

**Command**

```sh
docker build -f Dockerfile.alpine-os -t dkr-c4-p1-alpine-os:test daftar-api
```

**Output**

```text
#4 [internal] load build context
#4 DONE 0.1s
#5 [1/4] FROM docker.io/library/alpine:3.23@sha256:ff7f0c727dd796aa36787bfcd9a64bf35a6ce72a73451b3359fde849b6703d63
#5 DONE 0.1s
#6 [2/4] RUN apk add --no-cache nodejs
#7 [3/4] WORKDIR /app
#8 [4/4] COPY package.json server.mjs ./
#9 DONE 1.7s
```

**Note:** Built alpine:3.23 + apk nodejs.

## Step 5

**Command**

```sh
docker build -f Dockerfile.distroless -t dkr-c4-p1-distroless:test daftar-api
```

**Output**

```text
#3 DONE 0.0s
#4 [internal] load build context
#4 DONE 0.0s
#5 [1/3] FROM gcr.io/distroless/nodejs24-debian13@sha256:03980f6fd2a3245fa06e371c36fd33528ebbc676a1d0f84e3e21d95cd291b807
#5 DONE 0.1s
#6 [2/3] WORKDIR /app
#7 [3/3] COPY package.json server.mjs ./
#8 DONE 0.3s
```

**Note:** Built distroless nodejs24.

## Step 6

**Command**

```sh
node challenges/challenge-4-slim-lock-drop-root/part-1-five-bases/run.mjs   (the table at the end)
```

**Output**

```text
base                          unpacked  packed  Size field  packages  shell  glibc  start   idle mem
node:24 (Debian, full)        1136.7 MB 410 MB  1630.5 MB   413       yes    yes    786 ms  16.2 MiB
node:24-slim (Debian, slim)   230.4 MB  81.1 MB 330.4 MB    88        yes    yes    942 ms  16.2 MiB
node:24-alpine (musl)         172 MB    62.5 MB 243.6 MB    19        yes    no     1108 ms 16.9 MiB
alpine:3.23 + apk nodejs      77.2 MB   29.9 MB 108.6 MB    30        yes    no     981 ms  16.7 MiB
distroless nodejs24           154.8 MB  55.5 MB 214.8 MB    14        no     yes    739 ms  17.2 MiB
```

**Note:** Same app, five bases. Unpacked and packed sizes (from the layers), packages and tools change a lot. Idle memory is the same. Start time is about one second on all of them and moves from run to run.

## Step 7

**Command**

```sh
docker run --rm --entrypoint /usr/bin/node dkr-c4-p1-alpine-os:test -e "...du of /var/cache/apk..."
```

**Output**

```text
apk package cache left in the image: 0 KB
```

**Note:** No package index cache is left behind (apk add --no-cache).

## Step 8

**Command**

```sh
docker buildx imagetools inspect dhi.io/node:24
```

**Output**

```text
ERROR: failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://dhi.io/token?...: 401 Unauthorized
```

**Note:** Docker Hardened Images need a Docker login (free account). This is why they are not one of the five required bases.
