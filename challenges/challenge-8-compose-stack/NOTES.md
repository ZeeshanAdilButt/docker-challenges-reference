# Notes for challenge 8 (compose stack)

## What each part proves

1. **The full stack.** Plain `depends_on`, no health checks, no restart policy and no retries leave the stack dead after `up -d` (migrate, api, worker and psql exit with errors). With health conditions, a one-shot migrate job, retries in the app, restart policies and the psql tool behind a profile, the api is ready in about ten seconds. After the database process crashes, the api answers 503 on `/ready` within a moment, the database restarts by itself, the worker restarts once, and no job or note is lost. The learner fixes `compose.yaml`.
2. **The dev loop with watch.** The same one-line edit takes many seconds with `rebuild`, a few with `sync+restart`, and about a second with `sync` plus `node --watch-path=src` in the container. `sync` alone never shows the change. A `package.json` edit must still rebuild. The learner fixes `compose.yaml`.
3. **CI integration test.** A fixed `sleep` makes the pipeline fail when the api is slow to start, and an early `process.exit` leaves the stack running after a failed test. `up -d --wait` and a `finally` block fix both. The learner fixes `ci.mjs`. `ci.yml` is the same job for GitHub Actions (checkout pinned to the full SHA of `v7.0.1`, `3d3c42e5aac5ba805825da76410c181273ba90b1`, checked with `gh api`). The GitHub run is the learner's own; it was not run here.

## Decisions

- The app (`stack/`) is small and has no packages. It has its own minimal Postgres client (SCRAM-SHA-256 login, simple queries) and Valkey client, so the stack needs no npm install and no password hack in `pg_hba.conf`. It is not a model for production code.
- Each part is checked two ways: static (the learner's file read through `docker compose config --format json`, or the source of `ci.mjs`) and live (facts from `run.mjs`). `--reference` or `DKR_USE_REFERENCE=1` points a part at its `reference/` folder.
- All three parts use the project name `dkr-c8` and finish with `docker compose down -v` plus the label cleanup. Volumes seen on project containers are removed by exact name at the end. Images `dkr-c8-stack:1` and `dkr-c8-dev:1` are removed by their full tags.
- Part 3 raises the api warm-up to 12 s, not 6 s. With 6 s the starter passed anyway: Docker Desktop's port forwarder accepts the connection and the test's own 3 s fetch timeout bridged the gap together with the 3 s sleep.
- Part 2 edits `app/src/message.mjs` and `app/package.json` while it runs and restores both in `finally`. If a run is killed, set `message.mjs` back to `export const MESSAGE = 'v0';`.

## Findings that differ from what a reader might assume

- **`docker kill` is not undone by a restart policy.** The database with `restart: unless-stopped` stayed `exited 137` after `docker kill`. A crash of the Postgres process (`kill -QUIT 1` inside the container) was restarted. Part 1 records both. The dossier did not say this.
- **A stopped container's name takes seconds to fail to resolve on Docker Desktop** (the lookup goes out to the host DNS first, the same effect as the 4 s failed lookup of challenge 7). `/ready` therefore gives each dependency check a 1.5 s limit. Without it, `/ready` hung instead of answering 503.
- **Plain `node --watch` lost track after the first synced edit.** The second edit was copied but the server did not restart. `node --watch-path=src` watched the folder and worked for every edit.
- **`docker compose watch` needs a real stdin pipe** when spawned from a script. With stdin ignored the `rebuild` action failed silently.
- **On Windows `child.kill()` leaves `docker-compose.exe` running.** The script uses `taskkill /PID <pid> /T /F` on the process it started.
- **`AbortSignal.timeout` does not keep Node alive.** A stuck fetch ended the script with "unsettled top-level await". The helpers use `setTimeout` plus `AbortController`.
- **Timings move with load.** The `rebuild` edit-to-reload median was 8 s to 20 s on different runs, because other builders were using the same Docker. Quote the ordering and the ratio, not one number.

## What is different on Docker Desktop

See the box in each README: the Compose plugin, file sharing for the migration mount, the DNS delay, virtual machine start times, and file events travelling into the virtual machine.

## Not done

- The GitHub Actions job (`ci.yml`) was not run, as GitHub Actions cannot be run from here. `test.mjs` only checks that every `uses:` is pinned to a 40 character SHA.
- No Linux Engine run, so the statements about Linux in the READMEs are expectations from the documentation.
- `sync+exec` (the watch action marked unverified in the dossier) is not used.
