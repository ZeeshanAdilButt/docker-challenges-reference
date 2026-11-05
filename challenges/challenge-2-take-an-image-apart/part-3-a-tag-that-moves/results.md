# Results: Challenge 2, part 3: a tag that moves, and a digest that does not

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker run -d -p 127.0.0.1:5149:5000 -v dkr-c2-registry-data:/var/lib/registry registry:3   then   curl http://127.0.0.1:5149/v2/_catalog
```

**Output**

```text
{"repositories":[]}
```

**Note:** A registry is a small web server with a few routes under /v2/. It holds blobs and manifests by digest, and a table of tags. It starts empty.

## Step 2

**Command**

```sh
docker push 127.0.0.1:5149/dkr-c2-app:stable  (and :1.0.0)   then   digestOf / listTags / layersOf   # your code
```

**Output**

```text
tags:      1.0.0, stable
stable  -> e3e13ab2a2be50ac
1.0.0   -> e3e13ab2a2be50ac
layers:    7, 62495630 bytes packed
```

**Note:** Two tags, one digest. A tag is a name in the registry's table. The digest is the hash of the manifest.

## Step 3

**Command**

```sh
docker run -d --name dkr-c2-server-a 127.0.0.1:5149/dkr-c2-app:stable   # pulls, then GET /
```

**Output**

```text
server A runs version 1.0.0 (image e3e13ab2a2be)
```

**Note:** Server A had no copy, so it pulled what stable meant at that moment.

## Step 4

**Command**

```sh
docker build --build-arg APP_VERSION=2.0.0 -t 127.0.0.1:5149/dkr-c2-app:stable .  &&  docker push ...:stable  (and :2.0.0)
```

**Output**

```text
tags:      1.0.0, 2.0.0, stable
stable  -> 96c7924bd2f1b29e   (was e3e13ab2a2be50ac)
1.0.0   -> e3e13ab2a2be50ac   (did not move)
2.0.0   -> 96c7924bd2f1b29e
layers:    7, of which 6 are the same as version 1
the two pushes said "already exists" 13 times; new layers: 1, 147 bytes packed (a full pull is 62495630)
```

**Note:** The tag moved: same name, new digest. The version tag did not. Almost all layers are shared, so an update downloads only what changed.

## Step 5

**Command**

```sh
docker run -d --name dkr-c2-server-b 127.0.0.1:5149/dkr-c2-app:stable   then   docker restart dkr-c2-server-a
```

**Output**

```text
server A: 127.0.0.1:5149/dkr-c2-app:stable  ->  version 1.0.0 (image e3e13ab2a2be), after a restart
server B: 127.0.0.1:5149/dkr-c2-app:stable  ->  version 2.0.0 (image 96c7924bd2f1)
```

**Note:** Two servers, the same tag in their config, two different programs running. A restart does not pull, so A stays on 1.0.0. Nobody changed any config.

## Step 6

**Command**

```sh
docker run -d --name dkr-c2-server-c 127.0.0.1:5149/dkr-c2-app@e3e13ab2a2be...
```

**Output**

```text
server C: version 1.0.0 (image e3e13ab2a2be), even though stable now means 2.0.0
```

**Note:** A digest cannot move: it is the hash of the content. Deploy by digest, keep the tag for humans.

## Step 7

**Command**

```sh
node toolkit/cleanup.mjs 2
```

**Output**

```text
Still labelled dkr.challenge=2: 0 containers, 0 networks, 0 volumes.
```

**Note:** The registry, its volume and the three servers are gone, and so are the image tags that started with 127.0.0.1.
