# Challenge 14: the capstone

Containerize it, ship it, break it, defend it. You do the whole job once, on a system you did not write.

**Time:** about 10 hours in four parts. **Download:** about 700 MB for the images, plus `docker:29-dind` (about 122 MB) and `registry:3` (about 21 MB) for the production host. **Safety rules:** [SAFETY.md](../../SAFETY.md)

## Choose your system

| | System | Status here |
|---|---|---|
| a | The **Daftar platform**: a Node API, a worker in another language (Python), PostgreSQL and a static web front end. | Built. It is in [daftar-platform](daftar-platform), with poor Dockerfiles and a README that is out of date. |
| b | A campaign site for an NGO: a Python web app, a task worker, Postgres and nginx. | Not built in this repository. The rubric and the scripts assume the service names `api`, `worker`, `web` and `db`; a mentor can adapt them. |
| c | Bring your own: a system with at least three services and one stateful one. | Needs mentor approval first. |

All the parts below are written for (a).

## What you submit

- Dockerfiles that meet the rubric: multi-stage, non-root, pinned by digest, a clean `docker build --check`, a graceful shutdown that passes, the size targets. (part 1)
- A Compose stack for development with health checks, profiles and watch that is healthy in under 60 seconds. (part 1)
- A GitHub Actions pipeline that builds with a cache, scans, makes an SBOM, signs and pushes to GHCR. The GitHub run is your own; this repository checks the file as text and runs the same stages locally. Scan, SBOM and signing are pending until challenge 12. (part 2)
- A deploy by digest to the local production host with a rollout under load that drops no requests, and a rollback drill under two minutes. (part 2)
- Three failure experiments with charts, and a runbook. (part 3)
- A five-minute walkthrough with answers to three probes and one troubleshooting question. (part 4)

## The parts

| Part | What you do | Files you edit (in `daftar-platform`) | Time |
|---|---|---|---|
| [1 containerize](part-1-containerize/README.md) | Dockerfiles and a dev Compose stack for three services | `api/Dockerfile`, `worker/Dockerfile`, `web/Dockerfile`, three `.dockerignore` files, `compose.yaml`, `README.md` | 3 h |
| [2 pipeline and ship](part-2-pipeline-and-ship/README.md) | The pipeline, the deploy by digest, the rollout and the rollback | `.github/workflows/ship.yml`, `pipeline.json`, `compose.prod.yaml` | 3 h |
| [3 break it](part-3-break-it/README.md) | Kill, starve and misconfigure it; write the runbook | `RUNBOOK.md` (and whatever the experiments tell you to fix) | 2 h |
| [4 defend it](part-4-defend-it/README.md) | The walkthrough and the answers; the whole rubric is scored | `DEFENCE.md`, `PROBES.md` | 1.5 h |

Each part has the same shape as every other challenge: run the test (it fails), run the script (it measures), edit, run both again.

## The rubric

[rubric.mjs](rubric.mjs) lists every criterion: six areas (images, build and cache, run and recover, security, evidence, communication), the points, the part that measures it and a hint. It is code on purpose: part 4's test prints your score, and a mentor reads the same list. The pass mark is 80 % of the points that can be earned today. A mentor reviews the result in under 45 minutes and asks one to three follow-up probes.

## The production host

Part 2 uses one container that runs a second Docker engine (`docker:29-dind`, named `dkr-c14-prod`). A Docker engine inside a container needs `--privileged`. **This is the single named exception to the rule "no `--privileged`" in this course**, shared with challenge 13. It is one container, labelled, capped (memory, processes, a size-capped `tmpfs` as its disk), reached over TLS on `127.0.0.1` through a Docker context, and removed at the end of the run. Nothing mounts the Docker socket of your machine. Never run it on a shared machine.

## Out of scope

A public production URL, any cloud account, Kubernetes, and authentication beyond a stub.
