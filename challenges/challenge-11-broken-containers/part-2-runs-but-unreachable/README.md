# Challenge 11, part 2: services that run but cannot be used

**Time:** about 45 minutes. **Download:** `node:24-alpine` (about 62 MB packed) and `alpine:3.23` (about 4 MB packed), both already here from part 1. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

"It is running, but it does not work." This is harder than a crash, because nothing is red. `docker ps` says `Up`. The logs look calm. A user still gets an error page, or the deploy tool refuses to continue, or only half the stack came up. With no crash and no exit code, the old habit of reading the last log line is not enough.

## The idea

When a container runs, the questions change. Rung 1 is no longer "did it start" but "what does Docker say about it, and about its neighbours". Three kinds of fault hide here.

- **A neighbour did not start.** Two containers want the same host port. Docker starts the first and refuses the second. The compose command prints an error once, and the stack looks mostly fine. Only one container can own a host port.
- **The check is wrong, not the service.** A health check is a command Docker runs inside the container on a timer. If the check itself is wrong, a healthy service is marked `unhealthy`. Plain Docker only marks it. Something else (a deploy tool, Compose `--wait`, an orchestrator) then acts on that mark.
- **The name is wrong.** On a Compose network, containers find each other by service name through Docker's built-in DNS. One wrong letter and the name does not exist. A name that does not exist may fail fast with "not found", or it may hang until a timeout, and then your program shows a vague "timeout" error.

The ladder is the same, and rungs 3 to 5 now do the work:

1. Is it running, and what does Docker say about it and its neighbours? `docker ps -a`
2. What does it log?
3. Why did it stop, or what does Docker think is wrong? `docker inspect` (State.Error, State.Health)
4. Does it have what it needs? Files, config, mounts.
5. Can it reach the network? Test from the inside: `docker exec <name> nslookup <other>` and `wget`.
6. Is it starved? (challenge 10)

## The three tickets

| Folder | Ticket |
|---|---|
| `services/05-port-clash` | The web site is fine but the admin site never starts. The compose file looks right. |
| `services/06-bad-healthcheck` | The reports API answers requests, but Docker says it is unhealthy and the deploy tool refuses to continue. |
| `services/07-dns-typo` | Both containers are running. The gateway answers `/health` but `/orders` returns a 502 error. |

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-11-broken-containers/part-2-runs-but-unreachable/test.mjs` | Four tests **fail** on purpose: three services that do not work, and a runbook with TODO lines. |
| 2 | `node challenges/challenge-11-broken-containers/part-2-runs-but-unreachable/run.mjs` | Starts each service from your files and prints what a person would see. |
| 3 | In a service folder: `docker compose up -d --build` | The symptom from the ticket. |
| 4 | Work down the ladder with your own commands. Use `docker exec` for the network rungs. | Do not read `reference/` yet. |
| 5 | Fix one file. Then `docker compose down -v` and `docker compose up -d --build`. | |
| 6 | `node --test --test-name-pattern="05-" challenges/challenge-11-broken-containers/part-2-runs-but-unreachable/test.mjs` | Tests one service at a time (change the number). |
| 7 | Write the three lines for each service in `runbook.md`. | Symptom, Cause, Fix. |
| 8 | `node challenges/challenge-11-broken-containers/part-2-runs-but-unreachable/run.mjs --answer-key` | Stuck? Prints the ladder output for your current files. It spoils the answer. |
| 9 | `node toolkit/show-facts.mjs c11.p2` | Shows the saved numbers. |
| 10 | `node --test challenges/challenge-11-broken-containers/part-2-runs-but-unreachable/test.mjs` | All tests pass. |

Rules for the fixes: keep the cage at the top of each `compose.yaml` (memory under 64 MB, process and log limits, the label). For service 06, **keep** the health check and fix it. Do not delete it. For service 05 the web site must stay on port 18105, and the admin site must get another port.

## What you should see

| Service | Mark | Proof of the cause |
|---|---|---|
| 05 port clash | web `Up`, admin `Created` | `Bind for 127.0.0.1:18105 failed: port is already allocated` in State.Error of the admin container |
| 06 bad health check | `Up (unhealthy)` | Health log: `wget: can't connect to remote host (127.0.0.1): Connection refused`. The same `wget` on port 8080 works. |
| 07 DNS typo | both `Up`, `/orders` gives 502 after about 3 seconds | `nslookup backnd` says NXDOMAIN inside the gateway. `nslookup backend` works. |

The recorded run, with every ladder command and the fixed result, is in [results.md](results.md).

![Ladder rung that proves the cause](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c11.p2.<service>_broken_state`, `_broken_exit_code`, `_broken_oomkilled`, `_broken_health` | `docker inspect` of the main container of the starter version, a moment after `docker compose up -d`. For 05 it is the admin container. For 07 it is the gateway. |
| `c11.p2.<service>_cause_rung` | The ladder rung whose output proves the cause (counting from 1). |
| `c11.p2.<service>_fixed_working` | The reference version is running, healthy where there is a check, and every HTTP check answers. |
| `c11.p2.broken_count`, `fixed_count` | Services broken in the starter and working in the reference. |

## What is different on Docker Desktop

- The DNS name lookup inside containers (`127.0.0.11`) is the same on Docker Desktop and on Linux. A name that does not exist took about three seconds to give up in the reference run, because the lookup is forwarded outward. Other setups may fail faster.
- Published ports are bound to `127.0.0.1`. A port clash with a program that is not Docker (a database on your own computer, for example) gives the same error. Windows can also reserve port ranges for itself, which gives a similar message.
- A health check runs inside the container, so `wget` and `nslookup` must exist in the image. The `node:24-alpine` image has the busybox versions of both.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- Service 05: do not edit the web side. Only one of the two ports has to change.
- Service 06: a health check that always passes (`true`) is not a fix. The test keeps the check but needs the service to be `healthy` for real.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 11`.

## Next

Part 3 gives you three services where the usual way in is closed.
