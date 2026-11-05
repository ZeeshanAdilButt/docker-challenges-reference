# Results: Challenge 2, part 4: size forensics

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -f Dockerfile.fat -t dkr-c2-fat:1 context/ && docker save -o fat.tar dkr-c2-fat:1   then   layerReport(fat.tar)
```

**Output**

```text
runs: daftar ok | app.mjs bytes: 1527
6 layers, 83.9 MB packed, 88.4 MB unpacked:
  layer 0    3.85 MB packed    8.42 MB unpacked  ADD alpine-minirootfs-3.23.7-x86_64.tar.gz /
  layer 1       0 MB packed       0 MB unpacked  WORKDIR /app
  layer 2   30.01 MB packed      30 MB unpacked  COPY . /app
  layer 3   30.01 MB packed      30 MB unpacked  RUN /bin/sh -c chown -R 1000:1000 /app
  layer 4   20.01 MB packed      20 MB unpacked  RUN /bin/sh -c head -c 20000000 /dev/urandom > /var/cac
  layer 5       0 MB packed       0 MB unpacked  RUN /bin/sh -c rm /var/cache/build.tmp
```

**Note:** The app is a few hundred bytes of text. The image is dozens of megabytes. Every layer is listed with both sizes: packed is the download, unpacked is the disk.

## Step 2

**Command**

```sh
biggestLayers(fat.tar, 3)   and   wastedBytes(fat.tar)
```

**Output**

```text
biggest: layer 2 (30 MB), layer 3 (30 MB), layer 4 (20 MB)
wasted:  50 MB of 88.4 MB  (57 percent)
  replaced in a later layer: 30 MB   deleted in a later layer: 20 MB
  layer 5 deleted     20 MB  var/cache/build.tmp
  layer 3 replaced    18 MB  app/fixtures/sample-video.bin
  layer 3 replaced    12 MB  app/.git/objects/pack/pack-0001.pack
  layer 3 replaced     0 MB  app/src/app.mjs
  layer 3 replaced     0 MB  app/run.sh
```

**Note:** Wasted bytes are shipped and pulled but can never be seen. Two causes: chown -R after COPY copies every file again, and rm in a later step only hides a file.

## Step 3

**Command**

```sh
docker build -f Dockerfile.slim -t dkr-c2-slim:1 context/   then   docker run --rm dkr-c2-slim:1   and   wastedBytes(slim.tar)
```

**Output**

```text
runs: daftar ok | app.mjs bytes: 1527
user 1000, files in /app: run.sh src
packed:   fat 83.9 MB, slim 3.9 MB
unpacked: fat 88.4 MB, slim 8.4 MB  (90 percent smaller)
wasted in slim: 0 MB
```

**Note:** Same output, same user, a fraction of the size. The big wins came from what was never sent (.dockerignore), not from compressing.

## Step 4

**Command**

```sh
node toolkit/cleanup.mjs 2  and  docker image rm dkr-c2-fat:1 dkr-c2-slim:1
```

**Output**

```text
Still labelled dkr.challenge=2: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone, including both image tags.
