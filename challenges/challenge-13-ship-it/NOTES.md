# Notes: challenge 13 (ship it)

For the course builders. Not for learners.

## What each part proves

| Part | It proves |
|---|---|
| 1 build, check, push | The order of the gates matters. A pipeline that pushes before it tests puts a broken image in the registry and moves `latest` onto it. The workflow file is read as text: every action pinned to a verified full commit, narrow permissions, no push from a pull request, the built-in token, a digest passed to the deploy job. |
| 2 deploy by digest | While a deploy is being prepared, another build can move `latest`; a compose file that names the image by digest runs what was tested, and one that names a tag does not. Without a health check `compose up --wait` returns before the service is ready and a rollout drops requests (the control); with one, three rollouts under load lose none. |
| 3 roll back | A rollback by tag lands on the wrong image when the tag was re-pushed. A rollback does not undo a schema: the same story with a one-step column rename leaves the old code unable to read the database, and with an expand step it works. A drift check finds a container started by hand. |
| 4 three drills | `docker kill` does not trigger a restart policy, but a crash does. `pull_policy: always` turns a registry outage into a deploy outage. Health check interval times retries is the time a bad release takes to be refused. |

## The one privileged container

`kit.mjs` (shared with challenge 14) starts `docker:29-dind` as `dkr-c13-prod`:

- `--privileged` (the single named exception), `--memory 3g`, `--memory-swap 3g`, `--pids-limit 1024`, log limits, `/var/lib/docker` on a `tmpfs` of 2000 MB (counted inside the 3 GB), on a labelled network `dkr-c13-net` with the registry.
- TLS: `DOCKER_TLS_CERTDIR=/certs`. The script waits for `/certs/client/key.pem`, copies the client certificates to a folder in the system temp directory (`docker cp`) and creates the context `dkr-c13-prod` with `host=tcp://127.0.0.1:<port>,ca=...,cert=...,key=...`. The API port is published on 127.0.0.1 only. Teardown removes the context, the temp folder and (through `cleanup(13)`) the container with its tmpfs.
- Nothing mounts a Docker socket. Part 2's recorded run prints `privileged: true   socket mounted: false` from `docker inspect` of the host.
- Measured: the engine inside is 29.9.3 (the machine's is 29.9.2), containerd snapshotter and `overlayfs` work on a `tmpfs`; the host container uses 400 MB with one app and nginx (`c13.p2.host_mem_used_mb`; the capstone host with four services uses about 1.1 GB). Start time was between 6 and 52 seconds depending on how busy the shared Docker was.
- `docker:29-dind`: 122.4 MB packed (the sum of the 16 amd64 layers in the registry manifest, measured), 455 MB on disk in the containerd store of this machine. Under the 300 MB limit that asked for a report.

## Problems hit and what was done

1. **Push to a random published port fails on Docker Desktop** (known from challenge 2). The registry gets a free port chosen by the script and fixed with `-p 127.0.0.1:<port>:5000`. The host reaches the registry by container name (`dkr-c13-registry:5000`) on the shared network, with `--insecure-registry` on the inner daemon.
2. **`docker kill` does not restart a container with `restart: unless-stopped`.** Measured on this engine: after `docker kill` the restart count stays 0 and the container stays down. So the drill kills the process from the host side of the inner engine (`kill -9 <pid>` through `docker exec dkr-c13-prod`). A kill from inside the container is ignored by PID 1. The README says why.
3. **nginx reloads in the background.** The first request after the first deploy got a 503 from the old configuration, and a customer was missed in the ledger story. `edge.deploy` now waits until the proxy serves the new copy.
4. **A compose volume that is in use cannot be removed.** The ledger story takes both colours down before it removes the data volume.
5. **Git Bash rewrites `/certs` to `C:/Program Files/Git/certs`** when a command with a container path is typed by hand. Node's `spawn` does not, so the scripts are not affected. Learners on Git Bash who type the commands from the README by hand may be; the README commands avoid container paths.
6. The `docker save | docker load` of `nginx:1.27-alpine` into the host works with the containerd image store (the index has only the amd64 content locally).
7. The first version of the kill drill reported the exit code after the restart (0). That line was removed: `State.ExitCode` is the code of the current run.
8. The cache test compared two timings of a 3 second build and failed on noise. It now counts the steps that say `CACHED` in the plain build log.

## Deviations from the roadmap and the dossier

- The roadmap says "pipeline pushes to GHCR". Here the pipeline pushes to a local `registry:3`, and the workflow that pushes to GHCR is shipped, checked as text and marked as the learner's own run.
- The roadmap gives no part names for challenge 13. Used: build-check-push, deploy-by-digest, roll-back, three-drills.
- The dossier left open: "Alternative: a second Compose project on the same Docker. Decision pending." The decision log says Docker-in-Docker. Implemented as such.
- The host's disk is a size-capped `tmpfs` (2000 MB) that counts against the 3 GB memory limit. A real disk quota cannot be set for a volume in Docker. The data disappears with the container, which is the intent.
- The proxy and the app are plain HTTP. The TLS in this challenge protects the Docker API of the host, not the traffic. The roadmap's 14.4 mentions "a proxy, TLS": the proxy is here, TLS for the app is not.
- Timings that are the median of three: build cold and warm (part 1), rollout (part 2), rollback (part 3). Single measurements: host start, first deploy, the three drills (each is a one-off event by nature).

## Scan, SBOM and signing (challenge 12)

Challenge 12 part 4 was still the template when this was built. `runPipeline` in `kit.mjs` calls an optional hook for each of these stages: `challenges/challenge-12-scan-harden-sign/hooks/scan.mjs`, `sbom.mjs` and `sign.mjs`, run as `node hooks/<stage>.mjs <image reference>`. Exit code 0 is a pass. `scan` and `sbom` get the image on this machine's Docker (`127.0.0.1:<port>/dkr-c13/api:build-<sha7>`); `sign` gets the pushed digest (`127.0.0.1:<port>/dkr-c13/api@sha256:...`). When a hook file does not exist, the stage is marked `skipped` with the detail `filled in after challenge 12`. To wire them in, add the three files; nothing else changes. Not written by this builder.

## What the Docker Desktop learner sees differently

- Everything is a Docker engine in a container in the Docker Desktop virtual machine. `MemTotal` of the inner `docker info` is the VM's memory, not the 3 GB limit.
- The first start of the host is slower.
- The registry port must be fixed (see problem 1).

## Not done

- No GitHub run, no GHCR login, no real signing or scanning.
- The workflow's `deploy` job only prints the digest; the real deploy in this course is `run.mjs`.
- No test of the learner-run flow on Linux or in a Codespace.

## Disk and downloads

- New pull: `docker:29-dind` only (122.4 MB packed, 455 MB on disk). `registry:3`, `nginx:1.27-alpine` and `node:24-alpine` were already on the machine.
- Every image these parts build is named `dkr-c13-...` and is removed at the end of a run. The BuildKit cache is shared and is never pruned, so its growth cannot be told apart from other builders' (the whole machine's cache grew by about 3.6 GB while all of challenges 13 and 14 were built and run many times).
- C: had 22 GB free when this work started and 19 GB at the end (shared with other builders). The host `tmpfs` and the registry storage disappear with their containers.
- Time of a reference run on this machine, from the sweep log: part 1 about 25 to 65 s, part 2 about 2 minutes, part 3 about 3 minutes, part 4 about 1 minute 15 s.
