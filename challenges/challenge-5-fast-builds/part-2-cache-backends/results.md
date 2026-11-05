# Results: Challenge 5, part 2: cache backends on a cold runner

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
grep -E "uses:|cache-from|cache-to" workflow/build.yml
```

**Output**

```text
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
cache-from: type=gha,scope=daftar-api
cache-to: ${{ github.event_name == 'push' && 'type=gha,scope=daftar-api,mode=max' || '' }}
```

**Note:** All 3 actions are pinned to a full commit SHA. The GitHub run is your own: this machine cannot run Actions.

## Step 2

**Command**

```sh
docker buildx build --builder <fresh> .   (no cache flags, new runner each time)
```

**Output**

```text
[build 1/6] 8.2 s  FROM docker.io/library/node:24-alpine@sha256:8a32c
[build 2/6] 3.4 s  WORKDIR /app
[build 3/6] 0.4 s  COPY package.json package-lock.json ./
[build 4/6] 5.3 s  RUN npm ci
[build 5/6] 0.2 s  COPY server.mjs ./
[build 6/6] 0.3 s  RUN node --check server.mjs && mkdir dist && cp se
[stage-1 3/5] 0.9 s  COPY --from=build /app/node_modules ./node_modules
[stage-1 4/5] 0.2 s  COPY --from=build /app/dist ./
[stage-1 5/5] 0.1 s  COPY package.json ./
three runs: 22.1, 22.3, 23.5 s (median 22.3 s)
```

**Note:** A cold runner reinstalls everything on every push.

## Step 3

**Command**

```sh
docker buildx build --builder <fresh> --cache-to type=local,dest=<dir>,mode=max --cache-from type=local,src=<dir> .
```

**Output**

```text
[build 1/6] 0.1 s  FROM docker.io/library/node:24-alpine@sha256:8a32c
[build 2/6] CACHED  WORKDIR /app
[build 3/6] CACHED  COPY package.json package-lock.json ./
[build 4/6] CACHED  RUN npm ci
[build 5/6] 2.2 s  COPY server.mjs ./
[build 6/6] 1.1 s  RUN node --check server.mjs && mkdir dist && cp se
[stage-1 3/5] CACHED  COPY --from=build /app/node_modules ./node_modules
[stage-1 4/5] 1.3 s  COPY --from=build /app/dist ./
[stage-1 5/5] 0.2 s  COPY package.json ./
three runs: 27.2, 22.8, 28.5 s (median 27.2 s). Cache folder: 117.3 MB
```

**Note:** The install step comes from the imported cache.

## Step 4

**Command**

```sh
docker buildx build --builder <fresh> --cache-to type=registry,ref=<registry>/dkr-c5-cache:main,mode=max --cache-from type=registry,ref=<registry>/dkr-c5-cache:main .
```

**Output**

```text
[build 1/6] 0.6 s  FROM docker.io/library/node:24-alpine@sha256:8a32c
[build 2/6] CACHED  WORKDIR /app
[build 3/6] CACHED  COPY package.json package-lock.json ./
[build 4/6] CACHED  RUN npm ci
[build 5/6] 1.2 s  COPY server.mjs ./
[build 6/6] 0.2 s  RUN node --check server.mjs && mkdir dist && cp se
[stage-1 3/5] CACHED  COPY --from=build /app/node_modules ./node_modules
[stage-1 4/5] 0.4 s  COPY --from=build /app/dist ./
[stage-1 5/5] 0.2 s  COPY package.json ./
three runs: 23.9, 17.7, 18.5 s (median 18.5 s). Registry holds 112.5 MB
```

**Note:** The install step comes from the registry cache.

## Step 5

**Command**

```sh
docker buildx build --push -t <registry>/dkr-c5-inline:main --cache-from type=registry,ref=<same image> --cache-to type=inline .
```

**Output**

```text
[build 1/6] 0.1 s  FROM docker.io/library/node:24-alpine@sha256:8a32c
[build 2/6] CACHED  WORKDIR /app
[build 3/6] 0.9 s  COPY package.json package-lock.json ./
[build 4/6] 4.4 s  RUN npm ci
[build 5/6] 0.1 s  COPY server.mjs ./
[build 6/6] 0.2 s  RUN node --check server.mjs && mkdir dist && cp se
[stage-1 3/5] CACHED  COPY --from=build /app/node_modules ./node_modules
[stage-1 4/5] 1.6 s  COPY --from=build /app/dist ./
[stage-1 5/5] 1.1 s  COPY package.json ./
three runs: 18.4, 19.6, 20.5 s (median 19.6 s)
```

**Note:** Inline cache only keeps the layers of the final image, so the install stage ran again. Use a registry cache with mode=max to keep it.

## Step 6

**Command**

```sh
docker buildx build --builder <same builder> .   (a runner that keeps its disk)
```

**Output**

```text
three rebuilds: 1.8, 7.8, 3.1 s (median 3.1 s)
```

**Note:** Upper bound: layers on a disk that stays. Cache backends try to give a fresh runner this.

## Step 7

**Command**

```sh
summary of the medians
```

**Output**

```text
none       whole build  22.3 s   base image  8.5 s   npm install  5.1 s  
local      whole build  27.2 s   base image  0.1 s   npm install   CACHED
registry   whole build  18.5 s   base image  0.6 s   npm install   CACHED
inline     whole build  19.6 s   base image  0.1 s   npm install  5.8 s  
warm disk  whole build   3.1 s   base image    0 s   npm install   CACHED
```

**Note:** The whole build also pulls the base image into a fresh builder, and that time moves a lot from run to run. The npm install column is the part a cache can save.
