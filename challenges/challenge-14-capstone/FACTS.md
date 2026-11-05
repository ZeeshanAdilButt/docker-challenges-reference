# Facts of challenge 14 (the capstone)

Every number a chapter may quote. Names are `c14.p<part>.<what>`; the unit is the last word of the name (`_s` seconds, `_mb` megabytes, `_count` a count). Booleans and strings carry no unit. Timings that matter are the median of three runs. Values are in `facts.json` after a run; the recorded values are those of the reference run (see each part's `results.md`). `<service>` is `api`, `worker` or `web`.

## Part 1: containerize

| Fact | Meaning | How it was measured |
|---|---|---|
| `c14.p1.<service>_pinned`, `c14.p1.<service>_from_count` | Every base image is pinned by digest; number of `FROM` lines | `FROM` lines of the Dockerfile; a base is pinned when it ends in `@sha256:` and 64 hexadecimal characters; stage names are not images |
| `c14.p1.<service>_dockerignore` | The build context has a `.dockerignore` | File exists |
| `c14.p1.api_multistage`, `c14.p1.api_test_stage` | The api builds in two or more stages and one stage is named `test` | Dockerfile text |
| `c14.p1.<service>_check_warnings_count` | Warnings of the Dockerfile review | `docker build --check`, number in "Check complete" |
| `c14.p1.<service>_build_cold_s` | Build time without the layer cache | Median of three `docker build --no-cache` |
| `c14.p1.<service>_size_mb` | Image size | `docker image inspect --format "{{.Size}}"` divided by one million |
| `c14.p1.<service>_user_root` | The image runs as uid 0 | `docker run --entrypoint id <image> -u` |
| `c14.p1.<service>_secret_leaks_count` | Places where the planted word `supersecret` is found: history, environment, files | `docker image history --no-trunc`, `docker image inspect`, `grep -rl` inside the image |
| `c14.p1.<service>_stop_s`, `c14.p1.<service>_stop_exit_code` | Time `docker stop -t 5` takes, and the exit code | Median of three runs; exit code of the last |
| `c14.p1.api_deps_cached_on_edit`, `c14.p1.api_edit_rebuild_s` | The package install step is `CACHED` after an edit of `server.mjs` (all three edits); rebuild time | Plain build log; median of three |
| `c14.p1.compose_services_count`, `c14.p1.compose_containers_count` | Services in the compose file; containers started | `docker compose config`; `docker compose ps` |
| `c14.p1.compose_db_published` | The database publishes a port | `ports` of `db` in the resolved config |
| `c14.p1.compose_healthchecks_count`, `c14.p1.compose_wait_for_healthy` | Services (of db, api, worker, web) with a health check; dependants wait with `condition: service_healthy` | Resolved config |
| `c14.p1.compose_limits_count`, `c14.p1.compose_hardened_count`, `c14.p1.compose_restart_count` | Services with a memory limit (of 4); api, worker and web with read-only root, `cap_drop: ALL` and `no-new-privileges` (of 3); services with a restart policy (of 4) | Resolved config |
| `c14.p1.compose_has_profile`, `c14.p1.compose_has_watch` | A service in a profile; `develop.watch` on the api | Resolved config |
| `c14.p1.compose_literal_secret`, `c14.p1.compose_version_key`, `c14.p1.compose_db_pinned` | A secret written in the file; an obsolete `version:` key; the database image has a digest | Text of the file; resolved config |
| `c14.p1.compose_up_s`, `c14.p1.compose_up_ok`, `c14.p1.compose_healthy_count` | Time of `docker compose up -d --build --wait`; it succeeded; containers reporting `healthy` | Wall clock; `docker inspect` |
| `c14.p1.compose_e2e_ok`, `c14.p1.compose_e2e_s` | Five jobs posted to `/api/jobs` on the web port all reach `done`; time | HTTP from the script |
| `c14.p1.readme_stale_count`, `c14.p1.readme_missing_count` | Stale words in `README.md` (`mysql`, `docker-compose`, `node 16`, `pm2`, `scp`, `start:all`); required words missing (`docker compose up`, `.env`, `POSTGRES_PASSWORD`) | Text search |

## Part 2: pipeline and ship

| Fact | Meaning | How it was measured |
|---|---|---|
| `c14.p2.workflow_actions_count`, `c14.p2.workflow_unpinned_count`, `c14.p2.workflow_write_all`, `c14.p2.workflow_pull_request_target`, `c14.p2.workflow_least_privilege_jobs`, `c14.p2.workflow_push_guarded`, `c14.p2.workflow_push_always`, `c14.p2.workflow_hardcoded_secret`, `c14.p2.workflow_uses_github_token`, `c14.p2.workflow_prints_digest`, `c14.p2.workflow_deploy_needs_build`, `c14.p2.workflow_cache_gha`, `c14.p2.workflow_has_test_step`, `c14.p2.workflow_builds_all` | Text checks of `.github/workflows/ship.yml` (comments ignored) | Same checks as `c13.p1.workflow_*`, plus the layer cache and that all three images are built |
| `c14.p2.pipeline_<service>_ok` | The local pipeline of the service passed every stage | Stage results |
| `c14.p2.pipeline_order_ok` | Tests and scan before the push, sign after it | Position of the stages in `pipeline.json` |
| `c14.p2.tags_include_sha` | A `sha-<7>` tag was pushed | Tags of the api |
| `c14.p2.scan_status`, `c14.p2.sbom_status`, `c14.p2.sign_status` | `ok`, `skipped` (until challenge 12), `failed` or `partial` | Stage results of the three services |
| `c14.p2.host_start_s`, `c14.p2.db_start_s`, `c14.p2.first_deploy_s` | Time to start the host and its proxy, the database, and the first deploy of the three services | Wall clock |
| `c14.p2.deploy_ok`, `c14.p2.deploy_digests_match`, `c14.p2.prod_e2e_ok` | The first deploy worked; running digests equal pushed digests; a job posted on the host reaches `done` | `compose up --wait`; `RepoDigests` on the host; HTTP |
| `c14.p2.rollout_s`, `c14.p2.rollback_s` | Rollout and rollback time | Median of three cycles |
| `c14.p2.rollout_failed_count`, `c14.p2.rollout_total_count`, `c14.p2.rollback_failed_count` | Failed and sent requests over the three rollouts; failed requests over the three rollbacks | Load generator, 6 clients, paths `/`, `/api/`, `/api/jobs` |
| `c14.p2.rollout_both_versions`, `c14.p2.rollback_digests_match` | Both versions answered in every rollout; each rollback landed on the version 1 digests | Version field through `/api/`; `RepoDigests` |
| `c14.p2.prod_images_by_digest`, `c14.p2.prod_secret_literal`, `c14.p2.prod_health_count`, `c14.p2.prod_limits_count`, `c14.p2.prod_restart_count` | Reading of `compose.prod.yaml` | `docker compose config --format json` |
| `c14.p2.host_mem_used_mb` | Memory the host container uses at the end | `docker stats --no-stream` |

## Part 3: break it

| Fact | Meaning | How it was measured |
|---|---|---|
| `c14.p3.kill_recovered`, `c14.p3.kill_recovery_s` | After `GET /crash` the api answers `/api/ready` again; how long (40 s is the cap) | Polling every 100 ms through the web page |
| `c14.p3.kill_restart_count` | `RestartCount` of the api | `docker inspect` |
| `c14.p3.kill_jobs_total_count`, `c14.p3.kill_jobs_lost_count`, `c14.p3.kill_all_done_s` | Jobs queued before the crash; jobs not done after 40 s; time until all were done | HTTP |
| `c14.p3.starve_limit_mb` | Memory limit of the api | `docker compose config` |
| `c14.p3.starve_oom_killed` | Docker recorded an out-of-memory event for the api | `docker events --filter event=oom` |
| `c14.p3.starve_recovered`, `c14.p3.starve_recovery_s` | The api answers again; time after the last `/alloc` call | Polling |
| `c14.p3.starve_worker_unaffected` | Worker and database never restarted and the jobs queued afterwards finished | `docker inspect`; HTTP |
| `c14.p3.misconfig_detected`, `c14.p3.misconfig_detect_s` | `docker compose up --wait` with a wrong password returned an error; after how long (40 s is the cap) | Exit code and wall clock |
| `c14.p3.misconfig_really_broken`, `c14.p3.misconfig_silent` | `/api/ready` did not answer 200; the deploy reported success anyway | HTTP; exit code |
| `c14.p3.runbook_entries_count`, `c14.p3.runbook_complete_count`, `c14.p3.runbook_numbers_match` | Entries found, entries with every field, and whether each **Measured:** number is within half (at least 2 s) of the number measured in this run | Text of `RUNBOOK.md` |

## Part 4: defend it

| Fact | Meaning | How it was measured |
|---|---|---|
| `c14.p4.defence_sections_count`, `c14.p4.defence_words_count` | Required headings found (of 5); words of `DEFENCE.md` without headings and template lines | Text of the file |
| `c14.p4.defence_numbers_matched_count`, `c14.p4.defence_numbers_possible_count` | Facts of parts 1 to 3 quoted in the text with a unit (within a quarter, at least 0.6); facts that could be quoted | Text of the file against `facts.json` |
| `c14.p4.probes_total_count`, `c14.p4.probes_ok_count` | Answers in `PROBES.md`; answers with 60 to 200 words that mention the ideas of their question | Text of the file |
| `c14.p4.rubric_percent`, `c14.p4.rubric_points_earned`, `c14.p4.rubric_points_available`, `c14.p4.rubric_pending_count` | The whole rubric: percent, points earned, points that count, criteria pending until challenge 12 | `rubric.mjs` over the facts |
