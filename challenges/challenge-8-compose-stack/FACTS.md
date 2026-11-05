# Facts of challenge 8

Every number a chapter may quote. Names are `c8.p<part>.<what>_<unit>`. Values come from the reference run on the machine named in each `results.md`. Timings that matter are the median of three runs. Booleans and counts are single observations. The project name is always `dkr-c8`.

## Part 1: the full stack, then kill the database

| Fact | Meaning | How it was measured |
|---|---|---|
| `c8.p1.boot_ready` | The api answered `/ready` with 200 within 45 s of `up -d` | `fetch` every 250 ms |
| `c8.p1.time_to_ready_s` | Seconds from before `docker compose up -d` until `/ready` is 200 | Median of three boots (`down -v` between boots). The 45 s limit if it never came up |
| `c8.p1.default_services_count` | Services present after `up -d` (including the exited migrate job) | `docker compose ps -a --format json` |
| `c8.p1.crashed_services_count` | Services that exited with a non-zero code | Same list |
| `c8.p1.psql_started_by_default` | Whether the `psql` tool started with a plain `up -d` | Same list |
| `c8.p1.worker_processed_jobs_count` | Rows the worker wrote for 5 jobs | `GET /stats` after `POST /jobs?n=5` |
| `c8.p1.notes_written_count` | Notes in the database after one `POST /notes` | `GET /stats` |
| `c8.p1.psql_profile_tables_count` | Tables listed by `\dt` through `--profile tools run --rm psql` | Count of `| table |` lines |
| `c8.p1.db_outage_api_alive` | `/health` answers 200 while the database is down | `fetch` right after the crash |
| `c8.p1.db_outage_detected_s` | Seconds from the crash until `/ready` first says 503 | Poll every 100 ms |
| `c8.p1.db_outage_recovered` | `/ready` is 200 again within 45 s | Poll every 250 ms |
| `c8.p1.db_outage_recover_s` | Seconds from the crash until `/ready` is 200 again (45 s limit if not) | Same poll |
| `c8.p1.worker_restarts_count` | `RestartCount` of the worker after the outage | `docker inspect` |
| `c8.p1.worker_after_outage_processed_count` | Rows written for 5 jobs pushed after recovery | `GET /stats` difference |
| `c8.p1.data_survived_outage` | The note written before the crash is still there | `GET /stats` |
| `c8.p1.docker_kill_restarted` | Whether the database was running again 8 s after `docker kill` | `docker inspect` `State.Status`. Written only if the stack recovered from the crash first |

The crash is `docker exec dkr-c8-db-1 kill -QUIT 1` (the Postgres main process stops at once). `docker kill` is measured separately because Docker treats it as a manual stop.

## Part 2: the dev loop with watch

| Fact | Meaning | How it was measured |
|---|---|---|
| `c8.p2.rebuild_edit_to_reload_ms` | Milliseconds from saving `app/src/message.mjs` to `GET /message` showing it, with `action: rebuild` | Median of three edits, poll every 20 ms |
| `c8.p2.sync_restart_edit_to_reload_ms` | The same with `action: sync+restart` | Same |
| `c8.p2.sync_watch_edit_to_reload_ms` | The same with `action: sync` and `node --watch-path=src` | Same |
| `c8.p2.sync_only_reloaded` | Whether one edit with `action: sync` and no reload tool showed up within 6 s | Poll |
| `c8.p2.your_edit_reloaded` | Whether the edits showed up with the learner's `compose.yaml` | Poll, 40 s limit per edit |
| `c8.p2.your_edit_to_reload_ms` | Median edit-to-reload with the learner's file (0 if it never showed up) | Same |
| `c8.p2.package_json_triggers_rebuild` | Whether editing `app/package.json` changed the image ID within 15 s | `docker image inspect` |

## Part 3: a CI integration test

| Fact | Meaning | How it was measured |
|---|---|---|
| `c8.p3.normal_pass_count` | Normal runs of `ci.mjs` (out of 3) that exited 0 | Exit codes |
| `c8.p3.normal_total_s` | Median wall time of a normal run, build to clean-up | `process.hrtime` around `ci.mjs` |
| `c8.p3.passing_run_leftover_containers_count` | Containers of project `dkr-c8` left after the first normal run | `docker ps -a` with the project label |
| `c8.p3.slow_start_passes` | `ci.mjs` passes when the api needs 12 s to start listening | `API_START_DELAY_MS=12000` |
| `c8.p3.slow_start_total_s` | Wall time of that run | Same |
| `c8.p3.failing_run_exit_nonzero` | `ci.mjs` exits non-zero when the test fails on purpose | `CI_EXPECT_VERSION=999` |
| `c8.p3.failing_run_leftover_containers_count` | Containers left after that run | Same count |
