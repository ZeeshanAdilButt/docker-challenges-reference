# Results: Challenge 2, part 2: a deleted secret is still in the image

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -f Dockerfile.leaky -t dkr-c2-leaky:1 context/ && docker run --rm dkr-c2-leaky:1 ; ls /app ; cat /app/prod.env
```

**Output**

```text
runs:       config checked: ok | service ready
ls /app:    app.sh warm.txt
cat prod.env: cat: can't open '/app/prod.env': No such file or directory (exit 1)
```

**Note:** From the outside the secret is gone: the file is not in /app and cat cannot find it. The Dockerfile deleted it on purpose.

## Step 2

**Command**

```sh
docker save -o leaky.tar dkr-c2-leaky:1   then   findInLayers(leaky.tar, <the secret>)   and   whiteouts(leaky.tar)
```

**Output**

```text
7 layers:
  layer 0   3852227 bytes packed   8418315 bytes unpacked  ADD alpine-minirootfs-3.23.7-x86_64.tar.gz /
  layer 1        93 bytes packed         0 bytes unpacked  WORKDIR /app
  layer 2       234 bytes packed       108 bytes unpacked  COPY config/prod.env /app/prod.env
  layer 3   3001162 bytes packed   3000000 bytes unpacked  COPY seed.bin /app/seed.bin
  layer 4       166 bytes packed        39 bytes unpacked  COPY app.sh /app/app.sh
  layer 5       155 bytes packed        19 bytes unpacked  RUN /bin/sh -c . /app/prod.env && [ -n "$DEMO_API_KEY" ] && 
  layer 6       148 bytes packed         0 bytes unpacked  RUN /bin/sh -c rm /app/prod.env /app/seed.bin
findInLayers: layer 2 file app/prod.env
whiteouts:    layer 6 hides app/prod.env; layer 6 hides app/seed.bin
```

**Note:** The step that copied the file made a layer that still holds it. The step that ran rm made a new, tiny layer with a whiteout note. The old layer was never touched.

## Step 3

**Command**

```sh
recoverFile(leaky.tar, 2, "app/prod.env")
```

**Output**

```text
recovered: DEMO_API_KEY="dkr-demo-fake-key-9e1b7c44-not-real"
the 3 MB file seed.bin was deleted too, and is still shipped: layer 3 is 3 MB packed
```

**Note:** Anyone who can pull the image can do this with tar. The secret is recovered in full, and the deleted data still costs download size.

## Step 4

**Command**

```sh
docker build -f Dockerfile.fixed -t dkr-c2-fixed:1 context/ && docker run --rm dkr-c2-fixed:1   then   findInLayers(fixed.tar, <the secret>)
```

**Output**

```text
runs:         config checked: ok | service ready
4 layers, findInLayers: nothing
whiteouts: 0   seed.bin shipped: false
packed:   leaky 6.85 MB, fixed 3.85 MB
unpacked: leaky 11.42 MB, fixed 8.42 MB
```

**Note:** Same behaviour, no secret in any layer, nothing deleted, and the image is smaller by the bytes that were only ever needed to build.

## Step 5

**Command**

```sh
node toolkit/cleanup.mjs 2  and  docker image rm dkr-c2-leaky:1 dkr-c2-fixed:1
```

**Output**

```text
Still labelled dkr.challenge=2: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone, including both image tags.
