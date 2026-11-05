# Results: Challenge 3, part 1: review and fix five Dockerfiles

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
node review.mjs faults/<each Dockerfile>
```

**Output**

```text
01-unpinned-root
   line 2: base-not-pinned
   line 2: runs-as-root
02-cache-buster
   line 4: copy-all-before-install
   line 4: no-dockerignore
03-leaky-env
   line 4: secret-in-env
04-add-and-shell
   line 4: add-for-local-files
   line 9: shell-form
05-no-ignore
   line 6: no-dockerignore
```

**Note:** Five Dockerfiles, one main fault each. The reviewer reads the file; it does not run anything.

## Step 2

**Command**

```sh
docker build --check -f faults/<each>/Dockerfile .
```

**Output**

```text
01-unpinned-root     0 warning(s) 
02-cache-buster      0 warning(s) 
03-leaky-env         1 warning(s) SecretsUsedInArgOrEnv
04-add-and-shell     1 warning(s) JSONArgsRecommended
05-no-ignore         0 warning(s)
```

**Note:** BuildKit has built-in rules. They catch some faults (a secret in ENV, shell-form CMD) and miss others (a bad COPY order, running as root, an unpinned tag).

## Step 3

**Command**

```sh
build each original and test the property its fault was about
```

**Output**

```text
01-unpinned-root     FAIL base image node:latest is not on this machine, so the build is skipped. Use node:24-alpine.
02-cache-buster      FAIL after a code change the npm ci step was run again; rebuild took 7.4 s (median of 3)
03-leaky-env         FAIL secret in docker inspect Env: true; in docker history: true
04-add-and-shell     FAIL the node process is PID 38 (a shell or npm is PID 1 and does not pass signals on)
05-no-ignore         FAIL these should not be in the image: .env.local, notes, test.mjs
```

**Note:** The originals that can be built all run and answer /health. Every one of them works, and every one is a problem waiting for a bad day. (01 is not built: its base image is not on this machine.)

## Step 4

**Command**

```sh
review, docker build --check, build and test, for dockerfiles/<each>/Dockerfile (your fixes)
```

**Output**

```text
01-unpinned-root     reviewer 0  check 0  ok   user id 1000; base image pinned
02-cache-buster      reviewer 0  check 0  ok   after a code change the npm ci step was CACHED; rebuild took 5.9 s (median of 3)
03-leaky-env         reviewer 0  check 0  ok   secret in docker inspect Env: false; in docker history: false
04-add-and-shell     reviewer 0  check 0  ok   the node process is PID 1
05-no-ignore         reviewer 0  check 0  ok   no env file, notes or tests in /app
```

**Note:** After the fixes: no reviewer findings, no warnings, and each property holds.

## Step 5

**Command**

```sh
node toolkit/cleanup.mjs 3  and  docker image rm <the images this part built>
```

**Output**

```text
Still labelled dkr.challenge=3: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone, including the image tags.
