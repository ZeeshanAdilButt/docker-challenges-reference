# Results: Challenge 0, part 2: check Docker and the safety rules

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-04.

## Step 1

**Command**

```sh
docker pull alpine:3.23
```

**Output**

```text
Digest: sha256:ff7f0c727dd796aa36787bfcd9a64bf35a6ce72a73451b3359fde849b6703d63
Status: Image is up to date for alpine:3.23
docker.io/library/alpine:3.23
```

**Note:** The image was already here, so the check took 2.5 s. A first download takes longer.

## Step 2

**Command**

```sh
docker image inspect alpine:3.23 --format "{{.Size}}"
```

**Output**

```text
12934692
```

**Note:** 12934692 bytes is 12.9 MB. This is the whole download for this challenge.

## Step 3

**Command**

```sh
docker run --rm --name dkr-c0-hello --label dkr.challenge=0 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges alpine:3.23 sh -c "echo hello from a limited container; cat /sys/fs/cgroup/memory.max; cat /sys/fs/cgroup/pids.max"
```

**Output**

```text
hello from a limited container
67108864
50
```

**Note:** Docker holds this container to 64 MB of memory and 50 processes. One run took 1.53 s (median of 3).

## Step 4

**Command**

```sh
docker network create --label dkr.challenge=0 dkr-c0-net
```

**Output**

```text
b6b840273e785288b95ad40d474e6697cb3fc2a93867a216986e10ca5d717b70
```

**Note:** A network with our label. Docker prints its id.

## Step 5

**Command**

```sh
docker volume create --label dkr.challenge=0 dkr-c0-data
```

**Output**

```text
dkr-c0-data
```

**Note:** A volume with our label. Docker prints its name.

## Step 6

**Command**

```sh
docker run -d --name dkr-c0-sleeper --label dkr.challenge=0 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges --network dkr-c0-net -v dkr-c0-data:/data alpine:3.23 sleep 300
```

**Output**

```text
1322b86e3197663f396ed2abc5aabb6235a4621d4fc96dd83b1ed1bbbc392feb
```

**Note:** A container with our label, the safety limits, on our network and with our volume.

## Step 7

**Command**

```sh
docker volume create dkr-c0-unlabelled-demo
```

**Output**

```text
dkr-c0-unlabelled-demo
```

**Note:** A volume with NO label. It is our test: cleanup must leave it alone.

## Step 8

**Command**

```sh
docker ps -a --filter label=dkr.challenge=0 --format "table {{.Names}}\t{{.Status}}"
```

**Output**

```text
NAMES            STATUS
dkr-c0-sleeper   Up Less than a second
```

**Note:** The label finds our container.

## Step 9

**Command**

```sh
docker network ls --filter label=dkr.challenge=0 --format "table {{.Name}}\t{{.Driver}}"
```

**Output**

```text
NAME         DRIVER
dkr-c0-net   bridge
```

**Note:** It finds our network. Docker adds its own networks, but they have no label.

## Step 10

**Command**

```sh
docker volume ls --filter label=dkr.challenge=0 --format "table {{.Name}}\t{{.Driver}}"
```

**Output**

```text
VOLUME NAME   DRIVER
dkr-c0-data   local
```

**Note:** It finds our volume. The volume with no label is not in this list.

## Step 11

**Command**

```sh
node toolkit/cleanup.mjs 0
```

**Output**

```text
Removed for challenge 0: 1 containers, 1 networks, 1 volumes.
Still labelled dkr.challenge=0: 0 containers, 0 networks, 0 volumes.
```

**Note:** Cleanup removed 3 objects in 2.6 s. It used only the label.

## Step 12

**Command**

```sh
docker ps -a -q --filter label=dkr.challenge=0
```

**Output**

```text
(no container ids)
```

**Note:** Nothing with the label is left (0 objects in total).

## Step 13

**Command**

```sh
docker volume ls --filter name=dkr-c0-unlabelled-demo --format "table {{.Name}}\t{{.Driver}}"
```

**Output**

```text
VOLUME NAME              DRIVER
dkr-c0-unlabelled-demo   local
```

**Note:** The volume with no label is still here (1). Cleanup did not touch it.

## Step 14

**Command**

```sh
docker volume rm dkr-c0-unlabelled-demo
```

**Output**

```text
dkr-c0-unlabelled-demo
```

**Note:** You remove your own test volume by its full name. No wildcards, no prune.
