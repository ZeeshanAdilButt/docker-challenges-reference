# Results: Challenge 6, part 1: run your own registry

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker run -d -p 127.0.0.1:56674:5000 -v dkr-c6-registry-data:/var/lib/registry -e REGISTRY_STORAGE_DELETE_ENABLED=true registry:3   then   curl -i http://127.0.0.1:<port>/v2/
```

**Output**

```text
published as 127.0.0.1:56674
HTTP 200
docker-distribution-api-version: registry/2.0
image registry:3: 86.6 MB unpacked
```

**Note:** A registry is one container that answers HTTP on /v2/. It listens only on this machine.

## Step 2

**Command**

```sh
docker push 127.0.0.1:56674/dkr-c6/hello:1   then   docker push 127.0.0.1:56674/dkr-c6/hello:2
```

**Output**

```text
first push:  4 blobs stored, 3932 KB on disk
--- second push output ---
The push refers to repository [<registry>/dkr-c6/hello]
5e9b4a97f639: Layer already exists
989ddba3897f: Pushed
2: digest: sha256:700ea923cbd4ed9eaa9578b4ae2322789377b5ff46256ca87883c9a16ada7409 size: 668
after the second push: 7 blobs, 4020 KB
```

**Note:** The second image reused 1 layer(s) that the registry already had. Shared layers are stored once.

## Step 3

**Command**

```sh
docker image rm 127.0.0.1:56674/dkr-c6/hello:1   then   docker pull 127.0.0.1:56674/dkr-c6/hello:1
```

**Output**

```text
1: Pulling from dkr-c6/hello
da82efb10e76: Pulling fs layer
5e9b4a97f639: Pulling fs layer
da82efb10e76: Already exists
... (3 lines left out)
Digest: sha256:c64a56b392f4c5f8bb6b7ae408b2665e3d9da37ed83c5ec63610cee05fbedd09
Status: Downloaded newer image for <registry>/dkr-c6/hello:1
<registry>/dkr-c6/hello:1
pull times: 0.6, 0.8, 0.6 s (median 0.6 s)
```

**Note:** A pull from a registry on this machine is fast. The numbers show the steps, not the speed of the internet.

## Step 4

**Command**

```sh
docker rm -f <registry>   then start a new container with the same flags   then   curl http://127.0.0.1:<port>/v2/_catalog
```

**Output**

```text
{"repositories":["dkr-c6/hello"]}
```

**Note:** The images are still there: the data lives in a volume, not in the container.
