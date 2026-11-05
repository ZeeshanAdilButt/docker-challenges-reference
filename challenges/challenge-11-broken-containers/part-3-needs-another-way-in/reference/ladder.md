# Diagnosis ladder: answer key for part 3

In this part the usual tools get in the way. `docker exec` needs a running container, a shell may not exist, and a read-only root or a different user changes what you can see. The ladder stays the same. The way in changes.

Ways in, in the order to try them:

1. `docker logs` and `docker inspect` need nothing from the container.
2. `docker run --rm --entrypoint <tool> <image> ...` starts a new container from the same image with another program. Add `--user 0` to look as root, `--read-only` to copy the failing setup.
3. `docker exec <name> ...` works only while it runs, and only with tools that exist in the image.
4. `docker cp <name>:/path -` reads a file out of a stopped container, with no tools in the image.
5. A toolbox container sharing the namespaces of a running one: `docker run --rm --pid=container:<name> --network=container:<name> alpine:3.23 ...`.

The exact output for each service is in [results.md](../results.md).

## 08-read-only-root

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | `Exited (1)` | Ran, then stopped. |
| 2 | `docker logs --tail 15` | `Error: ENOENT: no such file or directory, mkdir '/app/cache'` | A write at start-up failed. The error says ENOENT, not "read-only": Node's recursive `mkdir` reports it this way here. Do not trust the word, look at the setup. |
| 3 | `docker inspect` | `exit=1` | Ordinary failure. |
| 4 | `docker inspect --format 'readonly_root={{.HostConfig.ReadonlyRootfs}} tmpfs={{json .HostConfig.Tmpfs}}'` | `readonly_root=true tmpfs=null` | Read-only root and no writable place. Cause found. |
| 5 | `docker run --rm --read-only --entrypoint mkdir <image> /app/cache` | `mkdir: can't create directory '/app/cache': Read-only file system` | Same image, same fault, with the real error text. |

Fix: keep `read_only: true` and add a small tmpfs: `tmpfs: ["/app/cache:size=8m,mode=1777"]`.

## 09-missing-shell

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | `Exited (255)` | Ran, then stopped. |
| 2 | `docker logs` | `exec /app/start.sh: no such file or directory` | The file exists (you copied it), so the missing thing is something it needs: the interpreter in the first line. |
| 3 | `docker inspect` | `exit=255` | The kernel could not start the script. |
| 4 | `docker run --rm --entrypoint sh <image>` | `exec: "sh": executable file not found in $PATH` | There is no shell in this image. |
| 5 | `docker run --rm --entrypoint node <image> -e "..."` | `#!/bin/sh shell exists: false` | The script asks for /bin/sh, which was deleted. Cause found. Node is the one tool in the image, so use it to look. |

Fix: do not use a shell script. `ENTRYPOINT ["node", "/app/server.mjs"]`. The image keeps no shell. For a healthy container with no shell, use the toolbox container (way in 5) to look at it.

The same message, "no such file or directory" for a file that exists, also appears when a script has Windows line endings (`#!/bin/sh\r`), and when a dynamic binary is missing its loader (for example a glibc binary on Alpine).

## 10-wrong-user

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | `Exited (1)` | Ran, then stopped. |
| 2 | `docker logs --tail 15` | `EACCES: permission denied, open '/app/config.json'` | A permission problem on one file. |
| 3 | `docker inspect` | `exit=1` | Ordinary failure. |
| 4 | `docker run --rm --user 0 --entrypoint ls <image> -ln /app` | `-rw------- 1 0 0 ... config.json` | Look as root. The file belongs to user 0 and only the owner may read it. Cause found. |
| 5 | `docker run --rm --entrypoint id <image>` | `uid=1000(node)` | The app is not the owner. |

Fix: `COPY --chown=node:node server.mjs config.json ./`. Do not fix it by running as root.
