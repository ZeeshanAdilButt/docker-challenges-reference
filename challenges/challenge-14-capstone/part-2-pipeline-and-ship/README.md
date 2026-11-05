# Challenge 14, part 2: pipeline and ship it

**Time:** about 3 hours. **Download:** `docker:29-dind` (about 122 MB packed), `registry:3` (about 21 MB), `nginx:1.27-alpine` (about 21 MB) and the images of part 1 (`node:24-alpine`, `python:3.12-slim`, `postgres:18-alpine`). If you did challenge 13 and part 1 you have them all. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Your three images build on your laptop. A production system needs them built the same way every time, checked before they leave, named so that nobody can confuse two versions, and placed on a host without dropping a single customer request. And it needs a way back that takes minutes, not an evening.

Challenge 13 did this for one service. Here you do it for three that depend on each other, with a database they share.

## The idea

Everything you need is in challenge 13. What is new is that a release is **three digests that travel together**, and a rollout must keep the whole system answering.

- **The pipeline** has the stages you know: `lint`, `build`, `test` (only the api has a `test` stage), `scan`, `sbom`, `push`, `sign`, in an order where nothing leaves before every check has passed. `scan`, `sbom` and `sign` run the hooks of challenge 12 (`challenges/challenge-12-scan-harden-sign/hooks/`): the scanner pinned by digest, an SPDX SBOM, and a signature made with a throwaway key and checked at once. If a hook file is missing, the stage says `skipped: filled in after challenge 12` and the rubric lists its criteria as pending. The first scan downloads the scanner database (139 MB, about 1.7 GB on disk) unless you set `DKR_SCAN_OFFLINE=1` (then the scan is `partial`, not `ok`).
- **The GitHub half** is `.github/workflows/ship.yml`: every action pinned to a full commit, nothing pushed from a pull request, least privilege per job, a layer cache (`type=gha`), and the three digests handed to the deploy job. **The GitHub run is your own.** This machine cannot run GitHub Actions and never logs in to GHCR. The workflow is checked as text, and `run.mjs` runs the same stages against a registry on your machine. On GitHub, expect: a pull request builds and tests but pushes nothing; a push to `main` pushes `sha-<7>` and the version for each image, and the `deploy` job gets three digests.
- **The deploy** is `compose.prod.yaml`, which names every image by digest. The database is a fixed file, `data.compose.yaml`, started once and never replaced during a rollout. A rollout starts the next colour (a full copy of api, worker and web), waits until all three report healthy, moves the proxy, lets the old colour drain and removes it. A rollback is the same rollout with the previous digests.
- **The production host** is one Docker engine inside a container (`docker:29-dind`), named `dkr-c14-prod`. A Docker engine needs `--privileged` to start inside a container. **This is the single named exception to the rule "no `--privileged`" in this course**, allowed only in challenges 13 and 14. It is one container, labelled `dkr.challenge=14`, with a memory limit (6 GB), a process limit and a size-capped `tmpfs` as its disk. You reach its Docker API over TLS with a client certificate made for this run, on `127.0.0.1` only, through a Docker context. Nothing mounts the Docker socket of your machine. The scripts remove the container, the context and the certificates at the end, even after an error. Never run this on a shared machine.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-14-capstone/part-2-pipeline-and-ship/test.mjs` | Fails on purpose (and says "run the part first" until you have run it). |
| 2 | `node challenges/challenge-14-capstone/part-2-pipeline-and-ship/run.mjs` | Runs the pipeline, deploys to the host, rolls out and rolls back three times under load. About 10 minutes. |
| 3 | Edit `daftar-platform/.github/workflows/ship.yml`, `daftar-platform/pipeline.json` and `daftar-platform/compose.prod.yaml` | Do not edit `data.compose.yaml`. |
| 4 | Run steps 2 and 1 again, until it is green | Part 1 must be done first: the pipeline builds your Dockerfiles. |
| 5 | `node toolkit/show-facts.mjs c14.p2` | Shows the saved numbers. |

`pipeline.json` has two keys: `stages` (a list of `lint`, `build`, `test`, `scan`, `sbom`, `push`, `sign`) and `tags` (`sha`, `version`, `latest`). `compose.prod.yaml` gets these values in the environment: `REGISTRY`, `DIGEST_API`, `DIGEST_WORKER`, `DIGEST_WEB` and `DATABASE_URL`. Find the commit of an action with `gh api repos/docker/login-action/commits/v4.7.0 -q .sha`; the reference workflow holds the five commits used here, so check one yourself before you trust it.

What step 2 does, in order:

1. Reads `.github/workflows/ship.yml` as text.
2. Starts the registry, the production host and a proxy (nginx) on the host.
3. Runs the pipeline for api, worker and web (version 1.0.0), then builds and pushes version 2.0.0. Pushes the database image to the registry too.
4. Starts the database on the host and deploys version 1 with your `compose.prod.yaml`. Checks the three running digests against the three pushed ones, and sends a job through the web page on the host.
5. Three times: deploy version 1, roll out version 2 while 6 clients send requests, roll back to version 1 by digest while load runs.
6. Reads `compose.prod.yaml` as Docker reads it.

## What you should see

On the starter: the images are tagged `latest`, the host runs whatever `latest` points to, requests fail during every rollout because no service has a health check, and the API cannot reach its database because the starter file holds a wrong password. With the fixed files: the host runs exactly the pushed digests, a rollout and a rollback each take about 10 seconds, and no request fails. The full recorded run is in [results.md](results.md). Your numbers will differ.

![Rollout and rollback under load](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c14.p2.workflow_*` | Text checks on `ship.yml` (comments ignored): pinned actions, `write-all`, `pull_request_target`, a guarded `push:`, a hard-coded password, the built-in token, a digest job output, `needs: build`, `type=gha` cache, a `target: test` step, all three images. |
| `c14.p2.pipeline_<service>_ok`, `c14.p2.pipeline_order_ok`, `c14.p2.tags_include_sha` | The local pipeline of each service, the position of the stages in `pipeline.json`, and the tags pushed. |
| `c14.p2.scan_status`, `c14.p2.sbom_status`, `c14.p2.sign_status` | `ok` when challenge 12's hook passed for all three images, `skipped` when the hook file is missing, `partial` when the scan ran without the database, `failed` otherwise. |
| `c14.p2.host_start_s`, `c14.p2.db_start_s`, `c14.p2.first_deploy_s` | Time to start the host, the database, and the first deploy (including the image pulls from the registry). |
| `c14.p2.deploy_ok`, `c14.p2.deploy_digests_match`, `c14.p2.prod_e2e_ok` | The first deploy worked; the `RepoDigests` of the three running images equal the three pushed digests; a job posted on the host reached `done`. |
| `c14.p2.rollout_s`, `c14.p2.rollback_s` | Median of three: from `compose up --wait` of the new colour until the old colour is gone. |
| `c14.p2.rollout_failed_count`, `c14.p2.rollout_total_count`, `c14.p2.rollback_failed_count` | Requests that failed (refused, reset, timed out or not 2xx) and requests sent, over the three rollouts and the three rollbacks. |
| `c14.p2.rollout_both_versions`, `c14.p2.rollback_digests_match` | Answers came from version 1 and version 2 in every trial; after each rollback the running digests are those of version 1. |
| `c14.p2.prod_*` | `docker compose -f compose.prod.yaml config`: images by digest, a secret written in the file, health checks, memory limits, restart policies. |
| `c14.p2.host_mem_used_mb` | `docker stats` of the host container at the end. |

## What is different on Docker Desktop

- The host is a Docker engine inside a container inside Docker Desktop's virtual machine. It behaves the same as on Linux. Startup takes a few seconds longer.
- Pushes go to a registry on a fixed port on `127.0.0.1`: on Docker Desktop the engine runs in a virtual machine and can push to a published port only when it is fixed, so `run.mjs` picks a free one itself.
- Never use `docker system prune` to clean up. `node toolkit/cleanup.mjs 14` removes only what this challenge made. If a run is interrupted, also run `docker context rm -f dkr-c14-prod`.

## Stuck?

- `a service has no digest in the registry`: its pipeline stopped before the push. Read the stage table in the output.
- A rollout fails with `unhealthy`: run the image by hand and call `/ready`. The api needs `DATABASE_URL`.
- `Docker is not ready`: start Docker Desktop and wait until it says running.

## Next

Part 3 breaks the system three ways and asks you to write down what you saw.
