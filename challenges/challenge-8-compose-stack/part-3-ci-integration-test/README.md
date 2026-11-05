# Challenge 8, part 3: a CI integration test that does not flake or leak

**Time:** about 45 minutes. **Download:** three images you may already have: `postgres:18-alpine` (about 120 MB to download), `node:24-alpine` (about 62 MB) and `valkey/valkey:9-alpine` (about 19 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

The integration test passes on your laptop and fails on the CI runner "sometimes". Re-running the job fixes it. Then one day a test fails for a real reason, the job stops there, and the stack it started keeps running on the runner. The next job finds a port taken and fails for a reason nobody can see. Two bad habits cause most of this: waiting a fixed time, and cleaning up only when things go well.

## The idea

An integration test pipeline has four steps: build, start the stack, run the tests, tear it down. Each has one way to go wrong.

- **Start.** `docker compose up -d` returns when the containers are created, not when the app answers. A pipeline that sleeps three seconds and then tests is a bet on how fast the runner is. Use `docker compose up -d --wait` instead: it returns when every service with a health check is healthy, and exits with an error if one never gets there (`--wait-timeout` sets how long). The health check is the contract: the stack says when it is ready.
- **Test.** The tests talk to the stack from outside, through its published port. They check that the pieces work together: the api, the database, the cache and the worker.
- **Tear down.** `docker compose down -v` runs in a `finally` block (or `if: always()` in GitHub Actions), so it runs when the tests fail, when the start fails, and when someone cancels the job. `-v` removes the volumes, `--remove-orphans` removes containers of services you deleted from the file.
- **Report.** The pipeline must still exit with a non-zero code when the tests fail. Cleaning up must not hide the failure.

`ci.mjs` is the pipeline as a script, so you can run it on your laptop in the same way the CI job does. `ci.yml` is the same pipeline as a GitHub Actions job. The starter `ci.mjs` has both bad habits: a fixed three-second sleep, and an early `process.exit` before the tear down when the tests fail.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-8-compose-stack/part-3-ci-integration-test/test.mjs` | Tests **fail** on purpose. The static checks look at `ci.mjs`. |
| 2 | `node challenges/challenge-8-compose-stack/part-3-ci-integration-test/run.mjs` | Runs `ci.mjs` three times normally, once with an api that needs 12 s to warm up, and once with a test that fails on purpose. With the starter, the slow run fails and the failing run leaves containers behind. |
| 3 | Open `ci.mjs`. Replace the sleep with `up -d --wait --wait-timeout 90`. Put the `down` in a `finally` block. Keep the exit code of the tests. | The reference file is only a few lines longer. |
| 4 | `node challenges/challenge-8-compose-stack/part-3-ci-integration-test/run.mjs --record` | All three situations behave. Writes `results.md` and `chart.svg`. |
| 5 | `node toolkit/show-facts.mjs c8.p3` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-8-compose-stack/part-3-ci-integration-test/test.mjs` | All tests pass. |

The three situations, and what each one proves:

1. **Normal.** Three runs. They must all pass and leave nothing behind. The median time is the cost of your pipeline.
2. **Slow warm-up.** The api waits 12 s before it listens (`API_START_DELAY_MS=12000`), like an app that loads a model or fills a cache. A fixed 3 s sleep is too short and the test fails with "connection refused", which has nothing to do with your code. `--wait` waits for the api's own health check.
3. **Failing test.** The test expects version 999 and the stack runs version 1 (`CI_EXPECT_VERSION=999`). The pipeline must exit non-zero, and no container may be left.

After each situation `run.mjs` counts the containers of the project `dkr-c8` and then removes them itself, so one bad run cannot spoil the next.

`ci.yml` is the same job for GitHub Actions. It pins `actions/checkout` to a full commit SHA (the tag `v7.0.1`; a tag can be moved, a SHA cannot). **The GitHub run is yours:** copy it to `.github/workflows/integration.yml` in your own repository and push. This challenge cannot run GitHub Actions for you. Expect the job to take about as long as the local run plus the image pulls on a clean runner, and to show the log of the services if a step fails.

## What you should see

With the starter, the normal runs pass, the slow run fails, and the failing run exits non-zero but leaves the whole stack running. With the fixed `ci.mjs` all three behave. The full recorded run is in [results.md](results.md).

![Seconds from build to clean-up](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c8.p3.normal_pass_count` | How many of three normal runs of `ci.mjs` exited with 0. |
| `c8.p3.normal_total_s` | Median wall time of those three runs, from the start of `ci.mjs` until it exits. |
| `c8.p3.passing_run_leftover_containers_count` | Containers of the project `dkr-c8` still present right after the first normal run. |
| `c8.p3.slow_start_passes`, `c8.p3.slow_start_total_s` | Whether `ci.mjs` passed with the 12 s warm-up, and how long it took. |
| `c8.p3.failing_run_exit_nonzero` | Whether `ci.mjs` exited with a non-zero code when the test failed on purpose. |
| `c8.p3.failing_run_leftover_containers_count` | Containers of the project left right after that failing run. |

## What is different on Docker Desktop

- On a GitHub-hosted runner (Linux) the first run also pulls the images, which adds time you do not see here because the images are cached on your machine. Cache them in CI if the pulls are slow.
- `docker compose up --wait` needs Compose v2.1 or newer. Docker Desktop ships it. On Linux Engine install the Compose plugin.
- Published ports: the stack publishes the api on `127.0.0.1` and a random free port. A CI runner is a fresh machine, so a fixed port would also work there, but a random port keeps parallel jobs apart.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- `--wait` times out: run `docker compose -p dkr-c8 ps -a` and look at the health column. `docker compose -p dkr-c8 logs api` shows why.
- A test says "connection refused": the stack is not ready yet, or the port in `API_URL` is wrong.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 8`.

## Next

Challenge 9 turns to deploys: restarting a service without dropping a request.
