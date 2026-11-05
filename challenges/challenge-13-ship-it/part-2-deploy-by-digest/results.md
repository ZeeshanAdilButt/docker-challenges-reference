# Results: Challenge 13, part 2: deploy by digest

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, production host engine 29.9.3, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker run -d --name dkr-c13-prod --privileged --memory 3g --pids-limit 1024 --tmpfs /var/lib/docker:size=2000m docker:29-dind ...
docker --context dkr-c13-prod info --format "engine {{.ServerVersion}}, name {{.Name}}, storage {{.Driver}}"
```

**Output**

```text
engine 29.9.3, name b716fb610406, storage overlayfs
privileged: true   socket mounted: false
started in 3.1 s
```

**Note:** A second Docker engine, in a container, reached through a Docker context over TLS. It is the only privileged container in this course. Everything you deploy lands here, and nothing touches your own containers.

## Step 2

**Command**

```sh
GET /v2/dkr-c13/api/manifests/<tag>   for 1.0.0, 2.0.0, 3.0.0 and latest
```

**Output**

```text
1.0.0   084dc38500af
2.0.0   a1713d0e10c3   <- the version you want to deploy
3.0.0   5eea143c8645   <- another merge finished first
latest  5eea143c8645
```

**Note:** You tested and approved 2.0.0. While you were getting ready to deploy, another change was pushed. "latest" now names 3.0.0, an image nobody tested together with your change.

## Step 3

**Command**

```sh
DIGEST=084dc38500af... docker --context dkr-c13-prod compose -p daftar-blue -f compose.prod.yaml up -d --wait
docker --context dkr-c13-prod ps --format "{{.Names}}  {{.Image}}  {{.Status}}"
```

**Output**

```text
daftar-blue-api-1  dkr-c13-registry:5000/dkr-c13/api  Up 5 seconds (healthy)
edge-proxy  nginx:1.27-alpine  Up 16 seconds
```

**Note:** The first deploy took 6.7 s, including the image pull from the registry. "Up (healthy)" appears only if your compose file has a health check.

## Step 4

**Command**

```sh
roll out version 2 while load runs, with a compose file that has NO health check (the control)
```

**Output**

```text
rollout took 3.4 s
requests: 572   failed: 64   (503 from a copy still warming up: 64, refused 0, reset 0)
answers from version 1: 69, from version 2: 122
```

**Note:** "up --wait" returned when the container was running, not when it was ready. nginx switched to a copy that was still warming up, and some requests failed.

## Step 5

**Command**

```sh
roll out version 2 while load runs, with YOUR compose.prod.yaml   (3 trials, median)
```

**Output**

```text
rollout took 7.3 s (median)
requests over 3 trials: 1728   failed: 0
answers from version 1: 70, from version 2: 122 (last trial)
```

**Note:** Not one request failed. The new copy had to report healthy before nginx moved to it, and the old copy was stopped only after a short drain. Both versions served traffic, so the swap really happened.

## Step 6

**Command**

```sh
docker --context dkr-c13-prod inspect daftar-green-api-1 --format "{{.Config.Image}}"
docker --context dkr-c13-prod image inspect <image> --format "{{json .RepoDigests}}"
```

**Output**

```text
image reference:  <registry>/dkr-c13/api@sha256:a1713d0e10c37375ed4fa1a4bf077e78fa39c279c2fc5ac0b3cc0b6ab917616c
running digest:   a1713d0e10c3
intended digest:  a1713d0e10c3   (2.0.0)
latest digest:    5eea143c8645   (3.0.0)
```

**Note:** The host runs exactly the image you tested. A digest cannot move, so the tag race could not touch it.

## Step 7

**Command**

```sh
grep API_TOKEN compose.prod.yaml
docker --context dkr-c13-prod image history --no-trunc <image> | grep -c <the token>
docker --context dkr-c13-prod inspect daftar-green-api-1 --format "mem {{.HostConfig.Memory}} pids {{.HostConfig.PidsLimit}} health {{.State.Health.Status}}"
```

**Output**

```text
compose file:       API_TOKEN: ${API_TOKEN:?set API_TOKEN when you deploy}
token in the image: no
token in the running container: yes, the value the deploy passed in
limits and health:  memory 128 MB, processes 100, health healthy
```

**Note:** The secret is written nowhere in the repository or the image. It lives in the environment of whoever deploys, and reaches the container at run time. (docker inspect still shows it to anyone who can talk to the host: an environment variable is not a vault.)
