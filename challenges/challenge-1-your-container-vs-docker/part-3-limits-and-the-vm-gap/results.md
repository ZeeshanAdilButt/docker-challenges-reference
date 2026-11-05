# Results: Challenge 1, part 3: limits and the gap under them

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
echo 134217728 > /sys/fs/cgroup/mini-daftar-mini/memory.max   # your script
docker run -d --memory 128m --memory-swap 128m ...   # Docker
```

**Output**

```text
inside your container:  memory.max = 134217728
inside the docker one:  memory.max = 134217728
```

**Note:** `--memory 128m` is one write to memory.max. `--memory-swap` equal to `--memory` also sets memory.swap.max to 0.

## Step 2

**Command**

```sh
cat /sys/fs/cgroup/memory.current  and  grep -E "^(anon|file|inactive_file) " /sys/fs/cgroup/memory.stat   # in each container
docker stats --no-stream --format "{{.MemUsage}}" dkr-c1-app
```

**Output**

```text
                        your container   docker
memory.current (MiB)    85.2             88.4
  of it anon (MiB)      56.1             55.8
  of it file cache      26.7             30
  inactive_file (MiB)   26.7             30
current - inactive_file 58.5             58.4
docker stats says       -                57.97MiB / 128MiB
```

**Note:** docker stats is not memory.current. It subtracts inactive_file (cache that can be dropped at once). That number, the working set, is the one to watch. memory.current also counts cache.

## Step 3

**Command**

```sh
curl "/alloc?mb=200"   # 200 MB asked from a 128 MB limit, in both
docker inspect dkr-c1-app --format "{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}"
cat /sys/fs/cgroup/mini-daftar-mini/memory.events
```

**Output**

```text
request in docker:    failed (UND_ERR_SOCKET)
docker inspect:       running 0 false
request in yours:     failed
your process alive:   false
your memory.events:   low 0, high 0, max 105, oom 1, oom_kill 1, oom_group_kill 0
```

**Note:** Same ending. The kernel kills the process when memory.max is hit. Docker turns that into exit 137 and OOMKilled true. Your script gets only the counter in memory.events: oom_kill goes up by one.

## Step 4

**Command**

```sh
docker info --format "{{.MemTotal}} {{.NCPU}} {{.KernelVersion}}"   and   node -e "os.totalmem()"   # on your computer
node /app/probe.mjs   # in a container
```

**Output**

```text
your computer (node os.totalmem):   32456 MB, 20 CPUs
docker info (the machine Docker runs on): 15835 MB, 20 CPUs, 6.6.87.2-microsoft-standard-WSL2 / Docker Desktop
inside a container with --memory 128m:    totalmem 15835 MB, 20 CPUs
```

**Note:** A container never sees its limit in os.totalmem() or the CPU count. It sees the machine Docker runs on. On Docker Desktop that machine is a virtual machine, smaller than your computer.

## Step 5

**Command**

```sh
echo 201326592 > /sys/fs/cgroup/mini-daftar-gap/memory.max   # the machine has 256 MB
for i in 1..40: curl "/alloc?mb=10"; then cat memory.events of the container and memory.events.local of the machine
```

**Output**

```text
limit.json: container_limit_mb = 192   machine = 256 MB
app held 170 MB (plus node itself) before it died
container memory.events:  low 0, high 0, max 23, oom 1, oom_kill 1, oom_group_kill 0
machine   memory.events.local: low 0, high 0, max 717, oom 0, oom_kill 0, oom_group_kill 0
killed by: its own limit
```

**Note:** The container limit is below the machine's memory, so the container hits its own wall first: its max counter goes up and the machine never runs out.

## Step 6

**Command**

```sh
node toolkit/cleanup.mjs 1
```

**Output**

```text
Still labelled dkr.challenge=1: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone.
