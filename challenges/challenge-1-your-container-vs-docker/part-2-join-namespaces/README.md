# Challenge 1, part 2: join two containers into one view of the machine

**Time:** about 40 minutes. **Download:** `node:24-alpine` (about 62 MB packed), `ubuntu:24.04` (about 29 MB packed) and `alpine:3.23` (about 4 MB packed). Parts 1 and 3 use the same images. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

The app image has no `ps`, no `curl`, no `tcpdump`. The service is slow and you need to look at it from the outside. Do you rebuild the image with debug tools in it? That changes the thing you are trying to debug, and it ships tools you do not want in production.

The other way: start a second container with the tools, and let it **share part of the first container's view**. Docker lets you pick which part. That is how debug sidecars and `docker run --network container:app` work. You will do it, and see why joining everything is a mistake.

## The idea

A namespace is one slice of "what a process can see". There are separate slices for the process list (pid), the network (net), shared memory and message queues (ipc), the hostname (uts), the mounts (mnt) and others. A normal container gets its own of each. Two processes see the same thing in a slice when they are in the **same namespace**.

In your Linux course you joined a namespace with `nsenter -t <pid> --net`. Docker has the same switch for whole containers:

| You want the sidecar to share | Docker flag | `nsenter` flag |
|---|---|---|
| the process list | `--pid container:app` | `--pid` |
| the network (so `127.0.0.1` is the app) | `--network container:app` | `--net` |
| shared memory (`/dev/shm`) | `--ipc container:app` | `--ipc` |

Each flag changes one slice and leaves the others alone. Share only what the job needs. The rest of the slices stay private, and that is the point of having them.

Your task: open `join.json`. It has three switches, all `false`. Set them so the sidecar can (1) reach the app at `127.0.0.1:8080`, (2) see `node server.mjs` in its process list, and (3) **not** share the app's IPC namespace.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-1-your-container-vs-docker/part-2-join-namespaces/test.mjs` | Fails on purpose: the switches are all `false`. |
| 2 | Edit `join.json` | Three switches: `pid`, `network`, `ipc`. |
| 3 | `node challenges/challenge-1-your-container-vs-docker/part-2-join-namespaces/run.mjs` | Starts the app in Docker and in your container, then runs a sidecar five fixed ways and once with your switches. About 50 seconds. |
| 4 | `node toolkit/show-facts.mjs c1.p2` | Shows the saved facts. |
| 5 | `node --test challenges/challenge-1-your-container-vs-docker/part-2-join-namespaces/test.mjs` | All tests pass. |

What step 3 does, in order:

1. Starts the app twice: in Docker (with `--ipc shareable`) and in your container, inside the throw-away host from part 1.
2. Runs a sidecar with no joins, then `net`, `pid`, `ipc` alone, then all three. In Docker the sidecar is `alpine:3.23`. In your container it is a second process made with `nsenter` and `unshare`.
3. The sidecar asks three questions: can I open `127.0.0.1:8080`? Does my `ps` show `node server.mjs`? Is my IPC namespace the app's?
4. Writes a file into the app's `/dev/shm` and checks who can read it.
5. Tries to join the IPC namespace of a container that did not start with `--ipc shareable`.
6. Runs the sidecar with your switches. Then cleans up.

## What you should see

```text
joined       docker: reach / node / ipc    your container: reach / node / ipc
(none)       no / no / no                  no / no / no
net          yes / no / no                 yes / no / no
pid          no / yes / no                 no / yes / no
ipc          no / no / yes                 no / no / yes
pid+net+ipc  yes / yes / yes               yes / yes / yes
```

Each row is the same in Docker and in your container. The flags are a thin layer over `setns`, the system call that `nsenter` also uses.

Two more things to notice:

- **Joining IPC shares `/dev/shm`.** A file the app writes there is readable by the sidecar only when the IPC namespace is joined.
- **A container must opt in.** By default Docker refuses `--ipc container:<name>` for a container that started without `--ipc shareable`. The pid and network flags have no such rule.

The full recorded run is in [results.md](results.md).

![What a sidecar shares with the app](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c1.p2.join_pid`, `c1.p2.join_network`, `c1.p2.join_ipc` | Your `join.json` at the time of the run. The test uses them to spot a stale run. |
| `c1.p2.docker_reaches_app`, `c1.p2.mini_reaches_app` | `wget http://127.0.0.1:8080/health` from the sidecar. |
| `c1.p2.docker_sees_node`, `c1.p2.mini_sees_node` | `ps` in the sidecar lists `node server.mjs`. |
| `c1.p2.docker_shares_ipc`, `c1.p2.mini_shares_ipc` | `readlink /proc/self/ns/ipc` in the sidecar equals the app's. |
| `c1.p2.none_reaches_app`, `c1.p2.net_only_reaches_app`, `c1.p2.pid_only_sees_node` | The fixed rows of the table, in both worlds. |
| `c1.p2.shm_file_seen_with_ipc_join` | The sidecar read the file the app left in `/dev/shm`. |
| `c1.p2.private_ipc_join_refused` | `docker run --ipc container:<private container>` exited non-zero. |

## What is different on Docker Desktop

Nothing in this part. The namespaces are made by the Linux kernel inside Docker Desktop's virtual machine, and the flags behave the same on Engine. (Your published ports are not used here: the sidecar reaches the app inside the VM.)

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- A test says `The last run used a different join.json`: run step 3 again.
- `cannot join IPC of a non-shareable container`: the app must start with `--ipc shareable`. The script does that for you.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 1`.
