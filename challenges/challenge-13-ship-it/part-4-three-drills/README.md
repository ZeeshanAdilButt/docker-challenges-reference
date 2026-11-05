# Challenge 13, part 4: three drills

**Time:** about 45 minutes. **Download:** `docker:29-dind` (about 122 MB packed), `registry:3` (about 21 MB), `nginx:1.27-alpine` (about 21 MB) and `node:24-alpine` (about 63 MB). If you did part 2 you have them all. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Production is not a place where things go right. Three ordinary bad days:

- **The process dies.** An out-of-memory kill, a crash, a person running the wrong command. Does anything start it again, or does it stay dead until a customer rings you?
- **The registry is down.** Your cloud provider has an outage, or your own registry host reboots. You need to redeploy something the host already has. Does the deploy care?
- **A release that passed its tests never becomes ready.** It needs a database setting that production does not have. How quickly do you find out, and how many customers see it?

A drill is a way to find the answers on a Tuesday afternoon, on purpose, on a host you can break.

## The idea

Three lines of a compose file decide the answers.

1. **`restart: unless-stopped`.** Docker starts the container again after it exits, unless a person stopped it. (`no` never restarts. `always` also restarts after a person stops it and the daemon starts again. `on-failure` restarts only after a non-zero exit.) A restart policy bounds an outage; it does not remove it. For no outage at all you need a second copy. A crash loop shows up as a restart count that keeps growing, so watch `RestartCount`.
2. **`pull_policy: missing`.** Compose pulls an image only when the host does not have it. A digest names exactly one image, so if the host has it, there is nothing to ask the registry. With `always`, every deploy asks the registry first, and an outage of the registry stops your deploys even though you already hold the image.
3. **Health check timing.** A health check runs every `interval`. After `retries` failures in a row the container is `unhealthy`. So a copy that never gets ready is found after about `interval x retries`. 30 seconds times 3 is a minute and a half, and `up --wait` gives up before that. 2 seconds times 5 is about ten seconds.

The drills use the same single privileged Docker-in-Docker host as part 2 (`dkr-c13-prod`, started with `--privileged` because a Docker engine inside a container needs it; capped, labelled, TLS on `127.0.0.1`, removed at the end; no Docker socket of your machine). Read the box in [part 2](../part-2-deploy-by-digest/README.md) for the reasons.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-13-ship-it/part-4-three-drills/test.mjs` | Fails on purpose. Read each message. |
| 2 | `node challenges/challenge-13-ship-it/part-4-three-drills/run.mjs` | Runs the three drills on the host. About 4 minutes on the starter (the third drill waits a full minute). |
| 3 | Edit `compose.prod.yaml` | Three things to fix: `restart`, `pull_policy` and the health check timing. |
| 4 | Run steps 2 and 1 again | The test goes green when all three drills are survived. |
| 5 | `node toolkit/show-facts.mjs c13.p4` | Shows the saved numbers. |

What step 2 does, in order:

1. Starts the registry and the host, builds and pushes a good release and a release that never becomes ready.
2. **Drill 1, kill:** deploys the good release, starts load, kills the main process of the only copy with `kill -9` (sent from the host side) and waits up to 30 seconds for `/ready` to answer again.

   Why not `docker kill`? Docker treats `docker kill` and `docker stop` as a person's decision and leaves the container down even with `restart: unless-stopped`. A crash or an out-of-memory kill is not a decision, so the drill kills the process itself. We measured this: after `docker kill` the restart count stays 0.
3. **Drill 2, registry down:** stops the registry container and redeploys the same digest while load runs.
4. **Drill 3, bad release:** tries to deploy the release that never becomes ready while load runs. The old copy must keep serving, and the deploy must say no.

## What you should see

On the starter: the killed copy never comes back, the redeploy fails because it asked the registry, and the bad release takes a minute to be refused. With the fixed file: the copy is back in about 4 seconds (restart plus the 3 second warm-up), the redeploy works with the registry stopped, and the bad release is refused in about 10 seconds with no failed request. The full recorded run is in [results.md](results.md). Your times will differ.

![Seconds to get through each drill](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c13.p4.kill_restart_policy` | `docker inspect` field `HostConfig.RestartPolicy.Name` of the running container. |
| `c13.p4.kill_recovered`, `c13.p4.kill_recovery_s` | After `docker kill`, `GET /ready` through the proxy every 100 ms until it answers 200, capped at 30 s. If it never answers, the number is the cap. |
| `c13.p4.kill_failed_count`, `c13.p4.kill_restart_count` | Requests that failed during the drill (one copy means an outage while it restarts), and `RestartCount` from `docker inspect`. |
| `c13.p4.registry_down_redeploy_ok`, `c13.p4.registry_down_deploy_s`, `c13.p4.registry_down_failed_count` | A `compose up --wait` of the same digest after `docker stop dkr-c13-registry`: did it work, how long, and how many requests failed. |
| `c13.p4.bad_release_rejected`, `c13.p4.bad_release_detect_s` | The deploy of a release whose `/ready` never answers 200: refused or accepted, and the time until `compose up --wait` returned. |
| `c13.p4.bad_release_old_still_serving`, `c13.p4.bad_release_failed_count` | Whether `GET /` still answers with version 1.0.0 afterwards, and the requests that failed during the attempt. |

## What is different on Docker Desktop

- The host is a Docker engine inside a container inside Docker Desktop's virtual machine. Restart policies, health checks and `docker kill` behave the same as on Linux.
- Stopping the registry container does not change the port Docker Desktop published for it, so it comes back at the same address when started again.
- Never use `docker system prune` to clean up. `node toolkit/cleanup.mjs 13` removes only what this challenge made.

## Stuck?

- `Docker is not ready`: start Docker Desktop and wait until it says running.
- The third drill takes a minute on the starter. That is the lesson: the health check timing is the delay.
- `docker context ls` still lists `dkr-c13-prod` after a crash: `docker context rm -f dkr-c13-prod`, then `node toolkit/cleanup.mjs 13`.

## Next

Challenge 14 is the capstone: you do all of this for a system with three services that you did not write.
