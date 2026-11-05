# Diagnosis ladder: answer key for part 1

The ladder is the same order every time. Stop at the first rung that shows the cause.

1. Is it running? `docker ps -a --filter name=<name>`
2. What did it say? `docker logs --tail 15 <name>`
3. Why did it stop? `docker inspect <name> --format 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}'`
4. Can it start, and can it see its files and config? Run the image with a different entrypoint (`docker run --rm --entrypoint ls <image> -l /app`) and read `docker inspect` for env, mounts and limits.
5. Can it reach the network? (not needed in this part)
6. Is it starved? Memory, process and file limits, and the OOMKilled flag.

The exact output for each service is in [results.md](../results.md).

## 01-wrong-entrypoint

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | Status `Created`, no ports | It never ran. |
| 2 | `docker logs` | No output | The program never started, so it never wrote anything. |
| 3 | `docker inspect` | `exit=127`, `error=...exec: "/app/start": stat /app/start: no such file or directory` | Cause found: the engine cannot find the file. Exit 127 means "command not found". |
| 4 | `docker image inspect --format '{{json .Config.Entrypoint}}'` | `["/app/start"]` | What the image tries to run. |
| 5 | `docker run --rm --entrypoint ls <image> -l /app` | `server.mjs`, `start.sh` | The file is called `start.sh`. |

Wrong turns: reading the Node code (it never ran), changing memory limits, rebuilding without a change. Fix: `ENTRYPOINT ["/app/start.sh"]`.

## 02-missing-env

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | `Exited (1)` | It ran and stopped by itself. |
| 2 | `docker logs` | `FATAL: DATABASE_URL is not set...` | Cause named by the program. |
| 3 | `docker inspect` | `exit=1`, `oom=false`, empty error | An ordinary failure exit, not a kill. |
| 4 | `docker inspect --format '{{json .Config.Env}}'` | `DB_URL=postgres://...` | The value exists under another name. |

Fix: rename the variable in compose.yaml to `DATABASE_URL`.

## 03-volume-permission

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | `Exited (1)` | Ran, then stopped. |
| 2 | `docker logs --tail 15` | `EACCES: permission denied, mkdir '/var/lib/shop/db'` | A permission problem on one path. |
| 3 | `docker inspect` | `exit=1`, `oom=false` | Ordinary failure. |
| 4 | `docker run --rm -v dkr-c11-volume-permission_shop-data:/v --entrypoint ls <image> -ldn /v` | `drwxr-xr-x 2 0 0 ... /v` | The volume belongs to user 0 (root). |
| 5 | `docker run --rm --entrypoint id <image>` | `uid=1000(node)` | The app is user 1000 and has no write bit. |

Fix: in the Dockerfile, create `/var/lib/shop` and `chown node:node` it before `USER node`. A new empty named volume copies the owner of that folder from the image. An old volume keeps its old owner, so run `docker compose down -v` after changing the image.

## 04-exit-137

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | `Exited (137)` | 137 is 128 plus signal 9 (SIGKILL). |
| 2 | `docker logs` | Nothing, or no "cache loaded" line | It died while loading the cache. |
| 3 | `docker inspect` | `exit=137 oom=true` | The kernel killed it for using too much memory. |
| 4 | `docker inspect --format 'memory_bytes={{.HostConfig.Memory}} env={{json .Config.Env}}'` | `33554432` and `PRELOAD_MB=48` | A 32 MB limit and a 48 MB cache cannot fit. |

Fix: a 64 MB limit (`mem_limit` and `memswap_limit` equal) and `PRELOAD_MB=16`. The Node process itself needs about 46 MB before any of your data.
