# Results: Challenge 4, part 3: a reproducible build

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker buildx build --no-cache --output type=oci,rewrite-timestamp=true,dest=a.tar .
```

**Output**

```text
image digest sha256:9a605441bd6c9f7fb62988a306ad5e9a4260f39783d461812c2a899602e11ced
layers 6
```

**Note:** First build.

## Step 2

**Command**

```sh
touch package.json server.mjs && docker buildx build --no-cache --output type=oci,rewrite-timestamp=true,dest=b.tar .
```

**Output**

```text
image digest sha256:9a605441bd6c9f7fb62988a306ad5e9a4260f39783d461812c2a899602e11ced
layers 6
```

**Note:** Second build: same content, files touched, a second later.

## Step 3

**Command**

```sh
compare the two images (digest, config, layers)
```

**Output**

```text
image digest   SAME   9a605441bd6c 9a605441bd6c
config         same
layer 1        same        ADD alpine-minirootfs-3.24.3-x86_64.tar.gz / # build
layer 2        same        RUN /bin/sh -c addgroup -g 1000 node && adduser -u 1
layer 3        same        RUN /bin/sh -c apk add --no-cache --virtual .build-d
layer 4        same        COPY docker-entrypoint.sh /usr/local/bin/ # buildkit
layer 5        same        WORKDIR /app
layer 6        same        COPY package.json server.mjs ./ # buildkit
```

**Note:** Same files in, same image out.

## Step 4

**Command**

```sh
FROM dkr-c4-base:moving   versus   FROM dkr-c4-base@sha256:...   (build, move the tag, build again)
```

**Output**

```text
FROM tag     before c1f06b565791   after 62f0436b06a4   DIFFERENT
FROM digest  before c1f06b565791   after c1f06b565791   same
```

**Note:** Same Dockerfile, same source, same flags. Only the base under the tag changed. The digest pin did not move.
