# Results: Challenge 8, part 2: the dev loop with Compose watch

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Compose 5.6.1, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker compose -p dkr-c8 -f variants/rebuild.yaml watch   (then edit app/src/message.mjs, 3 times)
```

**Output**

```text
19569 ms, 22907 ms, 12355 ms
```

**Note:** action: rebuild. Docker builds a new image and creates a new container for every change. Median 19569 ms.

## Step 2

**Command**

```sh
docker compose -p dkr-c8 -f variants/sync-restart.yaml watch   (then edit app/src/message.mjs, 3 times)
```

**Output**

```text
4004 ms, 5755 ms, 2746 ms
```

**Note:** action: sync+restart. The changed file is copied in and the container restarts. No build. Median 4004 ms.

## Step 3

**Command**

```sh
docker compose -p dkr-c8 -f variants/sync-watch.yaml watch   (then edit app/src/message.mjs, 3 times)
```

**Output**

```text
1046 ms, 915 ms, 899 ms
```

**Note:** action: sync, and the server runs with node --watch-path. The file is copied in and the same container restarts only the process. Median 915 ms.

## Step 4

**Command**

```sh
docker compose -p dkr-c8 -f variants/sync-only.yaml watch   (then edit app/src/message.mjs, 1 time)
```

**Output**

```text
the change never showed up (waited 6 s)
```

**Note:** action: sync and nothing that restarts the server. The file arrives but the running process never reads it.

## Step 5

**Command**

```sh
docker compose -p dkr-c8 -f compose.yaml watch   (then edit app/src/message.mjs 3 times, and app/package.json once)
```

**Output**

```text
1321 ms, 1134 ms, 1116 ms
package.json change rebuilt the image: true
```

**Note:** Your compose.yaml: a source edit shows up in 1134 ms (median of 3). A package.json edit rebuilds the image, as it should.
