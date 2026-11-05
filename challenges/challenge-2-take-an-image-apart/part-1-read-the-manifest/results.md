# Results: Challenge 2, part 1: read an image with your own code

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -t dkr-c2-demo:1 .  &&  docker save -o image.tar dkr-c2-demo:1
```

**Output**

```text
image.tar is 3867648 bytes and holds 10 files:
  blobs/sha256/0ea0a53a7afa0c6b82f8627454b9fb397cf7e533428299ada905603a367fdf3a  (141 bytes)
  blobs/sha256/5e9b4a97f6395abf54a5c584be133078deb2295e280dd0b9e77638874d07b637  (3852227 bytes)
  blobs/sha256/749517f620205eda721527823df98fff079922c0eb473dbdb8e3ab9f771746e6  (1232 bytes)
  blobs/sha256/7805ba68213df625279a0df8d9ce39edc3922e7480d8f0bab33456bcb52726aa  (2055 bytes)
  blobs/sha256/7b52a99efe69e29dfd7753455b6f758f2b4022d64604bc8e36ec57074966cc81  (93 bytes)
  blobs/sha256/876fb7bcf14c62395522177b6f1fc1aeddba45084a3bdf52686af90e39a4dd31  (168 bytes)
  blobs/sha256/b7eafff9c5d0ca9fa3db7f164faed76e1a0646d63ffa62222205560c6ee5d754  (190 bytes)
  index.json  (448 bytes)
  manifest.json  (532 bytes)
  oci-layout  (30 bytes)
```

**Note:** A saved image is just a tar of small files: an index, a manifest, a config and one blob per layer. Blob names are digests.

## Step 2

**Command**

```sh
readImage(entries)   # your code in readimage.mjs
```

**Output**

```text
manifest 749517f62020   config 7805ba68213d   linux/amd64
5 layers:
  layer 0  5e9b4a97f639   3852227 bytes packed  diffId 54ea9baa1bbd  oci.image.layer.v1.tar+gzip
  layer 1  7b52a99efe69        93 bytes packed  diffId deab74922814  oci.image.layer.v1.tar+gzip
  layer 2  b7eafff9c5d0       190 bytes packed  diffId f3fa700cdc7c  oci.image.layer.v1.tar+gzip
  layer 3  0ea0a53a7afa       141 bytes packed  diffId 1bd63dfbd3e4  oci.image.layer.v1.tar+gzip
  layer 4  876fb7bcf14c       168 bytes packed  diffId 54a61b54e403  oci.image.layer.v1.tar+gzip
```

**Note:** index.json points to the manifest, the manifest to the config and the layers. Each step is a digest, so nothing can change without changing the name.

## Step 3

**Command**

```sh
config.history   # one line per Dockerfile step
```

**Output**

```text
   0  LAYER     ADD alpine-minirootfs-3.23.7-x86_64.tar.gz /
   1  no layer  CMD ["/bin/sh"]
   2  no layer  LABEL dkr.challenge=2
   3  LAYER     WORKDIR /app
   4  no layer  ENV GREETING=hello from layer land
   5  LAYER     COPY notes.txt /app/notes.txt
   6  LAYER     RUN /bin/sh -c echo "step one" > /app/one.txt
   7  LAYER     RUN /bin/sh -c echo "step two" > /app/two.txt && echo "step three" > /
   8  no layer  CMD ["cat" "/app/notes.txt"]
9 steps, 4 made no layer, 5 made a layer
```

**Note:** ENV, LABEL and CMD only change the config. Steps that write files make layers. Layers in the manifest equal steps with LAYER.

## Step 4

**Command**

```sh
findBadDigests(entries)  and  findBadDigests(<one bit flipped in layer 0>)
```

**Output**

```text
good image:      0 bad digests, 0 bad diffIds
one bit flipped: 1 bad digest -> 5e9b4a97f639
```

**Note:** A digest is the hash of the bytes. Change one bit in a 3.9 MB layer and the name no longer matches.

## Step 5

**Command**

```sh
docker image inspect dkr-c2-demo:1 --format "{{.Id}} {{.Size}} {{json .RootFS.Layers}}"
```

**Output**

```text
Id          sha256:749517f62020...  = the manifest digest
RootFS.Layers equal your diffIds: true
Size        12986090 bytes (unpacked, on disk)
your layers 3852819 bytes (packed, what a pull downloads)
```

**Note:** This Docker uses the containerd image store, so the image ID is the manifest digest. With the older store the ID is the config digest. Packed (download) and unpacked (disk) differ: always say which one you mean.

## Step 6

**Command**

```sh
node toolkit/cleanup.mjs 2  and  docker image rm dkr-c2-demo:1
```

**Output**

```text
Still labelled dkr.challenge=2: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone, including the image tag.
