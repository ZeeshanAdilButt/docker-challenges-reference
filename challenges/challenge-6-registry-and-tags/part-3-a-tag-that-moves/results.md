# Results: Challenge 6, part 3: a tag that moves

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker push <registry>/dkr-c6/daftar-api:1.4   then on server A:  docker run <registry>/dkr-c6/daftar-api@sha256:57b9be86b236...
```

**Output**

```text
tag 1.4 -> 57b9be86b236
server A answers version 1.4.0
```

**Note:** Server A runs release 1.4.

## Step 2

**Command**

```sh
docker push <registry>/dkr-c6/daftar-api:1.4   (a hotfix, same tag)
```

**Output**

```text
tag 1.4 before: 57b9be86b236
tag 1.4 after:  3b49ae2942d7
old digest still in the registry: true
```

**Note:** The tag moved. The old bytes are still stored under their digest.

## Step 3

**Command**

```sh
docker inspect --format ... on both servers, and GET / on both
```

**Output**

```text
server A: version 1.4.0, image 57b9be86b236, revision aaa1111
server B: version 1.4.0, image 57b9be86b236, revision aaa1111
```

**Note:** Both servers run the same bytes.

## Step 4

**Command**

```sh
deploy 1.5 (it breaks), then roll back to the release before it
```

**Output**

```text
rolled back to version 1.4.0, healthy: true
rollback times: 2.1, 2, 1.7 s (median 2 s)
```

**Note:** Rollback is one deploy of a digest you already know. It does not need a build.
