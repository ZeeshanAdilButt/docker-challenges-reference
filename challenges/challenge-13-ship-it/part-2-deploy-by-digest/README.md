# Challenge 13, part 2: deploy by digest to a production host you can break

**Time:** about 60 minutes. **Download:** `docker:29-dind` (about 122 MB packed), `registry:3` (about 21 MB), `nginx:1.27-alpine` (about 21 MB) and `node:24-alpine` (about 63 MB). The host loads nginx from your machine and pulls the app from the local registry, so nothing is downloaded twice. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

You tested version 2.0.0 and approved it. While you were typing the deploy command, a colleague's change finished its pipeline and the tag `latest` moved to version 3.0.0, an image nobody tested together with yours. Your deploy pulled `latest`. Production now runs code you never saw.

Then the deploy itself: the new copy started, the proxy sent it traffic one second later, and the first 40 requests got a 503 because the service was still warming up.

## The idea

Two small habits remove both problems.

1. **Deploy by digest.** A tag (`latest`, `2.0.0`) is a label that someone can move. A digest (`sha256:...`) is the fingerprint of the image content. It cannot move. The pipeline from part 1 prints the digest of what it tested. The deploy asks the host for exactly that.
2. **Move traffic only to a copy that says it is ready.** A health check in the compose file lets `docker compose up --wait` return only when the new copy answers `/ready`. Then the proxy switches, the old copy drains for a moment, and only then is it removed. This is called a blue-green swap: the colours are two copies of the service, one live and one next.

Two more things belong in every production file: the **secret comes from whoever deploys** (an environment variable at deploy time) and never from the repository or the image, and **limits** on memory and processes, so one bad release cannot take the host down.

### The one privileged container

A "production" you can break must not be your own Docker. So the host is a **second Docker engine inside a container** (`docker:29-dind`, Docker in Docker). An engine inside a container needs `--privileged` to start. **This is the single named exception to the rule "no `--privileged`" in this course**, and it is allowed only here, in challenges 13 and 14. To keep it small:

- It is one container, named `dkr-c13-prod` and labelled `dkr.challenge=13`.
- It has a memory limit (3 GB), a process limit (1024) and a disk that is a size-capped `tmpfs` (2 GB). When it is removed, the disk goes with it.
- Nothing mounts the Docker socket of your machine.
- You reach its Docker API over TLS, with a client certificate made for this run, on `127.0.0.1` only, through a Docker context named `dkr-c13-prod`.
- The scripts remove the container, the context and the certificates at the end, even after an error. Never run this on a shared machine.

The pipeline from part 1 pushes to a registry on your machine (`registry:3`). The host pulls from that registry by its container name.

**The GitHub half is your own.** On GitHub the same flow pushes to GHCR and the `deploy` job prints the digest for your own host. This machine cannot do that, so the host and the registry here are local.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-13-ship-it/part-2-deploy-by-digest/test.mjs` | Fails on purpose. Read each message. |
| 2 | `node challenges/challenge-13-ship-it/part-2-deploy-by-digest/run.mjs` | Starts the host, deploys, rolls out under load and checks what runs. About 3 to 4 minutes. |
| 3 | Edit `compose.prod.yaml` | The starter has four faults: a moving tag, a secret in the file, no health check, no limits. |
| 4 | Run steps 2 and 1 again | The test goes green when the host runs the intended digest and no request fails. |
| 5 | `node toolkit/show-facts.mjs c13.p2` | Shows the saved numbers. |
| 6 | `node toolkit/cleanup.mjs 13` and `docker context ls` | Only if a run was interrupted: removes the host, then check that the context `dkr-c13-prod` is gone. |

What step 2 does, in order:

1. Starts the registry and the production host, and a proxy (nginx) in front of the app on the host.
2. Builds and pushes versions 1.0.0, 2.0.0 and 3.0.0 with the pipeline from part 1. The tag `latest` ends on 3.0.0.
3. Deploys version 1 with your compose file.
4. **Control:** rolls out version 2 while load runs, with a compose file that has no health check.
5. **Yours:** rolls out version 2 three times with your compose file, while 6 clients send about 40 requests a second.
6. Asks the host which digest it runs, compares it to the one you intended, and checks the secret, the limits and the health status.

The deploy tool passes three values to your compose file in the environment: `REGISTRY` (the registry as the host sees it), `DIGEST` (the digest to run) and `API_TOKEN` (a made-up test token, never a real secret).

## What you should see

On the starter, the host runs version 3.0.0 although you asked for 2.0.0, a number of requests fail during the rollout, and the secret is a line in the file. With the fixed file, the running digest equals the intended one, the failed count is 0 and the token reaches the container from the deploy environment. The full recorded run is in [results.md](results.md). Your times will differ.

![Failed requests during one rollout](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c13.p2.host_start_s` | Time from `docker run` of the host until its Docker API answers over TLS. |
| `c13.p2.first_deploy_s` | Time of the first `compose up -d --wait`, including the image pull from the registry. |
| `c13.p2.latest_moved` | The registry's digest for `latest` equals version 3 and differs from version 2. |
| `c13.p2.careless_failed_count`, `c13.p2.careless_total_count` | The control rollout (no health check): requests that failed and requests sent. |
| `c13.p2.rollout_s` | Median of three rollouts, from `compose up` of the new copy until the old copy is gone. |
| `c13.p2.rollout_failed_count`, `c13.p2.rollout_total_count` | Failed and sent requests over the three rollouts. A request fails on a refused or reset connection, a timeout or a status that is not 2xx. |
| `c13.p2.rollout_both_versions_served` | Every trial saw answers from version 1 and from version 2. |
| `c13.p2.running_digest`, `c13.p2.intended_digest`, `c13.p2.digest_match` | `docker inspect` of the running container, then the `RepoDigests` of its image on the host. |
| `c13.p2.secret_literal_in_file`, `c13.p2.token_from_deploy_env`, `c13.p2.image_holds_secret` | The `API_TOKEN` line of your file, the environment of the running container, and `docker image history --no-trunc` plus the image config. |
| `c13.p2.mem_limit_mb`, `c13.p2.pids_limit_count`, `c13.p2.health_status` | `docker inspect` of the running container. |
| `c13.p2.host_mem_used_mb` | `docker stats` of the host container at the end. |

## What is different on Docker Desktop

- The host is a container inside Docker Desktop's virtual machine, so it is a Docker engine inside a Docker engine inside a VM. It works the same, and startup takes a few seconds longer than on Linux.
- `docker stats` shows the memory the host container uses inside the VM. That is not your computer's memory.
- The host shows the memory of the VM in `docker info` (`MemTotal`). The 3 GB limit is enforced on the container, not shown there.
- On Docker Desktop the registry port must be fixed for `docker push` to work, so the script picks a free port itself (see challenge 2).
- Never use `docker system prune` to clean up. `node toolkit/cleanup.mjs 13` removes only what this challenge made.

## Stuck?

- `Docker is not ready`: start Docker Desktop and wait until it says running.
- `the production host did not publish its API port` or a timeout waiting for certificates: your Docker is slow or full. Run `node toolkit/cleanup.mjs 13` and try again.
- `docker context ls` still lists `dkr-c13-prod` after a crash: `docker context rm -f dkr-c13-prod`.
- A rollout says `unhealthy`: run the app image by hand and call `/ready`.

## Next

Part 3 rolls back, and shows why a rollback is not always safe.
