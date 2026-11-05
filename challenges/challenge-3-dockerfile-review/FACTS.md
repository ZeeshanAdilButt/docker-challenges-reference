# Facts of challenge 3

Every fact is saved by `run.mjs` through `toolkit/facts.js` into `facts.json`. Names are `c3.p<part>.<what>_<unit>`. Values come from the reference run on Windows 11, Docker Desktop 29.9.2, Node 22.22.2, 2026-11-05. Timings are the median of three runs. All secrets in this challenge are made up and open nothing.

## Part 1: five bad Dockerfiles

`NN` is the Dockerfile number: `01` unpinned-root, `02` cache-buster, `03` leaky-env, `04` add-and-shell, `05` no-ignore.

| Fact | Meaning | How it was measured |
|---|---|---|
| `c3.p1.fNN_findings_before_count`, `c3.p1.fNN_findings_after_count` | Problems the reviewer (`review.mjs`) finds in the original (`faults/`) and in the learner's file | Static review of the Dockerfile |
| `c3.p1.fNN_check_warnings_before_count`, `c3.p1.fNN_check_warnings_after_count` | `WARNING:` rules reported by `docker build --check` | Count of `WARNING: <Rule>` lines |
| `c3.p1.fNN_original_ok`, `c3.p1.fNN_fixed_ok` | The property test for that fault passed, on the original and on the learner's file | Real build, then the check named below |
| `c3.p1.findings_before_total`, `c3.p1.findings_after_total` | Sums of the reviewer findings | Sum |
| `c3.p1.check_warnings_before_total`, `c3.p1.check_warnings_after_total` | Sums of the BuildKit warnings | Sum |
| `c3.p1.fixed_ok_count` | How many of the five learner files pass | Count |
| `c3.p1.rebuild_original_s`, `c3.p1.rebuild_fixed_s` | Seconds to rebuild `02` after a one-line change in `server.mjs` | Median of 3 builds, each with a different appended comment |
| `c3.p1.pid1_original`, `c3.p1.pid1_fixed` | PID of node in the `04` container (-1 if it could not be tested) | `GET /pid` inside the container |
| `c3.p1.leftover_count` | Objects with the label after cleanup | `leftovers(3)` |

Property per fault: `01` user id is not 0 and the base is not `latest` or untagged; `02` the `npm ci` step is `CACHED` after a code change; `03` the made-up secret is not in `docker inspect` Env or `docker history`; `04` node is PID 1; `05` `.env.local`, `notes` and `test.mjs` are not in `/app`. The original `01` uses `node:latest`, which is not on the machine, so it is reviewed but not built (`c3.p1.f01_original_ok` is false by the review, not by a build).

## Part 2: signals and PID 1

Variants `<v>`: `shell_cmd` (`CMD node server.mjs; echo`), `shell_plain` (`CMD node server.mjs`), `npm_shell` (`CMD npm start`), `npm_exec` (`CMD ["npm","start"]`), `entry_noexec` (script without exec), `entry_exec` (script with exec), `node_exec` (`CMD ["node","server.mjs"]`), `init_flag` (`shell_cmd` run with `--init`), `init_node` (`node_exec` run with `--init`).

| Fact | Meaning | How it was measured |
|---|---|---|
| `c3.p2.<v>_stop_s` | Seconds `docker stop` (no `-t`) took | Median of 3, timed around the command |
| `c3.p2.<v>_exit_code` | Exit code after the stop | `docker inspect` `.State.ExitCode` |
| `c3.p2.<v>_graceful` | The service logged `shutdown` with `SIGTERM` | `docker logs` |
| `c3.p2.<v>_pid1_text` | What PID 1 is | `/proc/1/cmdline`, first 60 characters |
| `c3.p2.default_stop_s`, `c3.p2.stop_t1_s`, `c3.p2.stop_t3_s`, `c3.p2.stop_t10_s` | `docker stop` of a container that ignores SIGTERM, with no option, `-t 1`, `-t 3`, `-t 10` | Median of 3 each |
| `c3.p2.default_stop_closest_t_s` | Which of 1, 3 and 10 the default time is closest to | Computed |
| `c3.p2.mine_stop_s`, `c3.p2.mine_exit_code`, `c3.p2.mine_graceful`, `c3.p2.mine_prepared`, `c3.p2.mine_pid1_is_node` | The learner's `Dockerfile.signals` | Same measurements; `mine_prepared` is whether the entrypoint printed its line |
| `c3.p2.leftover_count` | Objects with the label after cleanup | `leftovers(3)` |

## Part 3: multi-stage with a test target

| Fact | Meaning | How it was measured |
|---|---|---|
| `c3.p3.stage_count`, `c3.p3.has_test_stage` | `FROM` lines in the learner's Dockerfile, and whether one is `AS test` | Parsed Dockerfile |
| `c3.p3.single_root_mb`, `c3.p3.runtime_root_mb`, `c3.p3.saved_mb` | Root file system of the single-stage image, of the learner's runtime image, and the difference | `du -sx /` inside the image, in MB |
| `c3.p3.single_has_tests`, `c3.p3.single_has_toolchain` | `test.mjs` in `/app` and `toolchain` in `/opt` of the single-stage image | `ls` |
| `c3.p3.runtime_has_tests`, `c3.p3.runtime_has_toolchain` | The same in the learner's runtime image | `ls` |
| `c3.p3.runtime_user_id`, `c3.p3.runtime_healthy` | `id -u`, and whether `/health` answered | `docker run` |
| `c3.p3.test_target_builds`, `c3.p3.test_target_tests_run_count`, `c3.p3.test_target_build_s` | `--target test` built, tests reported by `node --test`, build time | Build log, built with `--no-cache-filter test` |
| `c3.p3.failing_test_blocks_build` | A copy of the code with one failing test failed the `--target test` build, with the failure in the output | Exit code and log |
| `c3.p3.leftover_count` | Objects with the label after cleanup | `leftovers(3)` |

## Part 4: build and run secrets

| Fact | Meaning | How it was measured |
|---|---|---|
| `c3.p4.original_history_has_token`, `c3.p4.mine_history_has_token` | The made-up build token is in `docker history --no-trunc` | String search |
| `c3.p4.original_config_has_token`, `c3.p4.mine_config_has_token` | It is in the image config | String search in the config from `docker save` |
| `c3.p4.original_layers_have_token`, `c3.p4.mine_layers_have_token` | It is in a file of a layer | Search of every regular file of every layer |
| `c3.p4.where_token_leaks_count` | Places (history, config, layers) where the original leaks | Count |
| `c3.p4.original_build_proof_ok`, `c3.p4.mine_build_proof_ok` | `build-proof.txt` holds the fingerprint of the token: the build could read it | Compare with sha256 of the token |
| `c3.p4.original_run_source`, `c3.p4.mine_run_source` | How the app got its key: `env` or `file` | `check-secret.mjs` |
| `c3.p4.original_inspect_has_key`, `c3.p4.mine_inspect_has_key` | The made-up API key is in `docker inspect` (Env, Mounts, Binds) | String search |
| `c3.p4.mine_flags_have_key` | The key is one of the learner's `docker run` flags | String search |
| `c3.p4.mine_mount_readonly`, `c3.p4.mine_app_reads_key` | The secret mount is read-only; the app read the right key | `docker inspect`; fingerprint |
| `c3.p4.leftover_count` | Objects with the label after cleanup | `leftovers(3)` |
