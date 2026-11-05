# Facts of challenge 13 (ship it)

Every number a chapter may quote. Names are `c13.p<part>.<what>`; the unit is the last word of the name (`_s` seconds, `_mb` megabytes, `_count` a count). Booleans and strings carry no unit. Timings that matter are the median of three runs. Values are in `facts.json` after a run; the recorded values are those of the reference run (see each part's `results.md`).

## Part 1: build, check, push

| Fact | Meaning | How it was measured |
|---|---|---|
| `c13.p1.workflow_actions_count` | Actions used by `workflow/ship.yml` | Count of `uses:` lines (comments ignored) |
| `c13.p1.workflow_unpinned_count` | Actions not pinned to a full commit | `uses:` whose version is not 40 hexadecimal characters |
| `c13.p1.workflow_write_all` | The file asks for `permissions: write-all` | Text check |
| `c13.p1.workflow_pull_request_target` | The file triggers on `pull_request_target` | Text check |
| `c13.p1.workflow_least_privilege_jobs` | At least two `permissions` blocks and no `write-all` | Text check |
| `c13.p1.workflow_push_guarded` | The `push:` input of build-push-action depends on the event | Text check for `push: ${{ ...event_name... }}` |
| `c13.p1.workflow_push_always` | The file has `push: true` | Text check |
| `c13.p1.workflow_hardcoded_secret` | A password or token is written in the file | Text check |
| `c13.p1.workflow_uses_github_token` | The login uses `secrets.GITHUB_TOKEN` | Text check |
| `c13.p1.workflow_prints_digest` | A step exports `outputs.digest` | Text check |
| `c13.p1.workflow_deploy_needs_build` | The deploy job `needs:` the build job | Text check |
| `c13.p1.workflow_has_test_step` | A build step has `target: test` | Text check |
| `c13.p1.workflow_has_scan_sbom_sign` | The words scan, sbom and sign each appear (placeholders are accepted) | Text check |
| `c13.p1.good_run_ok` | The good commit passed every stage | Result of the local pipeline |
| `c13.p1.good_stages_ok_count`, `c13.p1.good_stages_skipped_count` | Stages that passed, stages that were skipped (scan, sbom, sign wait for challenge 12) | Stage results |
| `c13.p1.good_pushed_tags_count` | Tags the good commit pushed | `docker push` per tag |
| `c13.p1.good_digest` | Digest of the good image in the registry | `Docker-Content-Digest` of a HEAD on the manifest |
| `c13.p1.good_pipeline_s` | Sum of the stage times of the good commit | Wall clock per stage |
| `c13.p1.tests_before_push`, `c13.p1.scan_before_push`, `c13.p1.sign_after_push`, `c13.p1.lint_first` | Order of stages in `pipeline.json` | Position of the stage names |
| `c13.p1.bad_run_ok`, `c13.p1.bad_failed_at` | The bad commit (`/health` answers 500) makes the pipeline fail, and at which stage | Result of the local pipeline |
| `c13.p1.bad_image_pushed` | A new image reached the registry from the bad commit | Digests behind every tag before and after |
| `c13.p1.tags_include_sha`, `c13.p1.latest_only` | The tags name the commit; `latest` is the only tag | Tags pushed |
| `c13.p1.build_cold_s`, `c13.p1.build_warm_s` | `docker build` with `--no-cache` and with the layer cache | Median of three each |
| `c13.p1.build_cache_hits_count` | Steps answered by the cache in a warm build | Count of `CACHED` lines in the plain build log |

## Part 2: deploy by digest

| Fact | Meaning | How it was measured |
|---|---|---|
| `c13.p2.host_start_s` | Time to start the Docker-in-Docker host and its API | `docker run` until the TLS API answers |
| `c13.p2.latest_moved` | `latest` names version 3 while version 2 is the one to deploy | Registry digests |
| `c13.p2.first_deploy_s` | First `compose up --wait`, including the pull | Wall clock |
| `c13.p2.careless_failed_count`, `c13.p2.careless_total_count` | Failed and sent requests during one rollout without a health check (the control) | Load generator, 6 clients |
| `c13.p2.rollout_s` | Time of a rollout, from `compose up` of the new colour until the old one is gone | Median of three |
| `c13.p2.rollout_failed_count`, `c13.p2.rollout_total_count` | Failed and sent requests over the three rollouts | Load generator |
| `c13.p2.rollout_both_versions_served`, `c13.p2.rollout_ok` | Both versions answered in every trial; every rollout succeeded | Version field of `GET /` |
| `c13.p2.intended_digest`, `c13.p2.running_digest`, `c13.p2.digest_match` | The digest to deploy, the digest of the running image, equal or not | `docker inspect` then `RepoDigests` on the host |
| `c13.p2.secret_literal_in_file`, `c13.p2.token_from_deploy_env`, `c13.p2.image_holds_secret` | Secret written in the compose file; running container holds the value the deploy passed; token found in the image history or config | Text check; `docker inspect` of the container; `docker image history --no-trunc` |
| `c13.p2.mem_limit_mb`, `c13.p2.pids_limit_count`, `c13.p2.health_status` | Limits and health status of the running container | `docker inspect` |
| `c13.p2.host_mem_used_mb` | Memory the host container uses at the end | `docker stats --no-stream` |

## Part 3: roll back

| Fact | Meaning | How it was measured |
|---|---|---|
| `c13.p3.plan_second_release` | `expand` or `rename`, from `release-plan.json` | The file |
| `c13.p3.tag_moved` | The tag `1.0.0` was re-pushed after release 1 was deployed | Registry digest of the tag |
| `c13.p3.rollback_by` | `digest` or `tag`: what `rollbackTarget()` returned | The function result |
| `c13.p3.rollback_digest_matches`, `c13.p3.rollback_version` | The host runs the digest of release 1; the version reported by `GET /` | `RepoDigests`; `GET /` |
| `c13.p3.data_readable_after_rollback`, `c13.p3.data_count_before_rollback`, `c13.p3.data_count_after_rollback`, `c13.p3.write_after_rollback` | `GET /customers` after the rollback answers 200 and shows every customer; `POST /customers` is accepted | HTTP through the proxy |
| `c13.p3.control_data_readable`, `c13.p3.control_digest_matches`, `c13.p3.control_rollback_s` | The same checks for the rename release rolled back by digest, and its rollback time | HTTP, `RepoDigests`, wall clock |
| `c13.p3.rollback_s` | Rollback time (deploy of the older digest until the other colour is gone) | Median of three |
| `c13.p3.drift_found_count`, `c13.p3.drift_expected_count` | Containers on the host that no compose project owns or that run another digest; the number expected (1) | `docker ps` labels and `RepoDigests` |

## Part 4: three drills

| Fact | Meaning | How it was measured |
|---|---|---|
| `c13.p4.kill_restart_policy` | Restart policy of the running container | `docker inspect` |
| `c13.p4.kill_recovered`, `c13.p4.kill_recovery_s` | After `kill -9` of the main process (sent from the host side) `/ready` answers again; how long it took (30 s is the cap) | Polling every 100 ms |
| `c13.p4.kill_failed_count`, `c13.p4.kill_restart_count` | Failed requests during the drill; `RestartCount` | Load generator; `docker inspect` |
| `c13.p4.registry_down_redeploy_ok`, `c13.p4.registry_down_deploy_s`, `c13.p4.registry_down_failed_count` | Redeploy of the same digest while the registry is stopped: worked, how long, failed requests | `compose up --wait`; load generator |
| `c13.p4.bad_release_rejected`, `c13.p4.bad_release_detect_s` | A release whose `/ready` never answers 200 was refused; after how long | `compose up --wait` result and wall clock |
| `c13.p4.bad_release_old_still_serving`, `c13.p4.bad_release_failed_count` | `GET /` still answers version 1.0.0 afterwards; failed requests during the attempt | HTTP; load generator |
