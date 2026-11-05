# Results: Challenge 5, part 1: order, ignore rules and cache mounts

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -t dkr-c5-p1-app:test .
```

**Output**

```text
build folder sent to the builder: 0.1 MB
image size (files in the layers): 243.4 MB
npm cache stored inside the image: 0 MB
folders .git, logs, coverage inside the image: 0 of 3
first build took 9.8 s
```

**Note:** The build folder holds clutter. Ignore rules decide how much of it is sent, and how much ends up in the image.

## Step 2

**Command**

```sh
echo "// a small edit" >> server.mjs && docker build -t dkr-c5-p1-app:test .
```

**Output**

```text
[1/5]   0.1 s  FROM docker.io/library/node:24-alpine@sha256:8a32c8cf649a499
[2/5] CACHED   WORKDIR /app
[3/5] CACHED   COPY package.json package-lock.json ./
[4/5] CACHED   RUN --mount=type=cache,target=/root/.npm,id=dkr-c5-npm npm c
[5/5]   0.1 s  COPY server.mjs ./
rebuild times: 2.1, 1.9, 2 s (median 2 s)
```

**Note:** The install step is CACHED. Only the code layer was rebuilt.

## Step 3

**Command**

```sh
npm install eslint@9.20.0 && docker build -t dkr-c5-p1-app:test .   (three different version bumps)
```

**Output**

```text
[1/5]   0.2 s  FROM docker.io/library/node:24-alpine@sha256:8a32c8cf649a499
[2/5] CACHED   WORKDIR /app
[3/5]   0.1 s  COPY package.json package-lock.json ./
[4/5]   2.9 s  RUN --mount=type=cache,target=/root/.npm,id=dkr-c5-npm npm c
[5/5]   0.1 s  COPY server.mjs ./
rebuild times: 14.3, 8.1, 8.3 s (median 8.3 s)
```

**Note:** A new dependency list must install again. A cache mount only saves the download.

## Step 4

**Command**

```sh
the same three dependency changes, with the --mount option taken out of the RUN line
```

**Output**

```text
with your Dockerfile:      14.3, 8.1, 8.3 s (median 8.3 s)
without a cache mount:     11.3, 14.6, 19 s (median 14.6 s)
```

**Note:** The cache mount saved about 6.3 s per dependency change here. It saves the download, not the unpack, so the saving depends on your network.
