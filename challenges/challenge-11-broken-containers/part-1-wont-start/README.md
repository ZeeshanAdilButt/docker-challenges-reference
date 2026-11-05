# Challenge 11, part 1: services that will not start

**Time:** about 60 minutes. **Download:** `node:24-alpine` (about 62 MB packed) and `alpine:3.23` (about 4 MB packed). No other image. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

The pager goes off: "the orders service is down". You open a terminal and the container is gone, or it says `Exited (1)`, or it never started at all. The team starts changing settings at random: more memory, a new tag, a rebuild, a restart. Twenty minutes later nothing has changed, and nobody knows why. The faster engineers do not guess. They ask the same questions in the same order, and the cause shows up in two or three commands.

## The idea

A container that will not start has stopped at one of a few places, and each place leaves a different mark.

| Where it stopped | What you see | Where to look |
|---|---|---|
| Docker could not even start the program | Status `Created`, exit code 126 or 127, an error from `docker compose up` | `docker inspect` (State.Error), then the image's entrypoint and files |
| The program started and stopped by itself | `Exited (1)` or `Exited (2)` | `docker logs` |
| The kernel killed it | `Exited (137)`, `OOMKilled` true | `docker inspect` and the memory limit |

The **diagnosis ladder** is one list, used for every fault, always in the same order:

1. Is it running? `docker ps -a`
2. What did it say? `docker logs`
3. Why did it stop? `docker inspect` (exit code, OOMKilled, State.Error)
4. Can it start, and can it see its files and config? Run the image again with another entrypoint (`docker run --rm --entrypoint ls <image> -l /app`) and read `docker inspect` for environment and mounts.
5. Can it reach the network? (part 2)
6. Is it starved of memory, processes or files? (challenge 10)

Stop at the first rung that proves the cause. Then change **one** thing.

You get four services, each broken on purpose, each small. For each one you diagnose, fix the files in `services/<name>/`, and write a three-line runbook entry: what a person sees, what is wrong, and the one change that fixes it.

## The four tickets

| Folder | Ticket |
|---|---|
| `services/01-wrong-entrypoint` | Deploy of the orders API: the container never comes up. `docker compose up` prints an error. |
| `services/02-missing-env` | The billing API starts and is gone a second later. Nothing answers on port 18102. |
| `services/03-volume-permission` | The shop API keeps its data in a volume. Since we added the volume the container exits right after start. |
| `services/04-exit-137` | The catalogue API loads a cache at start-up and then dies. Someone says "it is killed". By what? |

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-11-broken-containers/part-1-wont-start/test.mjs` | Five tests **fail** on purpose: four services that do not work, and a runbook with TODO lines. |
| 2 | `node challenges/challenge-11-broken-containers/part-1-wont-start/run.mjs` | Starts each service from your files, one at a time, prints what a person would see, and takes it down again. |
| 3 | Pick a service. Open its folder. Start it yourself: `docker compose up -d --build` in that folder. | The symptom from the ticket. |
| 4 | Work down the ladder with your own commands. Write down which rung proved the cause. | The ladder is above. Do not read `reference/` yet. |
| 5 | Fix one file, then `docker compose down -v` and `docker compose up -d --build` again. | `-v` removes the volume too. An old volume keeps its old owner. |
| 6 | `node --test --test-name-pattern="01-" challenges/challenge-11-broken-containers/part-1-wont-start/test.mjs` | Tests one service at a time (change the number). |
| 7 | Write the three lines for each service in `runbook.md`. | Symptom, Cause, Fix. At least 15 characters each, no TODO. |
| 8 | `node challenges/challenge-11-broken-containers/part-1-wont-start/run.mjs --answer-key` | Stuck? This runs the ladder on your current files and prints the output. It spoils the answer. |
| 9 | `node toolkit/show-facts.mjs c11.p1` | Shows the saved numbers. |
| 10 | `node --test challenges/challenge-11-broken-containers/part-1-wont-start/test.mjs` | All tests pass. |

Rules for the fixes: keep the memory, process and log limits at the top of each `compose.yaml` (the test checks them), keep the `dkr.challenge` label, and keep the memory under 64 MB. All services bind to `127.0.0.1` only.

## What you should see

Each service has a different mark. The recorded run on the reference machine:

| Service | State | Exit code | Proof of the cause |
|---|---|---|---|
| 01 wrong entrypoint | `Created` | 127 | `exec: "/app/start": stat /app/start: no such file or directory` |
| 02 missing env | `Exited` | 1 | `FATAL: DATABASE_URL is not set`, and the container has `DB_URL` |
| 03 volume permission | `Exited` | 1 | `EACCES: permission denied, mkdir '/var/lib/shop/db'`, volume owned by user 0, app is user 1000 |
| 04 exit 137 | `Exited` | 137 | `OOMKilled` true, limit 32 MB, cache 48 MB |

The full recorded run, including every ladder command and the fixed result, is in [results.md](results.md).

![Ladder rung that proves the cause](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c11.p1.<service>_broken_state` | `docker inspect` State.Status of the starter version, a moment after `docker compose up -d`. |
| `c11.p1.<service>_broken_exit_code` | `docker inspect` State.ExitCode of the starter version. |
| `c11.p1.<service>_broken_oomkilled` | `docker inspect` State.OOMKilled of the starter version. |
| `c11.p1.<service>_broken_health` | `docker inspect` State.Health.Status (`none` when there is no health check). |
| `c11.p1.<service>_cause_rung` | The ladder rung whose output proves the cause (counting from 1). |
| `c11.p1.<service>_fixed_working` | The reference version is running and every HTTP check answers. |
| `c11.p1.broken_count`, `fixed_count` | Services broken in the starter and working in the reference. In your own runs (no `--record`) you get `c11.p1.<service>_working` and `c11.p1.working_count` for your files. |

## What is different on Docker Desktop

- Exit codes and `OOMKilled` are the same. The memory limit is enforced inside Docker Desktop's Linux virtual machine.
- A bind mount from your computer into a container shows files owned by `root` or your user in different ways on Windows and macOS. Service 03 uses a **named volume** on purpose, so it behaves the same everywhere.
- `docker compose` is built in. On a Linux server you may have `docker-compose` (an older separate program). Use `docker compose`.
- Published ports are bound to `127.0.0.1`. On Docker Desktop they are reachable from your computer. From another computer they are not, which is what you want.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- "port is already allocated" on 18101 to 18104: another program uses that port. Stop it, or run `docker ps` to see if one of your own earlier containers is still up (`node toolkit/cleanup.mjs 11`).
- A fix does not seem to apply: Docker may be using the old image or the old volume. Run `docker compose down -v` and `docker compose up -d --build`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 11`. It removes only objects labelled `dkr.challenge=11`.

## Next

Part 2 gives you three services that start fine and still do not work.
