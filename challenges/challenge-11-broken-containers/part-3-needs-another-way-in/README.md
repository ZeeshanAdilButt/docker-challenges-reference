# Challenge 11, part 3: services that need another way in

**Time:** about 45 minutes. **Download:** `node:24-alpine` (about 62 MB packed) and `alpine:3.23` (about 4 MB packed), both already here from part 1. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Your debugging habit is `docker exec -it <name> sh`. It fails in three common cases. The container already stopped, so there is nothing to enter. The image has no shell, because someone removed it to harden the image. The root filesystem is read-only, so even if you get in you cannot change anything. Real production images are built to be hard to enter. You must be able to look anyway.

## The idea

There are five ways in. They need less and less from the container.

| # | Way in | Needs | Example |
|---|---|---|---|
| 1 | Docker's own records | nothing in the image | `docker logs`, `docker inspect` |
| 2 | A new container from the same image with another entrypoint | the image | `docker run --rm --entrypoint ls <image> -l /app` |
| 3 | Run as another user or with other flags to copy the failing setup | the image | `--user 0` to look as root, `--read-only` to repeat a read-only root |
| 4 | Copy a file out | nothing in the image | `docker cp <name>:/app/start.sh -` |
| 5 | A **toolbox container** that shares the namespaces of a running one | a running container | `docker run --rm --pid=container:<name> --network=container:<name> alpine:3.23 netstat -tln` |

Way 5 gives you `ps`, `netstat` and `wget` while the target stays untouched and keeps its tiny image. The toolbox sees the target's processes and its network, but not its files (use `/proc/<pid>/root` for that, with care). This course uses `alpine:3.23` as the toolbox because it is already on your machine. Larger toolbox images such as `nicolaka/netshoot` (about 219 MB) do the same with more tools.

The ladder stays the same. Only the way in changes. You will meet one more thing: an error message can be misleading. "No such file or directory" can mean the file exists but its interpreter does not. A write to a read-only filesystem can show up as `ENOENT`. Do not trust the words alone. Check the setup.

## The three tickets

| Folder | Ticket |
|---|---|
| `services/08-read-only-root` | Security made the root filesystem read-only. Now the pricing API exits at start-up. |
| `services/09-missing-shell` | The new hardened image (no shell) exits at once. You cannot get a shell inside to look around. |
| `services/10-wrong-user` | The profile API runs as a normal user (good!) and exits at start-up. It worked as root. |

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-11-broken-containers/part-3-needs-another-way-in/test.mjs` | Four tests **fail** on purpose: three services that do not work, and a runbook with TODO lines. |
| 2 | `node challenges/challenge-11-broken-containers/part-3-needs-another-way-in/run.mjs` | Starts each service from your files and prints what a person would see. |
| 3 | In a service folder: `docker compose up -d --build` | The symptom from the ticket. |
| 4 | Work down the ladder. Use ways in 1 to 4 on a stopped container. | Do not read `reference/` yet. |
| 5 | Fix one file. Then `docker compose down -v` and `docker compose up -d --build`. | |
| 6 | Once a service runs, try way 5: `docker run --rm --pid=container:dkr-c11-read-only-root --network=container:dkr-c11-read-only-root alpine:3.23 netstat -tln` | You see the port 8080 listener of a container you never entered. Add `--memory 64m --pids-limit 50 --label dkr.challenge=11` to the command to follow the safety rules. |
| 7 | `node --test --test-name-pattern="08-" challenges/challenge-11-broken-containers/part-3-needs-another-way-in/test.mjs` | Tests one service at a time (change the number). |
| 8 | Write the three lines for each service in `runbook.md`. | Symptom, Cause, Fix. |
| 9 | `node challenges/challenge-11-broken-containers/part-3-needs-another-way-in/run.mjs --answer-key` | Stuck? Prints the ladder output for your current files. It spoils the answer. |
| 10 | `node toolkit/show-facts.mjs c11.p3` | Shows the saved numbers. |
| 11 | `node --test challenges/challenge-11-broken-containers/part-3-needs-another-way-in/test.mjs` | All tests pass. |

Rules for the fixes: keep the cage at the top of each `compose.yaml`. For 08 the root must **stay** read-only. For 10 the service must **stay** a normal user. No `--privileged`, and no Docker socket anywhere.

## What you should see

| Service | Mark | Proof of the cause |
|---|---|---|
| 08 read-only root | `Exited (1)` | `ENOENT: ... mkdir '/app/cache'` in the logs (misleading), `ReadonlyRootfs` true and no tmpfs in `docker inspect`, and the same image fails with `--read-only` |
| 09 missing shell | `Exited (255)` | `exec /app/start.sh: no such file or directory`. `--entrypoint sh` fails. Node reads the first line: `#!/bin/sh`, and `/bin/sh` does not exist. |
| 10 wrong user | `Exited (1)` | `EACCES: permission denied, open '/app/config.json'`. As root, `ls -ln` shows the file owned by 0 with mode 600. The app is user 1000. |

The recorded run, with every ladder command and the fixed result, is in [results.md](results.md).

![Ladder rung that proves the cause](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c11.p3.<service>_broken_state`, `_broken_exit_code`, `_broken_oomkilled`, `_broken_health` | `docker inspect` of the starter version, a moment after `docker compose up -d`. |
| `c11.p3.<service>_cause_rung` | The ladder rung whose output proves the cause (counting from 1). |
| `c11.p3.<service>_fixed_working` | The reference version is running and every HTTP check answers. |
| `c11.p3.broken_count`, `fixed_count` | Services broken in the starter and working in the reference. |

## What is different on Docker Desktop

- `--pid=container:` and `--network=container:` work on Docker Desktop because the toolbox joins the namespaces of another container inside the same virtual machine. You cannot join a process on your Windows or macOS host this way.
- Exit code 255 for the missing interpreter and the text of the message come from the Linux kernel and the container runtime, so they match a Linux server.
- File owners shown by `ls -ln` are numbers from inside the image (0 for root, 1000 for `node`), the same everywhere.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- Service 09: the fix is not to put the shell back. Run the program directly. The test only needs the service to work, but a hardened image keeps no shell.
- Service 08: do not set `read_only: false`. The test checks that the root stays read-only.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 11`.

## Next

Challenge 11 is done. Challenge 12 starts with a scan of an old image.
