# Results: Challenge 4, part 2: non-root with a read-only root

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -t dkr-c4-p2-app:test .
```

**Output**

```text
#2 [internal] load metadata for docker.io/library/node:24-alpine
#3 [internal] load .dockerignore
#4 [internal] load build context
#5 [1/4] FROM docker.io/library/node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
#4 [internal] load build context
#6 [2/4] WORKDIR /app
#7 [3/4] COPY package.json server.mjs probe.mjs ./
#8 [4/4] RUN mkdir /app/data && chown 10001:10001 /app/data
```

**Note:** Built from your Dockerfile.

## Step 2

**Command**

```sh
docker run --rm --user 0:0 -v dkr-c4-p2-data:/app/data dkr-c4-p2-app:test node probe.mjs
```

**Output**

```text
user 0:0, powers (capabilities) 14, writable 6 of 6
  /app            ok
  /app/data       ok
  /tmp            ok
  /etc            ok
  /usr/local/bin  ok
  /               ok
```

**Note:** Baseline: this is what a process that breaks out of your app can do when the container runs as root with no extra flags.

## Step 3

**Command**

```sh
docker run --rm --read-only --cap-drop ALL -v dkr-c4-p2-data:/app/data dkr-c4-p2-app:test node probe.mjs
```

**Output**

```text
user 10001:10001, powers (capabilities) 0, writable 2 of 6
  /app            EROFS
  /app/data       ok
  /tmp            ok
  /etc            EROFS
  /usr/local/bin  EROFS
  /               EROFS
```

**Note:** Yours: the same image with your user and your flags.

## Step 4

**Command**

```sh
docker exec dkr-c4-app sh -c 'grep -E "^(Uid|CapEff):" /proc/1/status'
```

**Output**

```text
Uid:	10001	10001	10001	10001
CapEff:	0000000000000000
read-only root filesystem: true
/health answered: true
```

**Note:** The service runs as uid 10001, not root.

## Step 5

**Command**

```sh
docker run --rm --user 10001:10001 [--sysctl net.ipv4.ip_unprivileged_port_start=1024] dkr-c4-p2-app:test node probe.mjs
```

**Output**

```text
default settings:        port 80 -> ok, port 8080 -> ok
sysctl start at 1024:    port 80 -> EACCES, port 8080 -> ok
```

**Note:** Docker lets a non-root user open port 80 by default. Other runtimes may not, so build the image to listen above 1024.
