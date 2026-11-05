# Results: Challenge 5, part 3: multi-platform (check only)

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker buildx bake --print -f challenges/challenge-5-fast-builds/part-3-multi-platform/docker-bake.hcl app
```

**Output**

```text
{
  "context": "build-ctx",
  "dockerfile": "Dockerfile",
  "platforms": [
    "linux/amd64",
    "linux/arm64"
  ],
  "tags": [
    "daftar-api:dev"
  ]
}
```

**Note:** One target, two platforms. bake --print shows what would be built and builds nothing.

## Step 2

**Command**

```sh
docker buildx bake --print -f challenges/challenge-5-fast-builds/part-3-multi-platform/docker-bake.hcl app-local
```

**Output**

```text
target app-local: one platform, output type=docker
```

**Note:** A second target loads one platform into the local Docker for a quick check.

## Step 3

**Command**

```sh
grep -E "uses:|platforms:" workflow/multiplatform.yml
```

**Output**

```text
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
uses: docker/setup-qemu-action@99012661954931238ded8c8b007157a8430204e1 # v4.4.0
uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
platforms: linux/amd64,linux/arm64
```

**Note:** QEMU is set up, and the build asks for arm64. The GitHub run is your own and is not recorded here.

## Step 4

**Command**

```sh
docker buildx inspect | grep Platforms    and    docker buildx imagetools inspect --raw node:24-alpine
```

**Output**

```text
this builder can build for 9 platforms
node:24-alpine ships for 3: linux/amd64, linux/arm64/v8, linux/s390x
```

**Note:** One tag, many platforms: the tag points at an index, and each platform has its own manifest.
