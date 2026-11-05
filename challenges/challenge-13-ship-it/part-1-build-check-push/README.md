# Challenge 13, part 1: build, check, push

**Time:** about 45 minutes. **Download:** `registry:3` (about 21 MB packed) and `node:24-alpine` (about 63 MB packed). If you did earlier challenges you already have both. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

It is Friday, 16:40. Someone merges a small change. The pipeline goes red on the unit tests, and the image is in the registry anyway, because the push came before the test. Three minutes later the host pulls `latest` and the service answers 500 to every request.

A pipeline is a list of gates. The order of the gates matters as much as having them. In this part you fix a pipeline that is in the wrong order and a workflow file that trusts too much.

## The idea

A **pipeline** is the same steps run the same way on every change. For an image the steps are:

| Stage | The question it answers |
|---|---|
| `lint` | Does the Dockerfile follow the rules? (`docker build --check`) |
| `build` | Can the image be built at all? |
| `test` | Do the unit tests pass? (a `test` stage in the Dockerfile) |
| `scan` | Does it carry known vulnerabilities? (tools arrive in challenge 12) |
| `sbom` | What is inside it? (challenge 12) |
| `push` | Put it in the registry under a name that says which commit built it. |
| `sign` | Prove who made it. A signature belongs to a digest that is already in the registry. (challenge 12) |

Two rules decide most of what can go wrong.

1. **Nothing leaves the building before every check has passed.** `push` comes after `test` and `scan`.
2. **A tag must say which commit built it.** `latest` is a name that moves. `sha-a1b2c3d` never moves.

The pipeline also runs with **least privilege**. On GitHub that means: every action is pinned to a full commit (a tag can be moved, a commit cannot), each job asks for only the permissions it needs, a pull request from a fork never gets your secrets and never pushes, and the push uses the token GitHub gives that one run instead of a password you pasted.

**The GitHub run is your own.** This machine cannot run GitHub Actions and never logs in to GHCR. You get two things: `workflow/ship.yml`, the file you would put in your own repository, and `run.mjs`, which runs the same stages in the same order against a registry on your machine. The workflow is checked as text. When you run it on GitHub, expect: a pull request builds and tests but does not push; a push to `main` pushes `sha-<7 characters>` and the version, and the `deploy` job receives the digest as an output. `scan`, `sbom` and `sign` are placeholders until challenge 12.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-13-ship-it/part-1-build-check-push/test.mjs` | Fails on purpose. Read each message. |
| 2 | `node challenges/challenge-13-ship-it/part-1-build-check-push/run.mjs` | Runs your pipeline on a good commit and on a bad one (the unit test fails). |
| 3 | Edit `pipeline.json`: the order of `stages`, and `tags`. | Valid stages: `lint`, `build`, `test`, `scan`, `sbom`, `sign`, `push`. Valid tags: `sha`, `version`, `latest`. |
| 4 | Edit `workflow/ship.yml` | Pin the actions, narrow the permissions, guard the push, pass the digest on. |
| 5 | Run steps 2 and 1 again | The test goes green when the bad commit never reaches the registry and the workflow is safe. |
| 6 | `node toolkit/show-facts.mjs c13.p1` | Shows the saved numbers. |

What step 2 does, in order:

1. Starts a registry (`registry:3`) on your machine, in a capped container.
2. Reads `workflow/ship.yml` as text and counts what is unsafe.
3. Runs your stages on a good commit. The unit tests are a stage of the Dockerfile (`docker build --target test`).
4. Plants a bug in a copy of the service (`/health` answers 500) and runs the pipeline again. Then it asks the registry whether any new image arrived.
5. Lists the tags of the good commit and the digest behind each.
6. Times `docker build` three times without the layer cache and three times with it.

Finding the commit for an action: `gh api repos/docker/login-action/commits/v4.7.0 -q .sha` prints the 40 characters. Write `uses: docker/login-action@<those 40 characters> # v4.7.0`. The reference `workflow/ship.yml` already holds the commits for the five actions used here; check one yourself before you trust it.

## What you should see

On the starter, the bad commit fails at `test` and its image is already in the registry. `latest` now points at it. With the stages in the right order, the pipeline stops at `test` and the registry gets no new image. The full recorded run is in [results.md](results.md). Your times will differ.

![Where the time goes in one pipeline run](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c13.p1.workflow_unpinned_count` | Lines `uses:` in the workflow whose version is not 40 hexadecimal characters. |
| `c13.p1.workflow_write_all`, `..._pull_request_target`, `..._push_guarded`, `..._hardcoded_secret` and the other `workflow_*` facts | Text checks on `workflow/ship.yml`. Comments are ignored. |
| `c13.p1.good_run_ok`, `c13.p1.good_stages_ok_count`, `c13.p1.good_stages_skipped_count` | The result of each stage for the good commit. A stage that needs a challenge 12 tool says `skipped`. |
| `c13.p1.good_digest` | The `Docker-Content-Digest` header the registry sends for the first tag of the good commit. |
| `c13.p1.good_pipeline_s` | Sum of the stage times of the good commit. |
| `c13.p1.bad_image_pushed` | The digests behind every tag in the registry before and after the bad commit. A new digest means a push. |
| `c13.p1.tests_before_push`, `scan_before_push`, `sign_after_push`, `lint_first` | The position of the stages in `pipeline.json`. |
| `c13.p1.tags_include_sha`, `c13.p1.latest_only` | The tags the good commit pushed. |
| `c13.p1.build_cold_s`, `c13.p1.build_warm_s` | Median of three `docker build` runs, with `--no-cache` and with the layer cache. |

## What is different on Docker Desktop

- The registry is published on a fixed port on `127.0.0.1`. On Docker Desktop the Docker engine runs in a virtual machine and can push to a published port only when the port is fixed, so `run.mjs` picks a free one itself.
- On Linux the build times are usually lower, and the first pull of `node:24-alpine` is the only slow step.

## Stuck?

- `Docker is not ready`: start Docker Desktop and wait until it says running.
- A stage says `failed` with a long message: read its last line. For `lint`, run `docker build --check challenges/challenge-13-ship-it/app` yourself.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 13`.

## Next

Part 2 ships the image to a production host that lives on your machine.
