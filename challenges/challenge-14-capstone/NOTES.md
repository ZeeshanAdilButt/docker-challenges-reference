# Notes: challenge 14 (the capstone)

For the course builders. Not for learners.

## What each part proves

| Part | It proves |
|---|---|
| 1 containerize | The starter system (`daftar-platform`: Node api with one dependency, Python worker with the standard library only, nginx page, PostgreSQL) runs, and fails every target of the rubric: 1635 MB api as root, `CMD npm start` so `docker stop` ends with 137, `COPY . .` before the install, `ENV` with a password, a `.env` copied into three images, no health checks, a published database port, a README about MySQL and Node 16. The fixed files (245 MB, 177 MB, 74 MB; non-root; exit 0 in under a second; no leak; healthy in about 20 s; a job done in about 2 s) meet them. |
| 2 pipeline and ship | The pipeline of challenge 13 for three services and a shared database: digests travel together, a rollout of a whole colour under load loses no request, a rollback by digest takes about as long as a rollout. |
| 3 break it | Kill (`/crash`), starve (`/alloc` against a memory limit) and misconfigure (wrong database password against a health gate) each behave as the runbook says, with numbers; the runbook is parsed and its **Measured:** numbers are compared with the run. |
| 4 defend it | The walkthrough has the shape and the learner's own numbers; four answers have the right length and touch the right ideas; the whole rubric prints a score. No Docker needed. |

## The rubric checker

The brief asked for a rubric checker "in the reference". It is at `challenges/challenge-14-capstone/rubric.mjs`, outside any `reference/` folder, on purpose: `tools/make_starter.mjs` drops every `reference/` folder, and a checker that learners cannot run cannot score their work. It holds no answers; the fixed Dockerfiles, compose files, workflow, runbook, defence and probes are in the `reference/daftar-platform/` folder of each part, as the brief says. `rubric-tests.mjs` turns each criterion into a `node:test` test, and part 4's test adds one test for the total (pass mark 80 % of the points that can be earned today).

Criteria that need challenge 12's tools (scan, SBOM, signing: 9 points) are `pending` while the pipeline reports `skipped`; they are listed, earn nothing and do not count against the score. Once the three hook files exist (see challenge 13 NOTES.md), the statuses become `ok` or `failed` and they count.

## Problems hit and what was done

1. `docker build --check` prints "Check complete, 1 warning has been found!" for warnings and "no warnings found" when clean, and `WARNING: Rule - url` lines. The first parser expected another wording and reported 99. Fixed.
2. `docker kill` does not trigger a restart policy (measured in challenge 13). The kill experiment calls `GET /crash` on the api: it answers, then exits with code 137 after 50 ms. The worker side of a kill (a claimed job whose report is lost) is covered by the queue: a claimed job older than `STALE_CLAIM_S` (8 s) goes back to `queued`. All three jobs of the experiment finish.
3. `docker events --format '{{.ID}}'` printed an empty id for the OOM event, so the first run counted 0 OOM events although the api had restarted. The format is now `{{.Action}}`.
4. The stack is labelled and re-ported by a second compose file written by `lib.mjs` with the tags `!override` and `!reset`. These need Compose 2.24 or newer (this machine has 5.6.1). Without the second file a learner's `ports: ["5432:5432"]` would bind the database port on the host, and the containers could not be found by label.
5. A stack without health checks may not be ready when `up --wait` returns. The end-to-end job check waits up to 30 s for `/api/ready` before it posts, so that the starter fails for the right reasons (no health check), not because of a race.
6. `read_only: true` and `docker compose watch` with `action: sync` do not work together (sync copies into the container). The reference uses `action: rebuild`.
7. PostgreSQL 18 images keep the data under `/var/lib/postgresql`, not `/var/lib/postgresql/data`; the volume is mounted there.
8. `--no-cache` cold builds take 3 to 4 seconds because the `npm` cache mount (`--mount=type=cache`) survives. The README says what `--no-cache` ignores.
9. Digest pins: `python:3.12-slim` and `postgres:18-alpine` on this machine are older than what the registry serves today for those tags (the tags moved). The reference pins the digests of the local images (index digests), so the build does not pull anything. They are real, older digests. The README tells the learner to look the current one up with `docker buildx imagetools inspect`. `node:24-alpine` and `nginx:1.27-alpine` were current.
10. The api test for `SIGTERM` is skipped on Windows (a host Node cannot send `SIGTERM`); it runs inside the image build on Linux.
11. The api image build needs the network (`npm ci` fetches `pg` from the npm registry). The dependency is pinned in a lock file (`pg` 8.16.3).

## Deviations from the roadmap and the brief

- Scenario (a) of the roadmap lists Valkey. The brief for this build lists a Node api, a worker, Postgres and a static web page, so Valkey is left out. The queue lives in Postgres (`FOR UPDATE SKIP LOCKED`).
- Scenario (b) (NGO campaign site) and (c) (bring your own) are described in the README but not built.
- The roadmap asks for a "security report with a before and after scan and triage decisions". That needs challenge 12's scanner; it is `pending` in the rubric and not built. The defence asks the learner to say what is scanned and what is still to come.
- The roadmap asks that the compose stack comes up "healthy in under 60 seconds": checked (`compose_up_s`).
- "A rollback drill under two minutes": the target is `rollback_s < 120`, measured at about 11 s.
- The pipeline's cache evidence is local: the cached rebuild after an edit (part 1) and the `type=gha` lines in the workflow (checked as text). The Actions cache itself cannot be measured here.
- The experiments of part 3 run on the development stack on this machine's Docker, not on the production host. Only part 2 uses the Docker-in-Docker host (`dkr-c14-prod`, privileged, the single named exception; same design as challenge 13: TLS context, memory 6 GB, a 4500 MB `tmpfs` disk, pids 1024).
- The planted secrets in the starter (`.env` files, `ENV`, compose) are made-up strings that contain the word `supersecret`. They are in the repository on purpose. They are not credentials of anything.

## What the Docker Desktop learner sees differently

- Everything runs in the Docker Desktop virtual machine; ports are published on 127.0.0.1 only and are random.
- The image sizes are `docker image inspect` `Size`: 245, 177 and 74 MB for the fixed images on this machine's containerd store.
- The registry port must be fixed for `docker push` (see challenge 13 NOTES.md).

## Not done

- No GitHub run. No scan, SBOM or signature. Option (b) of the scenarios. A Linux or Codespaces run of the whole capstone.

## Disk and downloads

- No new pull except `docker:29-dind` (shared with challenge 13: 122.4 MB packed, 455 MB on disk). The starter builds on `node:24` (410 MB packed, 1.65 GB on disk), which was already on the machine.
- Every image and stack of these parts is named `dkr-c14-...` and removed at the end of a run (`dkr-c14-stack-api` and the like included). The BuildKit cache is shared and never pruned.
- Time of a reference run on this machine: part 1 about 1 minute 30 s (3 minutes on the starter, because of the stop timeouts), part 2 about 4 minutes, part 3 about 4 minutes, part 4 under 2 seconds.
- Memory of the production host at the end of part 2: see `c14.p2.host_mem_used_mb` (the limit is 6 GB, the `tmpfs` disk 4500 MB).
