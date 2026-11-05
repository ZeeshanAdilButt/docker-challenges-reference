# Results: Challenge 3, part 3: multi-stage builds with a test target

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -f Dockerfile.single -t dkr-c3-p3-single:1 .   then   look inside
```

**Output**

```text
root file system: 210.9 MB
/app:  package-lock.json package.json server.mjs test.mjs
/opt:  toolchain yarn-v1.22.22
user id: 1000
```

**Note:** One stage, so the tests and the 30 MB toolchain that only the build needed are in the image that ships.

## Step 2

**Command**

```sh
docker build --target test -f Dockerfile .
```

**Output**

```text
stages: 3 (base, test, runtime); last stage: runtime
build ok in 32 s; node --test reported 13 tests
```

**Note:** A target builds only the stages it needs and stops there. Building the test stage runs the tests, and nothing is pushed.

## Step 3

**Command**

```sh
docker build --target test -f Dockerfile <copy of the code with one failing test>
```

**Output**

```text
exit code 1
#12 5.920 ✖ forced failure for the pipeline check (1.250579ms)
#12 5.945 ✖ forced failure for the pipeline check (1.250579ms)
#12 5.945   AssertionError [ERR_ASSERTION]: forced failure
```

**Note:** The failing test failed the build. A CI job that runs this target stops here: nothing broken is built or pushed.

## Step 4

**Command**

```sh
docker build -f Dockerfile .   then   look inside
```

**Output**

```text
root file system: 180.9 MB (single stage: 210.9 MB)
/app:  package-lock.json package.json server.mjs
/opt:  yarn-v1.22.22
user id: 1000   answers /health: true
```

**Note:** The default target is the last stage. It has the service and nothing else. The toolchain and the tests stayed in the test stage.

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
