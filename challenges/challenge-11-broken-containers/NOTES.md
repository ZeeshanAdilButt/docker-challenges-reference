# Notes for challenge 11: broken containers

## What each part proves

1. **Will not start** (services 01 to 04). A container can fail before the program runs (wrong entrypoint, state `Created`, exit 127), by its own exit (missing env var, volume owned by root: exit 1), or by a kill (memory limit too low for a start-up cache: exit 137, OOMKilled). The same ladder finds all four.
2. **Runs but unreachable** (05 to 07). Nothing crashes. A port clash leaves one container in `Created`, a wrong health check marks a healthy service `unhealthy`, and a typo in a service name gives a vague 502 after a timeout. The ladder rungs about Docker's own view and about the network do the work.
3. **Needs another way in** (08 to 10). A read-only root, an image with no shell, and a file only root can read. The way in is `docker run --entrypoint`, `--user 0`, `--read-only`, reading with the one tool the image has, and a toolbox container.

Each service is its own compose project in `services/NN-name/`, with the safety cage (memory, process, log caps, label) at the top. The `reference/` folder of each part holds the fixed services, `runbook.md` (three lines per service) and `ladder.md` (the diagnosis ladder answer key). `ladder.mjs` holds the same ladder as commands, so `run.mjs --answer-key` and `--record` print real output.

Tests (starter, then reference):

| Part | Starter | Reference |
|---|---|---|
| 1 | 5 fail, 2 pass | 7 pass |
| 2 | 4 fail, 2 pass | 6 pass |
| 3 | 4 fail, 2 pass | 6 pass |

The two tests that pass on every starter are the structure checks (nothing left in Docker, the README links the safety rules).

## Differences from the roadmap and the dossier

- **Download:** about 66 MB (`node:24-alpine` and `alpine:3.23`, both already on the machine), not the roadmap's 431 MB. The roadmap counted `nicolaka/netshoot` (219 MB) as the toolbox. This challenge uses `alpine:3.23`, which has `netstat`, `ps`, `nslookup` and `wget` from busybox, so no large pull is needed. The README mentions netshoot as an optional larger toolbox.
- **Exit codes measured on this machine:** wrong entrypoint gives state `Created` with exit 127; port clash gives `Created` with exit 128; a script whose interpreter is missing gives `Exited (255)`; Node's recursive `mkdir` on a read-only root reports `ENOENT`, not `EROFS`. The chapter 12.3 table should say "usual cause", not "always".
- **A DNS typo hangs, it does not fail fast, on Docker Desktop.** The gateway's call to an unknown name timed out after the 3 second client timeout, so the log says "aborted due to timeout", not `ENOTFOUND`. `nslookup` from inside shows `NXDOMAIN` at once. The part teaches both.
- **Ports used:** 18101 to 18110 and 18115, all bound to `127.0.0.1`.

## Problems met

- Compose project and volume names: the named volume of service 03 is `dkr-c11-volume-permission_shop-data`. A volume that already exists keeps its old owner, so every run and every test does `docker compose down -v` first. The README tells the learner the same.
- `mem_limit` and `memswap_limit` must change together (service 04): raising only one gives a Docker error. The compose file has a comment about it.
- Windows: the Dockerfiles use `COPY` of text files with LF endings (the repo forces LF in `.gitattributes`). A CRLF script would give the same "no such file" message as service 09, by a second route.
- Images are named `dkr-c11/<slug>:1` and removed by exact name after each service. `cleanup(11)` removes containers, networks and volumes only.

## Docker Desktop learner

See the box in each part README. In short: the same exit codes, the same messages; ports are on `127.0.0.1`; use a named volume, not a bind mount, for service 03.

## Re-run after a Docker outage

Docker Desktop stopped once during the first build of this challenge (an engine crash, not a fault in the challenge). After it came back, all three parts were re-recorded with `--record`, and the starter and reference tests were run again for every part. The numbers in the table above and the files `results.md` and `chart.svg` come from that second run. The stricter check for service 06 (the health check must call `/health`) ran in that pass.
