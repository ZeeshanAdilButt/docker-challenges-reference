# Results: Challenge 14, part 2: pipeline and ship it

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, production host engine 29.9.3, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
grep -nE "uses:|permissions|pull_request|push:|password:|cache-|target:" .github/workflows/ship.yml   (first lines)
```

**Output**

```text
 13: pull_request:            # NOT pull_request_target: that one runs fork code with your secrets
 15: push:
 19: permissions: {}            # nothing by default; each job asks for what it needs
 29: permissions:
 38: uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 41: uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
 43: uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
 50: uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
 57: uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
 64: uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
 67: target: test
 68: push: false
... (7 lines left out)
 89: cache-from: type=gha,scope=api
 90: cache-to: type=gha,scope=api,mode=max
 93: uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
 96: push: ${{ github.event_name != 'pull_request' }}
101: cache-from: type=gha,scope=worker
102: cache-to: type=gha,scope=worker,mode=max
105: uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
108: push: ${{ github.event_name != 'pull_request' }}
113: cache-from: type=gha,scope=web
114: cache-to: type=gha,scope=web,mode=max
116: if: github.event_name != 'pull_request'
124: permissions:
```

**Note:** Pinned actions, narrow permissions, no push from a pull request, a layer cache and all three images. The GitHub run is your own.

## Step 2

**Command**

```sh
docker run -d --name dkr-c14-prod --privileged --memory 6g --pids-limit 1024 --tmpfs /var/lib/docker:size=4500m docker:29-dind ...
docker --context dkr-c14-prod info --format "engine {{.ServerVersion}}"
```

**Output**

```text
engine 29.9.3   privileged: true   socket mounted: false
registry at dkr-c14-registry:5000 (inside), 127.0.0.1:63545 (from here)
```

**Note:** The same single privileged Docker-in-Docker host as challenge 13, named for this challenge. Everything you deploy lands here.

## Step 3

**Command**

```sh
local pipeline for api, worker, web   stages lint > build > test > scan > sbom > push > sign   tags ["sha","version"]
```

**Output**

```text
api
  lint   ok         0.6 s  docker build --check: no warnings
  build  ok         1.3 s  built api:build-1111111
  test   ok         1.3 s  tests passed (result reused from the layer cache)
  scan   ok         9.3 s  scan ok scanner=trivy-0.76.1 secrets=0 critical_fixable=0 high_fixable=6 total=19 os=alpin
  sbom   ok         6.2 s  sbom ok format=SPDX-2.3 packages=181 sha256=edc1963181ed seconds=6.2
  push   ok         5.3 s  pushed sha-1111111, 1.0.0 -> 0c1225105d0f
  sign   ok         4.6 s  sign ok digest=sha256:0c1225105d0f verified=true key=throwaway seconds=4.5
worker
  lint   ok         0.5 s  docker build --check: no warnings
  build  ok         0.9 s  built worker:build-1111111
  scan   ok         7.2 s  scan ok scanner=trivy-0.76.1 secrets=0 critical_fixable=0 high_fixable=2 total=194 os=debi
  sbom   ok         4.6 s  sbom ok format=SPDX-2.3 packages=89 sha256=35977289be11 seconds=4.5
  push   ok         1.4 s  pushed sha-1111111, 1.0.0 -> 7078a20d3cca
  sign   ok         4.6 s  sign ok digest=sha256:7078a20d3cca verified=true key=throwaway seconds=4.5
web
  lint   ok         0.5 s  docker build --check: no warnings
  build  ok         1.1 s  built web:build-1111111
  scan   ok         7.2 s  scan ok scanner=trivy-0.76.1 secrets=0 critical_fixable=0 high_fixable=0 total=0 os=alpine
  sbom   ok         7.9 s  sbom ok format=SPDX-2.3 packages=69 sha256=5b8d024ce9fa seconds=7.8
  push   ok         3.8 s  pushed sha-1111111, 1.0.0 -> 20bfcdd4f5ef
  sign   ok         4.4 s  sign ok digest=sha256:20bfcdd4f5ef verified=true key=throwaway seconds=4.3
```

**Note:** Every service passed every stage, including scan, SBOM and sign, which ran the tools of challenge 12. The digests are in the registry.

## Step 4

**Command**

```sh
docker --context dkr-c14-prod compose -p daftar-data -f data.compose.yaml up -d --wait   (the database)
DIGEST_API=... DIGEST_WORKER=... DIGEST_WEB=... docker --context dkr-c14-prod compose -p daftar-blue -f compose.prod.yaml up -d --wait
```

**Output**

```text
database ready in 7.6 s; first deploy of version 1 in 8.4 s
api     running 0c1225105d0f   pushed 0c1225105d0f   same
worker  running 7078a20d3cca   pushed 7078a20d3cca   same
web     running 20bfcdd4f5ef   pushed 20bfcdd4f5ef   same
first job through the web page on the host: done
```

**Note:** The host runs exactly the three digests the pipeline pushed, and the system works there.

## Step 5

**Command**

```sh
repeat 3 times:  deploy version 1;  roll out version 2 under load;  roll back to version 1 by digest under load
```

**Output**

```text
rollout:  10.4 s (median)   requests 5455   failed 0   both versions answered: true
rollback: 10.6 s (median; target under 120 s)   failed during rollback 0   back on the version 1 digests: true
```

**Note:** The new colour had to report healthy (all three services) before the proxy moved, so no request failed, in either direction. A rollback is a deploy of older digests that the host already has.

## Step 6

**Command**

```sh
docker compose -f compose.prod.yaml config --format json   (read: image, healthcheck, limits, restart, secrets)
```

**Output**

```text
images named by digest: true   secret written in the file: false
health checks 3 of 3   memory limits 3 of 3   restart policy 3 of 3
```

**Note:** The same things a reviewer checks by eye, counted.
