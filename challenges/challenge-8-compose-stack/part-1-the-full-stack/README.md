# Challenge 8, part 1: the full stack, then kill the database

**Time:** about 60 minutes. **Download:** three images you may already have: `postgres:18-alpine` (about 120 MB to download), `node:24-alpine` (about 62 MB, used to build the app image) and `valkey/valkey:9-alpine` (about 19 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A new teammate clones the repo, runs `docker compose up`, and the API exits with "connection refused". They run it again and it works. Nobody knows why. Last week the database restarted for a minute, and the worker never picked up another job. Both problems come from one wrong belief: that Compose starts things "in order, when they are ready". It does neither.

## The idea

A Compose file is a map of the whole stack: services, the networks that join them, and the volumes that keep their data. One command, `docker compose up`, builds the stack on your laptop in the same shape on every machine.

This stack has five pieces: `db` (Postgres), `cache` (Valkey), `migrate` (a one-shot job that creates the tables), `api` (HTTP) and `worker` (takes jobs from the cache and writes them to the database). A sixth, `psql`, is a tool you start on demand.

Five ideas separate a stack that works from one that works on a good day:

1. **`depends_on` alone waits for "started", not for "ready".** A database container is "started" a second after it is created, and it accepts connections four seconds later. To wait for ready, give the dependency a `healthcheck` and write `condition: service_healthy`.
2. **A migration is a job, not a service.** It runs once and exits. The services that need the tables wait for `condition: service_completed_successfully`.
3. **The app retries too.** A health condition only covers the first start. If the database restarts later, the app is on its own. Here `STARTUP_RETRIES` makes the app try again instead of exiting on the first refused connection.
4. **A restart policy brings back what crashes.** `restart: unless-stopped` restarts a container that exits with an error. Without it, a crash is permanent. The policy does not apply to a container you stopped by hand, including with `docker kill`.
5. **A profile keeps tools out of the way.** A service with `profiles: ["tools"]` is not started by `up`. You ask for it: `docker compose --profile tools run --rm psql`.

The starter `compose.yaml` has none of this: no health checks, plain `depends_on`, no restart policies, no retries, and `psql` starts with the stack. You fix it, then kill the database and measure what comes back.

The app is small and has no packages: `stack/src/api.mjs` and `stack/src/worker.mjs`, with tiny Postgres and Valkey clients. Read them if you are curious. You do not edit them.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-8-compose-stack/part-1-the-full-stack/test.mjs` | Tests **fail** on purpose. The static checks list what is missing. |
| 2 | `node challenges/challenge-8-compose-stack/part-1-the-full-stack/run.mjs` | Builds the app image, runs `docker compose -p dkr-c8 up -d`. With the starter, `migrate` and `api` exit with errors and the script gives up after 45 s. |
| 3 | Open `compose.yaml` and fix the five things above. | Use `reference/compose.yaml` only if you are stuck. |
| 4 | `node challenges/challenge-8-compose-stack/part-1-the-full-stack/run.mjs --record` | Boots the stack three times and times it, pushes jobs through, crashes the database, and watches. Writes `results.md` and `chart.svg`. |
| 5 | `node toolkit/show-facts.mjs c8.p1` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-8-compose-stack/part-1-the-full-stack/test.mjs` | All tests pass. |

What step 4 does, in order:

1. Boots the stack three times with `up -d` and times how long until `GET /ready` answers 200. After each boot but the last, `down -v` tears it down.
2. Posts a note, pushes 5 jobs, and waits for the worker to write 5 rows.
3. Runs `docker compose --profile tools run --rm psql -c "\dt"`.
4. Crashes the database (`docker exec dkr-c8-db-1 kill -QUIT 1`, which stops the Postgres process like a crash would) and watches `/ready` and `/health` until things are back.
5. Pushes 5 more jobs to see whether the worker survived.
6. Runs `docker kill` on the database and checks, after 8 s, whether the restart policy brought it back. Then starts it by hand.

All containers run under the project name `dkr-c8`, with memory, process and log caps. The script always ends with `docker compose down -v` and the label cleanup.

## What you should see

With the starter, several services (migrate, api, worker, psql) exit with errors, and the API never answers. With the fixed file, the API is ready in about ten seconds, the worker processes 5 of 5 jobs, and after the crash the database is back in a few seconds, the API finds it on its next request, and the worker restarts once and carries on. The `docker kill` is different: the container stays dead (exit code 137), because Docker treats `docker kill` and `docker stop` as "the user stopped it". The full recorded run is in [results.md](results.md).

![Seconds for the stack to start and to recover](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c8.p1.boot_ready` | Whether `GET /ready` returned 200 within 45 s of `up -d`. |
| `c8.p1.time_to_ready_s` | Median of three boots, from before `up -d` until `/ready` answers 200. If the stack never came up, the 45 s limit. |
| `c8.p1.default_services_count`, `c8.p1.crashed_services_count`, `c8.p1.psql_started_by_default` | `docker compose ps -a --format json` after the first boot: how many services exist, how many exited with a non-zero code, and whether the `psql` tool started. |
| `c8.p1.worker_processed_jobs_count`, `c8.p1.notes_written_count` | `GET /stats` after posting a note and 5 jobs. |
| `c8.p1.psql_profile_tables_count` | Table lines in the output of `\dt` through the `tools` profile. |
| `c8.p1.db_outage_api_alive` | `GET /health` answers 200 while the database is down. |
| `c8.p1.db_outage_detected_s` | Seconds from the crash until `/ready` first answers 503. |
| `c8.p1.db_outage_recovered`, `c8.p1.db_outage_recover_s` | Whether `/ready` answered 200 again within 45 s, and the seconds from the crash. |
| `c8.p1.worker_restarts_count` | `docker inspect` `RestartCount` of the worker after the outage. |
| `c8.p1.worker_after_outage_processed_count` | Rows the worker wrote for 5 jobs pushed after the outage. |
| `c8.p1.data_survived_outage` | The note written before the crash is still counted by `/stats`. |
| `c8.p1.docker_kill_restarted` | Whether the database was running again 8 s after `docker kill`. |

## What is different on Docker Desktop

- Compose here is the plugin that ships with Docker Desktop (`docker compose`, v5). On Linux Engine install the Compose plugin; the file works unchanged.
- The migration file is mounted from your computer (`../stack/migrations`). On Windows and macOS that goes through Docker Desktop's file sharing, which works for one small file. Do not do it for large source trees (challenge 8, part 2).
- A stopped container's name takes seconds to fail to resolve on Desktop (the lookup goes out to the host's DNS first). That is why the API gives each dependency check its own 1.5 s time limit in `/ready`. Without it, `/ready` hangs instead of answering 503.
- Startup times depend on your virtual machine and disk. Yours will differ from the recorded run.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- `service "x" depends on undefined service`: check the spelling of the service names in `depends_on`.
- The stack comes up but `/ready` stays 503: run `docker compose -p dkr-c8 logs api`. The API prints one JSON line per retry.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 8`, then `docker compose -p dkr-c8 down -v`.

## Next

Part 2 makes the edit-and-see loop fast with Compose watch.
