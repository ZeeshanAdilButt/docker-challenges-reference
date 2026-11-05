# Challenge 1, part 1: the same app in your container and in Docker

**Time:** about 45 minutes. **Download:** `node:24-alpine` (about 62 MB packed) and `ubuntu:24.04` (about 29 MB packed). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

In the Linux course you built a container by hand: `unshare`, a root folder, `pivot_root`, a cgroup limit, a veth pair. It ran a process, and the process thought it was alone. Now a teammate says "just use `docker run`". What did you gain, and what does Docker quietly do that your script never did?

If you cannot name the difference, `docker run` stays a magic spell. When it breaks at 3 am you will not know which part to look at.

## The idea

A container is not a thing the kernel knows about. It is a normal process that has been given a limited view (namespaces) and a limited share (cgroups). Your script did that. Docker does the same, and then adds more.

So the way to see what Docker adds is to run the **same app** both ways and ask each process what it can see. The app is `daftar-api`, our small web service. Both containers use the same files from the same image. A small script, `probe.mjs`, runs inside each container and reads its own `/proc` and `/sys`. Nothing is guessed. Every number comes from inside.

Where does "your container" run? Your real machine may be Windows or macOS, where there is no Linux host to run `unshare` on. So this challenge makes a **throw-away host**: one container named `dkr-c1-host` that plays the role of your Linux machine. `mini-container.sh` (a stand-in for the script you wrote in the Linux course) runs inside it. The Docker container runs next to it.

Before you run anything, **predict**. Open `answers.json` and fill it in. The test checks your guesses against what the probe measures.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-1-your-container-vs-docker/part-1-same-app-two-ways/test.mjs` | Fails on purpose: `answers.json` is empty and no facts exist yet. |
| 2 | Edit `answers.json` | Six guesses: which namespaces each side makes, who applies `USER node`, whether `/proc/sys` is writable in Docker, who sees more mounts, and whether node can read its own memory limit in your container. |
| 3 | `node challenges/challenge-1-your-container-vs-docker/part-1-same-app-two-ways/run.mjs` | Builds the image, starts the host, starts both containers three times for timing, runs the probe in each, compares your answers. About 40 seconds. |
| 4 | `node toolkit/show-facts.mjs c1.p1` | Shows the saved numbers. |
| 5 | Fix any answer marked `DIFF`, run step 3 again | The run prints your answer next to the measured one. |
| 6 | `node --test challenges/challenge-1-your-container-vs-docker/part-1-same-app-two-ways/test.mjs` | All tests pass. |

What step 3 does, in order:

1. Builds `dkr-c1-daftar:1` (daftar-api and `probe.mjs` on `node:24-alpine`).
2. Starts the host `dkr-c1-host` and copies the image's files into a folder, `/rootfs`. That folder is the root file system for your container.
3. Runs `mini-container.sh run` three times and `docker run` three times, and times each until `/health` answers.
4. Asks both for `GET /` and `GET /pid`.
5. Runs the probe in both and prints the table.
6. Cleans up with `cleanup(1)` and removes the image tag it built.

## What you should see

Both containers answer the same JSON, and in both `node server.mjs` is PID 1 with parent 0. Then the table:

```text
what the process sees       your container            docker
user id of the app          0                         1000
namespaces it made          ipc mnt net pid uts       cgroup ipc mnt net pid time uts
mounts it sees              12                        25
root file system            ext4                      overlay
node reads its limit (MB)   0                         128
/proc/sys writable          true                      false
DNS servers in resolv.conf  0                         1
```

Read it as a list of things Docker decided for you:

- **The user.** Docker read `USER node` from the image. Your script ran node as root unless you added a step for it.
- **One more namespace.** Docker gives each container its own cgroup namespace, so `/proc/self/cgroup` says `/` and tools inside can find their own limit. Without it, node looks for its limit in the wrong folder and finds none. It reports 0 MB, so any runtime that sizes itself from the limit sees the whole machine.
- **A time namespace** also shows up for Docker on this setup. It is part of the runtime's defaults.
- **Hardened `/proc`.** Docker mounts `/proc/sys` read-only and hides paths such as `/proc/kcore`. Your fresh `/proc` mount is wide open.
- **Network plumbing.** Both have a veth pair. Docker also adds a bridge, a NAT rule for `-p`, and a `resolv.conf` with a DNS server. Yours has none of these.
- **A layered root.** Docker's root is an overlay of read-only image layers and one writable layer. Yours is one plain folder.

The full recorded run is in [results.md](results.md). Your numbers will differ.

![Time until /health answers](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c1.p1.start_mini_s`, `c1.p1.start_docker_s` | Median of three runs: from the start command until `GET /health` answers. |
| `c1.p1.ns_new_mini`, `c1.p1.ns_new_docker` | Namespace types where `readlink /proc/self/ns/<type>` inside the container differs from the host container's PID 1. |
| `c1.p1.uid_mini`, `c1.p1.uid_docker` | `process.getuid()` inside the container. |
| `c1.p1.caps_mini_count`, `c1.p1.caps_docker_count` | Bits set in `CapBnd` in `/proc/self/status`. Your container inherits the host container's set, so this row is shaped by the host. |
| `c1.p1.mounts_mini`, `c1.p1.mounts_docker` | Lines in `/proc/self/mountinfo`. |
| `c1.p1.root_fstype_*` | File system type of the first mountinfo line. |
| `c1.p1.memory_max_*_bytes` | `/sys/fs/cgroup/memory.max` inside the container. |
| `c1.p1.node_limit_seen_*_mb` | `process.constrainedMemory()` in node, divided by 1 MiB. |
| `c1.p1.proc_sys_writable_*` | `fs.accessSync('/proc/sys/kernel/hostname', W_OK)`. |
| `c1.p1.nameservers_*` | `nameserver` lines in `/etc/resolv.conf`. |
| `c1.p1.vm_cpus`, `c1.p1.vm_ram_mb` | `os.availableParallelism()` and `os.totalmem()` inside the container. These are the machine's numbers, not the container's. |

## What is different on Docker Desktop

- "The host" for `/proc` and `/sys` is the Linux virtual machine that Docker Desktop runs, not Windows or macOS. `c1.p1.vm_ram_mb` is that machine's memory.
- Published ports (`-p 127.0.0.1::8080`) go through Docker Desktop's proxy. Use `127.0.0.1`, not `localhost`.
- On Docker Engine in Linux or WSL2 the namespace, user and mount rows match. Start times are shorter because there is no proxy.

## Why does the throw-away host have extra rights?

`mini-container.sh` needs `unshare`, `mount`, `pivot_root` and a veth pair. Those need `CAP_SYS_ADMIN` and `CAP_NET_ADMIN`, and Docker's default seccomp profile blocks `pivot_root`. So `dkr-c1-host` is started with:

- `--cap-add SYS_ADMIN --cap-add NET_ADMIN`
- a seccomp profile that is Docker's default plus one line allowing `pivot_root` (`mini/seccomp-pivot-root.json`)
- the usual limits from `safeArgs`: 256 MB memory with no swap, 200 processes, small `/tmp`, log limits, `no-new-privileges`

It is **not** `--privileged`, it mounts no Docker socket, and `cleanup(1)` removes it. Everything your container does stays inside this one capped container. Because the host is a container, your container inherits its seccomp filter and its capability set. That is why the `capabilities allowed` row is close for both sides. On a real Linux host your script would show more.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- `could not fill the root file system`: the image export failed. Check free disk and run again.
- A test says a fact is missing: run step 3 first.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 1`.
