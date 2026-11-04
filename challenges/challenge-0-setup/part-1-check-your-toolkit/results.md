# Results: Challenge 0, part 1: check your toolkit

Recorded run. Machine: win32, Docker Desktop Engine 29.9.2, Node 22.22.2. Date: 2026-11-04.

## Step 1

**Command**

```sh
node --version
```

**Output**

```text
v22.22.2
```

**Note:** You need Node 22 or newer. Yours is v22.22.2.

## Step 2

**Command**

```sh
docker version --format "Client {{.Client.Version}}, Engine {{.Server.Version}}"
```

**Output**

```text
Client 29.9.2, Engine 29.9.2
```

**Note:** The engine answers in about 157 ms (median of 3 calls).

## Step 3

**Command**

```sh
node toolkit/check-setup.mjs
```

**Output**

```text
ok    Node.js                  v22.22.2
ok    Docker engine            engine 29.9.2, client 29.9.2
ok    Machine type             linux/x86_64, Docker Desktop. This is Docker Desktop, so some behaviour differs. The READMEs tell you where
ok    Docker memory            15.5 GB
ok    CPUs for Docker          20
ok    Cgroup version           v2
ok    Compose plugin           v5.6.1
ok    Buildx plugin            v0.38.1
ok    Free disk (this folder)  7.6 GB

All hard checks passed.
```

**Note:** No FAIL lines, so your machine is ready.

## Step 4

**Command**

```sh
node toolkit/show-facts.mjs c0.p1
```

**Output**

```text
c0.p1.disk_free_gb = 7.6
c0.p1.docker_call_ms = 157
c0.p1.docker_memory_gb = 15.5
c0.p1.node_major = 22
```

**Note:** These numbers are saved in facts.json. The test reads them.
