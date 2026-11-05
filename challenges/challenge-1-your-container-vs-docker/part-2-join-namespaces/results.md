# Results: Challenge 1, part 2: join two containers into one view of the machine

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker run -d --name dkr-c1-app --ipc shareable dkr-c1-daftar:1
```

**Output**

```text
dkr-c1-app is running. Its IPC namespace is ipc:[4026532742].
daftar-mini is running in the host. Its IPC namespace is ipc:[4026532412].
```

**Note:** `--ipc shareable` tells Docker that other containers may join this container's IPC namespace. The default is private.

## Step 2

**Command**

```sh
docker run --rm [--pid|--network|--ipc container:dkr-c1-app] alpine:3.23 sh -c <probe>   # and mini-container.sh sidecar daftar-mini ... [pid,net,ipc]
```

**Output**

```text
joined       docker: reach / node / ipc    your container: reach / node / ipc
(none)       no / no / no                  no / no / no
net          yes / no / no                 yes / no / no
pid          no / yes / no                 no / yes / no
ipc          no / no / yes                 no / no / yes
pid+net+ipc  yes / yes / yes               yes / yes / yes
```

**Note:** reach = the sidecar can open 127.0.0.1:8080. node = its process list shows "node server.mjs". ipc = it shares the app's IPC namespace. Each flag changes exactly one of the three.

## Step 3

**Command**

```sh
docker run --rm ... [--ipc container:dkr-c1-app] alpine:3.23 cat /dev/shm/token
```

**Output**

```text
joined:     handshake
not joined: cat: can't open '/dev/shm/token': No such file or directory
```

**Note:** Joining the IPC namespace also shares /dev/shm. Only then can the sidecar read a file the app left there.

## Step 4

**Command**

```sh
docker run --rm --ipc container:dkr-c1-private alpine:3.23 true
```

**Output**

```text
exit 125
Run 'docker run --help' for more information
```

**Note:** The default IPC mode is private. A sidecar can join only a container that started with --ipc shareable.

## Step 5

**Command**

```sh
join.json: {"pid":true,"network":true,"ipc":false}
```

**Output**

```text
joined       docker: reach / node / ipc    your container: reach / node / ipc
pid+net      yes / yes / no                yes / yes / no
```

**Note:** Goal: the sidecar reaches the app and sees its process, but does not share its IPC namespace.

## Step 6

**Command**

```sh
node toolkit/cleanup.mjs 1
```

**Output**

```text
Before: 3 containers, 1 volumes. Still labelled dkr.challenge=1: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone.
