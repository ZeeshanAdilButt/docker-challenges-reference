# Results: Challenge 8, part 3: a CI integration test

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Compose 5.6.1, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
node ci.mjs   (normal run, first of 3; exit code 0)
```

**Output**

```text
$ docker build -q -t dkr-c8-stack:1 --label dkr.challenge=8 C:\dkc\challenges\challenge-8-compose-stack\stack
$ docker compose -p dkr-c8 -f C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\compose.yaml up -d --wait --wait-timeout 90
$ C:\nvm4w\nodejs\node.exe --test C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\integration.test.mjs
ok 1 - the api is ready: database and cache both answer
ok 2 - the api reports the version this pipeline is meant to test
ok 3 - a note is written to the database
ok 4 - jobs go through the cache and the worker into the database
# tests 4
# pass 4
# fail 0
$ docker compose -p dkr-c8 -f C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\compose.yaml down -v --remove-orphans
```

**Note:** 3 of 3 normal runs passed. The median run took 26.5 s, from build to clean-up. After a passing run 0 containers were left.

## Step 2

**Command**

```sh
API_START_DELAY_MS=12000 node ci.mjs   (exit code 0)
```

**Output**

```text
$ docker build -q -t dkr-c8-stack:1 --label dkr.challenge=8 C:\dkc\challenges\challenge-8-compose-stack\stack
$ docker compose -p dkr-c8 -f C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\compose.yaml up -d --wait --wait-timeout 90
$ C:\nvm4w\nodejs\node.exe --test C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\integration.test.mjs
ok 1 - the api is ready: database and cache both answer
ok 2 - the api reports the version this pipeline is meant to test
ok 3 - a note is written to the database
ok 4 - jobs go through the cache and the worker into the database
# tests 4
# pass 4
# fail 0
$ docker compose -p dkr-c8 -f C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\compose.yaml down -v --remove-orphans
```

**Note:** The api needed 12 s before it listened, and the pipeline waited for it. It waits for the health check, not for a guess.

## Step 3

**Command**

```sh
CI_EXPECT_VERSION=999 node ci.mjs   (exit code 1)
```

**Output**

```text
$ docker build -q -t dkr-c8-stack:1 --label dkr.challenge=8 C:\dkc\challenges\challenge-8-compose-stack\stack
$ docker compose -p dkr-c8 -f C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\compose.yaml up -d --wait --wait-timeout 90
$ C:\nvm4w\nodejs\node.exe --test C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\integration.test.mjs
ok 1 - the api is ready: database and cache both answer
not ok 2 - the api reports the version this pipeline is meant to test
ok 3 - a note is written to the database
ok 4 - jobs go through the cache and the worker into the database
# tests 4
# pass 3
# fail 1
$ docker compose -p dkr-c8 -f C:\dkc\challenges\challenge-8-compose-stack\part-3-ci-integration-test\compose.yaml down -v --remove-orphans
```

**Note:** The test fails on purpose (the stack runs version 1, the test expects 999). The pipeline exited with 1, as a failed test should, and 0 containers were still running afterwards. A failed run cleaned up after itself.
