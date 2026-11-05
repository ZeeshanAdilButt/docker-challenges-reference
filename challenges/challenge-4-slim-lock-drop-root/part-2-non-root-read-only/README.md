# Challenge 4, part 2: run as non-root with a read-only root

**Time:** about 40 minutes. **Download:** nothing new (`node:24-alpine`, 62 MB packed, from part 1). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

An attacker finds a bug in your service and runs their own code inside the container. What can they do next? If the container runs as root, with a writable file system and the default Linux powers, they can change your program, plant a tool in `/usr/local/bin`, and edit `/etc`. If it runs as an ordinary user on a read-only file system, they can write to two folders and nothing else. The attack still happened, but it has far less room to grow.

## The idea

Three small settings shrink what a hijacked process can do.

| Setting | What it does | Where you set it |
|---|---|---|
| A **numeric non-root user** | The process is not uid 0. It cannot write to files owned by root. | `USER 10001:10001` in the Dockerfile |
| A **read-only root file system** | No process can write anywhere in the image's file system. | `--read-only` on `docker run` |
| **No Linux powers** (capabilities) | Root normally holds 14 small powers, such as changing file owners. Dropping all of them removes those. | `--cap-drop ALL` on `docker run` |

Your app still needs one place to write. You give it exactly one: a **volume** mounted on `/app/data`. A volume starts empty, and Docker copies the owner of the folder from the image the first time. If the folder in the image belongs to root, the app user gets `permission denied`. That is the most common surprise, and the fix is one `chown` in the Dockerfile.

| You see | Usual cause | Fix |
|---|---|---|
| `EACCES` when the app writes | The folder belongs to root, the app is not root | `chown` the folder in the Dockerfile |
| `EROFS` (read-only file system) | `--read-only` is on and the path is not a mount | Mount a volume or tmpfs there, or stop writing there |
| `ENOENT` on `/app/data` | The folder does not exist in the image | `mkdir` it in the Dockerfile |
| `EACCES` binding port 80 | Non-root cannot open ports below 1024 on some runtimes | Listen on 8080 and map it with `-p` |

## Your job

The starter `Dockerfile` works, and it is a bad review. Edit `Dockerfile` and `run-flags.txt` in this folder (not the files in `reference/`) until the test passes.

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-4-slim-lock-drop-root/part-2-non-root-read-only/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-4-slim-lock-drop-root/part-2-non-root-read-only/run.mjs` | Builds your image and runs `probe.mjs` twice: once as root with no flags (the baseline), once with your setup. Starts the real service and checks who runs it. About 1 minute. |
| 3 | Read the two probe tables. Edit `Dockerfile`: add `USER`, change `PORT`, make `/app/data` owned by your user. Edit `run-flags.txt`: add `--read-only`, `--cap-drop ALL` and the volume line. | Each change moves one line in the table. |
| 4 | Run step 2 again. | `writable 2 of 6`, user `10001`, `powers 0`. |
| 5 | `node toolkit/show-facts.mjs c4.p2` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-4-slim-lock-drop-root/part-2-non-root-read-only/test.mjs` | The test passes. |

`probe.mjs` is a short file you can read. It is what an attacker would try first: write a file in six places, count the powers, open ports 80 and 8080.

## What you should see

The starter baseline and your fixed setup, side by side (reference machine):

```text
root, no flags:   user 0:0,        powers 14, writable 6 of 6
your setup:       user 10001:10001, powers 0,  writable 2 of 6   (/app/data and /tmp)
```

The paths in your setup say why: `/app`, `/etc`, `/usr/local/bin` and `/` answer `EROFS`. Only `/app/data` (your volume) and `/tmp` (a small memory disk that `run.mjs` always adds) are writable.

Step 5 of the recorded run shows something you may not expect: on Docker, a non-root user **can** open port 80 by default. Docker sets the kernel setting `net.ipv4.ip_unprivileged_port_start` to 0 inside the container. With the setting at 1024, the same user gets `EACCES` on port 80. Other runtimes may not set it to 0, so build the image to listen above 1024 and do not rely on the Docker default.

The full recorded run is in [results.md](results.md).

![Places a hijacked process can write](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c4.p2.writable_paths_baseline`, `c4.p2.writable_paths_yours` | `probe.mjs` tries to create and delete a file in `/app`, `/app/data`, `/tmp`, `/etc`, `/usr/local/bin` and `/`. It counts the answers `ok`. |
| `c4.p2.caps_baseline`, `c4.p2.caps_yours` | `probe.mjs` reads `CapEff` in `/proc/self/status` and counts the bits that are set. |
| `c4.p2.service_uid` | `docker exec ... grep Uid /proc/1/status` on the running service. This is the real process, not only the image setting. |
| `c4.p2.readonly_root` | `docker inspect --format {{.HostConfig.ReadonlyRootfs}}` on the running service. |
| `c4.p2.image_user_numeric` | `docker image inspect`, field `Config.User`, matches digits (not zero). |
| `c4.p2.low_port_default_ok`, `c4.p2.low_port_sysctl1024_ok` | `probe.mjs` run as uid 10001, with and without `--sysctl net.ipv4.ip_unprivileged_port_start=1024`. |

## What is different on Docker Desktop

Nothing in the results changes. The Linux rules (users, capabilities, read-only mounts) are enforced by the Linux kernel inside Docker's virtual machine, so Windows and Mac behave like Linux here. One thing to know: a **bind mount** from your own disk (`-v C:\folder:/app/data`) takes its owner and permissions from the host file system, so `chown` in the Dockerfile does not apply to it. This part uses a named volume so that the results are the same for everyone.

## Stuck?

- `The service did not answer /health`: run `docker logs dkr-c4-app` right after a failed run (cleanup removes the container at the end, so start it by hand with the same flags first).
- `EROFS` from the service at start: it tries to write somewhere other than `/app/data` and `/tmp`. Find the path in the log.
- `run-flags.txt uses "--privileged"`: this challenge does not allow it. See [SAFETY.md](../../../SAFETY.md).
- Left-over objects after a crash: `node toolkit/cleanup.mjs 4`.

## Next

Part 3: [make the build reproducible](../part-3-reproducible-build/README.md).
