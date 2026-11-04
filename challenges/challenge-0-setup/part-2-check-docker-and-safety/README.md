# Challenge 0, part 2: check Docker and learn the safety rules

**Time:** about 30 minutes. **Download:** one image, `alpine:3.23`, about 13 MB on disk (about 4 MB to download). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Your Docker is shared. It holds your other projects' databases, images and volumes too. A cleanup command that is too wide can delete work you did not make. `docker system prune` and `docker volume prune` are the usual cause. They look like routine tidying, and they do not ask which things are yours.

These challenges start many containers, networks and volumes. They need a way to remove exactly those and nothing else.

## The idea

Two habits keep the challenges safe.

1. **Name and label everything.** A container is named `dkr-c0-sleeper` and carries the label `dkr.challenge=0`. A label is a small tag stored with the object. Docker can list and filter by it.
2. **Put a limit on everything.** Each container gets a memory limit, a limit on the number of processes, a small `/tmp` and a cap on log size. If a script goes wrong, it hits the limit, not your machine.

Cleanup then asks Docker one question: "which containers, networks and volumes have the label `dkr.challenge=0`?" It removes those. It never uses `prune`.

You will test this. The script makes one volume **without** the label and checks that cleanup leaves it alone.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | Read [SAFETY.md](../../../SAFETY.md) | Eight short rules. |
| 2 | `node --test challenges/challenge-0-setup/part-2-check-docker-and-safety/test.mjs` | Some tests **fail** on purpose: the facts are not saved yet. |
| 3 | `node challenges/challenge-0-setup/part-2-check-docker-and-safety/run.mjs` | Runs the whole experiment (see below) and saves ten facts. |
| 4 | `node toolkit/show-facts.mjs c0.p2` | Shows the facts. |
| 5 | `node --test challenges/challenge-0-setup/part-2-check-docker-and-safety/test.mjs` | All tests pass. |
| 6 | `docker system df` | Shows how much space Docker uses. Read only. Nothing is deleted. |

What step 3 does, in order:

1. Pulls `alpine:3.23` and times it.
2. Reads the image size from `docker image inspect`.
3. Runs one container with the safety limits and reads its limits from inside (`/sys/fs/cgroup/memory.max` and `pids.max`).
4. Creates a labelled network, a labelled volume and a labelled container, plus one volume with no label.
5. Lists them by label.
6. Runs `node toolkit/cleanup.mjs 0`.
7. Checks that nothing with the label is left, and that the volume without a label is still there. Then it removes that one volume by its full name.

If anything fails halfway, the script still cleans up before it exits.

## What you should see

The container prints `67108864` and `50`. That is 64 MB in bytes, and 50 processes. These are the limits set by `--memory 64m` and `--pids-limit 50`, read from inside the container.

Cleanup prints how many objects it removed, then says `0` are left. After it, the volume without a label is still listed.

The full recorded run from the reference machine is in [results.md](results.md). Your times will differ.

![How long each step takes](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c0.p2.pull_s` | Time of `docker pull alpine:3.23`. If the image was already on your machine, this is only the time to check it (`c0.p2.pull_cached` is `true`). A first download takes longer. |
| `c0.p2.image_mb` | `docker image inspect`, field `Size`, divided by one million. |
| `c0.p2.run_s` | Median of three runs of the limited container. |
| `c0.p2.memory_max_bytes` | `/sys/fs/cgroup/memory.max` read inside the container. |
| `c0.p2.pids_max` | `/sys/fs/cgroup/pids.max` read inside the container. |
| `c0.p2.cleanup_s` | Time of `node toolkit/cleanup.mjs 0`. |
| `c0.p2.cleanup_removed_count` | Containers, networks and volumes that cleanup removed. |
| `c0.p2.leftover_count` | What still carries the label after cleanup. Must be `0`. |
| `c0.p2.unlabelled_kept_count` | The volume with no label that survived cleanup. Must be `1`. |

## What is different on Docker Desktop

- The `cat /sys/fs/cgroup/...` lines read the limits inside Docker Desktop's Linux virtual machine. They show the same numbers as on Linux.
- `docker system df` shows the space inside the virtual machine's disk file. Your computer's free disk is a different number.
- A first `docker pull` can be slow on a new install, because Docker Desktop unpacks the image in the virtual machine.

## Why not just `docker run --rm`?

`--rm` removes a container when it stops. It does not remove networks and volumes, and it does nothing if a script crashes while a container is running. The label approach covers all three kinds of objects and works after a crash. Run `node toolkit/cleanup.mjs 0` at any time.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- `Stopped: docker pull failed`: check your internet connection. The image is about 4 MB to download.
- A test says a fact is missing: run step 3 first.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 0`.

## Next

Challenge 1 starts in module 2. You now have a working toolkit and you know the rules.
