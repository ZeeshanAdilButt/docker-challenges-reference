# Challenge 14, part 1: containerize the Daftar platform

**Time:** about 3 hours. **Download:** the starter builds on `node:24` (about 410 MB packed). The fixed files use `node:24-alpine` (about 63 MB), `python:3.12-slim` (about 43 MB), `nginx:1.27-alpine` (about 21 MB) and `postgres:18-alpine` (about 120 MB). The whole capstone pulls about 700 MB, and part 2 adds `docker:29-dind` (about 122 MB) and `registry:3` (about 21 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

You have joined a team that has a working system and a pile of bad habits. The Daftar platform takes a sentence on a web page, queues it, and a worker shouts it back and counts the words. It runs, on the machine of the person who wrote it. Nobody else has got it to start. The README talks about MySQL and Node 16. The API image is 1.6 GB, runs as root, ignores the request to stop (Docker waits, then kills it) and has the database password inside it. The compose file publishes the database to your whole network.

Your job in the capstone is the whole job, once, on a system you did not write: containerize it, ship it, break it and defend it. This part is the first quarter.

## The system

```text
browser --> web (nginx, static page) --/api/--> api (Node) --> db (PostgreSQL)
                                                   ^
                                       worker (Python) asks the API for jobs
```

| Service | What it is | Folder |
|---|---|---|
| `web` | a static page; nginx sends `/api/` to the API | `daftar-platform/web` |
| `api` | Node 22 or newer, one dependency (`pg`); has `/health`, `/ready`, `/jobs`, `/stats`, `/alloc`, `/crash` | `daftar-platform/api` |
| `worker` | Python, standard library only; claims a job, waits a moment, reports the result | `daftar-platform/worker` |
| `db` | PostgreSQL 18 (a stock image) | in `compose.yaml` |

The source code is fine and you do not change it. You change how it is packaged and run.

## The idea

The rubric (see [rubric.mjs](../rubric.mjs); a mentor reads the same list) asks for things you met one at a time in modules 3 to 11. Here they all meet.

| Area | What the rubric asks, in this part |
|---|---|
| images | within the size targets (api 300 MB, worker 220 MB, web 100 MB), an unprivileged user, every base image pinned by digest, `docker build --check` clean |
| build and cache | a `.dockerignore` next to each Dockerfile; the api built in stages with a `test` stage; an edit of the source does not reinstall the packages |
| run and recover | each service stops in 3 seconds and exits 0; the stack is healthy in under 60 seconds with a health check on every container; a job goes through the whole system |
| security | no secret in any image or in the compose file; the database publishes no port; a read-only root, no capabilities, `no-new-privileges`, memory limits and a restart policy |
| communication | a README that tells the truth |

The mistakes in the starter are the usual ones: a base image that is too big and a tag that moves; `COPY . .` before the install (so every edit reinstalls everything, and the `.env` file goes into the image); `ENV` with a password; a shell in front of the program, so `SIGTERM` never arrives; `root`; no health checks, so `depends_on` only waits for "started".

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-14-capstone/part-1-containerize/test.mjs` | Fails on purpose. Read each message: it says what is wrong and how to fix it. |
| 2 | `node challenges/challenge-14-capstone/part-1-containerize/run.mjs` | Builds your three images and your compose stack, measures every target and prints one line each. Write down these numbers: they are your "before". |
| 3 | Edit the three Dockerfiles, add three `.dockerignore` files, edit `compose.yaml` and `README.md`. | The folder is `challenges/challenge-14-capstone/daftar-platform`. |
| 4 | `cp daftar-platform/.env.example daftar-platform/.env` and set `POSTGRES_PASSWORD` | Only if you start the stack by hand. `run.mjs` passes its own test password. |
| 5 | Run steps 2 and 1 again, until it is green | These are your "after" numbers. |
| 6 | `node toolkit/show-facts.mjs c14.p1` | Shows the saved numbers. |

Look up the digests with `docker buildx imagetools inspect node:24-alpine`. Use the digest of the **index** (the line that says `Digest:` at the top). To try the stack yourself: `cd daftar-platform`, then `docker compose up --wait`, then open the port that `docker compose port web 8080` prints. Stop it with `docker compose down -v`.

What step 2 does, in order:

1. Reads each Dockerfile for pinned bases and each folder for a `.dockerignore`.
2. Runs `docker build --check` on each.
3. Builds each image three times without the layer cache, reads its size and its user.
4. Looks for the planted secret (the word `supersecret`) in each image: its history, its environment and its files.
5. Starts each image and times `docker stop` (limit 5 seconds), three times.
6. Copies the api to a scratch folder, edits `server.mjs` three times and rebuilds, looking for the package install step in the log.
7. Reads your compose file as Docker reads it (`docker compose config`).
8. Starts the stack with `docker compose up --build --wait` on random ports on `127.0.0.1`, queues 5 jobs through the web page's own path and waits until all are done, then removes the stack.
9. Reads your README for stale words.

Every container, network and volume of the stack is labelled `dkr.challenge=14` by a second compose file that `run.mjs` writes, so `node toolkit/cleanup.mjs 14` can always find them. Your published ports are replaced by random ones on `127.0.0.1`, so the run never collides with something else on your machine.

## What you should see

On the starter: the api is about 1.6 GB, everything runs as root, the api and the worker take the full 5 seconds to stop and exit 137, secrets are found in the history, the environment and the files, nothing is healthy because nothing has a health check, and the compose file publishes the database. On the fixed files: 245 MB, 177 MB and 74 MB, all three run as an unprivileged user, they stop in under a second with exit 0, no secret is found, the stack is healthy in about 20 seconds and 5 jobs finish in about 2 seconds. The full recorded run is in [results.md](results.md). Your numbers will differ.

![Image size after containerizing](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c14.p1.<service>_size_mb` | `docker image inspect --format "{{.Size}}"`, divided by one million. |
| `c14.p1.<service>_user_root` | `docker run --entrypoint id <image> -u` prints 0. |
| `c14.p1.<service>_pinned`, `..._from_count`, `..._dockerignore` | The `FROM` lines of the Dockerfile (a base is pinned when it ends in `@sha256:` and 64 hexadecimal characters), and the file `<service>/.dockerignore`. |
| `c14.p1.<service>_check_warnings_count` | `docker build --check`: the number in "Check complete". |
| `c14.p1.<service>_build_cold_s` | Median of three builds with `--no-cache`. (`--no-cache` ignores the layer cache; a cache mount for `npm` still helps.) |
| `c14.p1.<service>_secret_leaks_count` | Hits of the word `supersecret` in `docker image history --no-trunc`, in the image environment and in files under the app folders. |
| `c14.p1.<service>_stop_s`, `..._stop_exit_code` | `docker stop -t 5` on a running container: median of three times, and the exit code. |
| `c14.p1.api_multistage`, `c14.p1.api_test_stage` | The api Dockerfile has two or more stages, one named `test`. |
| `c14.p1.api_deps_cached_on_edit`, `c14.p1.api_edit_rebuild_s` | After an edit of `server.mjs`, the `RUN npm ...` step says `CACHED` in the build log (all three edits), and the median rebuild time. |
| `c14.p1.compose_*` | `docker compose config --format json` of your `compose.yaml`: published ports, health checks, `depends_on` conditions, memory limits, hardening options, restart policies, profiles, `develop.watch`, a secret written in the file, an obsolete `version:` key, a pinned database image. |
| `c14.p1.compose_up_s`, `..._up_ok`, `..._healthy_count` | Time of `docker compose up -d --build --wait`, whether it succeeded, and how many containers report `healthy`. |
| `c14.p1.compose_e2e_ok`, `c14.p1.compose_e2e_s` | Five jobs posted to `/api/jobs` on the web port; all must reach `done`. |
| `c14.p1.readme_stale_count`, `c14.p1.readme_missing_count` | Words in `README.md` that must not be there (`mysql`, `docker-compose`, `node 16`, `pm2`) and words that must (`docker compose up`, `.env`, `POSTGRES_PASSWORD`). |

## What is different on Docker Desktop

- The images and the stack run inside Docker Desktop's virtual machine. Sizes are the same as on Linux. The first build of a base image pulls it, so run `docker pull` first if you want the build times without the download.
- Docker Desktop shows a size for an image that includes only what is unpacked on its disk. This part reads the `Size` field of `docker image inspect` and divides by one million, as the rest of the course does.
- The ports are on `127.0.0.1` only. Nothing in this part is reachable from other machines.
- `docker compose watch` needs Docker Desktop or Compose v2.22 or newer. It is not run by `run.mjs`; try it yourself.
- Never use `docker system prune` to clean up. `node toolkit/cleanup.mjs 14` removes only what this challenge made.

## Stuck?

- `Docker is not ready`: start Docker Desktop and wait until it says running.
- `the api image did not build`: read the last lines of the error. `npm ci` needs the lock file, so copy `package-lock.json` as well as `package.json`.
- A service stops in 5 seconds with exit 137: the process never saw `SIGTERM`. Use the exec form `CMD ["node", "server.mjs"]` (not `CMD node server.mjs` and not `npm start`).
- The stack is not healthy: `docker compose ps`, then `docker compose logs <service>`. The worker needs the api; the api needs the database password in `POSTGRES_PASSWORD`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 14`.

## Next

Part 2 builds the pipeline and ships these images to a production host that lives on your machine.
