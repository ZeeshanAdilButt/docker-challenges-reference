# Results: Challenge 13, part 1: build, check, push

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
grep -nE "uses:|permissions|pull_request|push:|password:|needs:|target:" workflow/ship.yml
```

**Output**

```text
 12: pull_request:            # NOT pull_request_target: that one runs fork code with your secrets
 14: push:
 18: permissions: {}            # nothing by default; each job asks for what it needs
 28: permissions:
 35: uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 38: uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
 40: uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
 47: uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
 50: target: test
 51: push: false
 55: uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
 58: target: release
 64: uses: docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6 # v4.7.0
 65: if: github.event_name != 'pull_request'
 69: password: ${{ secrets.GITHUB_TOKEN }}
 72: uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
 75: target: release
 76: push: ${{ github.event_name != 'pull_request' }}
 84: if: github.event_name != 'pull_request'
 88: needs: build
 92: permissions:
```

**Note:** Every action is pinned to a full commit, permissions are narrow per job, nothing is pushed from a pull request, the built-in token is used and the deploy job gets a digest. The GitHub run is your own.

## Step 2

**Command**

```sh
local pipeline, commit a1b2c3d (good):  stages lint > build > test > scan > sbom > push > sign   tags ["sha","version"]
```

**Output**

```text
lint   ok         1.5 s  docker build --check: no warnings
build  ok         1.1 s  built api:build-a1b2c3d
test   ok         1.5 s  tests passed (result reused from the layer cache)
scan   ok         8.7 s  scan ok scanner=trivy-0.76.1 secrets=0 critical_fixable=0 high_fixable=6 total=19 os=alpine-3.24.3 seconds=8.5
sbom   ok           6 s  sbom ok format=SPDX-2.3 packages=167 sha256=3ac0b8b1b60e seconds=5.9
push   ok         1.7 s  pushed sha-a1b2c3d, 1.0.0 -> 558fc55b0cf4
sign   ok         7.4 s  sign ok digest=sha256:558fc55b0cf4 verified=true key=throwaway seconds=7.3
```

**Note:** The commit passed every stage. scan, sbom and sign ran the tools of challenge 12: the scanner pinned by digest, an SPDX SBOM, and a signature made with a throwaway key and checked before the stage ended. The image is in the registry as 558fc55b0cf4.

## Step 3

**Command**

```sh
local pipeline, commit badbadb (bad: /health now answers 500)
  then: GET /v2/dkr-c13/api/tags/list
```

**Output**

```text
lint   ok         0.6 s  docker build --check: no warnings
build  ok         0.9 s  built api:build-badbadb
test   failed       2 s  tests 3, pass 2, fail 1
scan   not run      0 s  stopped at test
sbom   not run      0 s  stopped at test
push   not run      0 s  stopped at test
sign   not run      0 s  stopped at test

tags in the registry: 1.0.0, sha-a1b2c3d, sha256-558fc55b0cf44db54efa4c2fa34f485656d1d0479b8563bd67e287865af15043
new images in the registry: 0
```

**Note:** The unit tests failed at "test" and nothing was pushed. A broken commit never reaches the registry.

## Step 4

**Command**

```sh
GET /v2/dkr-c13/api/manifests/<tag>   for each tag of the good commit
```

**Output**

```text
sha-a1b2c3d    558fc55b0cf4
1.0.0          558fc55b0cf4
```

**Note:** One image, several names. The sha tag says exactly which commit built it, and it is never moved.

## Step 5

**Command**

```sh
docker build --target release app   (3 times with --no-cache, 3 times with the layer cache; median of each)
```

**Output**

```text
cold (no cache): 2 s   [2.1, 2, 2]
warm (cache):    1.2 s   [1.2, 1.1, 1.2]
steps answered by the cache in a warm build: 3
```

**Note:** Unchanged layers come from the cache, so a build after a one-line change is fast. In GitHub Actions the layer cache is lost between runs unless you ask for one (cache-from and cache-to with type=gha).
