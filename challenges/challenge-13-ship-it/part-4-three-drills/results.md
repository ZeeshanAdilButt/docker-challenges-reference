# Results: Challenge 13, part 4: three drills

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, production host engine 29.9.3, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
kill -9 on the main process of daftar-blue-api-1   (sent from the host side, while load runs)
then poll GET /ready through the proxy every 100 ms (give up after 30 s)
```

**Output**

```text
restart policy: unless-stopped
restart count: 1
answering again after 3.5 s
requests during the drill: 636   failed: 113
```

**Note:** Docker started the service again by itself. The outage is the restart plus the warm-up, and the failed requests are what one copy costs: a restart policy bounds an outage, a second copy would remove it.

## Step 2

**Command**

```sh
docker stop dkr-c13-registry   then redeploy the same digest with compose up --wait   (pull_policy decides whether it asks the registry)
```

**Output**

```text
pull policy in the file: missing
redeploy: ok in 7.5 s
requests during the drill: 516   failed: 0
```

**Note:** The registry was gone and the deploy did not notice: the image was already on the host, named by digest, and the file did not ask to pull it again.

## Step 3

**Command**

```sh
deploy a release whose /ready never answers 200 (it passed its unit tests) while load runs, with compose up --wait
```

**Output**

```text
deploy result: refused after 11.3 s (container daftar-green-api-1 is unhealthy)
serving after the attempt: blue, version 1.0.0
requests during the drill: 322   failed: 0
```

**Note:** The health gate refused the bad copy after 11.3 s, and the old copy never stopped serving. Nobody noticed, which is the point.
