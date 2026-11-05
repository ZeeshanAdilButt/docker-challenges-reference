# Challenge 14, part 3: break it and write the runbook

**Time:** about 2 hours. **Download:** nothing new if you did parts 1 and 2. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

At 3 am something breaks. The person who looks at it is tired, did not write the system and has your runbook open next to a terminal. If the runbook says "check the logs", it has failed. If it says what the symptom looks like, which two commands to run, what normal looks like and what to do, the person is back in bed in ten minutes.

You can only write that page about failures you have caused yourself. This part makes you cause three, measure them and write them down.

## The idea

An experiment has four parts: a **steady state** (the system works and you know how it looks), a **fault** (you break one thing on purpose), a **measurement** (how long, how many requests or jobs, what Docker says) and a **lesson** (what to change, and what to write down).

The three faults:

| Experiment | The fault | What a good system does |
|---|---|---|
| kill | `GET /crash` on the api: it answers, then exits with code 137 (what an out-of-memory kill or a `kill -9` looks like from the outside), while six jobs are queued and in flight. | A restart policy starts it again. The job a worker had claimed goes back in the queue after a few seconds and is done again. No job is lost. |
| starve | `GET /alloc?mb=200`, up to three times: the api holds more and more memory. | The memory limit stops the api at its limit (exit 137, an OOM event). Docker starts it again. The worker, the database and the web page never restart. The damage is one container, not the host. |
| misconfigure | The api is started with the right host and the wrong database password. | `/ready` touches the database, the health check calls `/ready`, and `docker compose up --wait` says no within seconds. Without that chain, the deploy says "success" and customers find the fault. |

Why `GET /crash` and not `docker kill`? Docker treats `docker kill` and `docker stop` as a person's decision, and a container with `restart: unless-stopped` stays down. We measured it in challenge 13: after `docker kill` the restart count stays 0. A crash or an OOM kill is not a decision, so the experiment makes the process exit by itself.

The experiments run on the development stack (your `compose.yaml`), each on a fresh stack. It is a small copy of the system on your own Docker: nothing here needs the production host.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-14-capstone/part-3-break-it/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-14-capstone/part-3-break-it/run.mjs` | Runs the three experiments (about 4 minutes), then reads your runbook. |
| 3 | Fix whatever the experiments show: usually `restart`, `mem_limit` and the health checks in `compose.yaml`. | Part 1 may already have done it. |
| 4 | Write `daftar-platform/RUNBOOK.md`: one entry for each experiment, using the template at the top of the file. | Each entry: Symptom, Check (commands in backticks), Cause, Fix, Prevention, and **Measured:** the number in seconds from step 2. |
| 5 | Run steps 2 and 1 again, until it is green | |
| 6 | `node toolkit/show-facts.mjs c14.p3` | Shows the saved numbers. |

What step 2 does, in order:

1. **kill:** brings up a fresh stack, queues 6 jobs, calls `/crash`, and polls `/api/ready` through the web page every 100 ms. Then waits until every job is done.
2. **starve:** a fresh stack. Calls `/alloc?mb=200` up to three times, counts the `oom` events Docker recorded for the api, waits for the api to come back, then queues 3 jobs.
3. **misconfigure:** a fresh stack, then recreates the api with a wrong password in `DATABASE_URL` using `docker compose up -d --wait --wait-timeout 40 api`.
4. Reads `RUNBOOK.md` and compares each **Measured:** number with the one it just measured (it accepts half again or 2 seconds, whichever is more).

## What you should see

On the starter compose file: after `/crash` the api never comes back (no restart policy) and the jobs wait for ever; the three `/alloc` calls all succeed because there is no limit, and nothing stops the hog; `up --wait` reports success for an api that cannot reach its database. With the fixed file: the api is back in a few seconds, the OOM kill is recorded and only the api restarts, and the misconfigured api is refused in about 20 seconds (the health check needs ten failures, two seconds apart). The full recorded run is in [results.md](results.md). Your numbers will differ.

![Seconds until the system noticed or recovered](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c14.p3.kill_recovered`, `c14.p3.kill_recovery_s` | After `/crash`, the time until `GET /api/ready` through the web page answers 200 (capped at 40 s). |
| `c14.p3.kill_restart_count` | `RestartCount` of the api container from `docker inspect`. |
| `c14.p3.kill_jobs_total_count`, `c14.p3.kill_jobs_lost_count`, `c14.p3.kill_all_done_s` | Jobs queued before the crash, how many never reached `done` within 40 s, and the time until the last one did. |
| `c14.p3.starve_limit_mb` | `mem_limit` of the api in your compose file, from `docker compose config`. |
| `c14.p3.starve_oom_killed` | `docker events --filter event=oom` for the api container, during the experiment. |
| `c14.p3.starve_recovered`, `c14.p3.starve_recovery_s` | The api answers `/api/ready` again, and how long it took after the last `/alloc`. |
| `c14.p3.starve_worker_unaffected` | The worker and the database have `RestartCount` 0 and are running, and the 3 jobs queued afterwards finish. |
| `c14.p3.misconfig_detected`, `c14.p3.misconfig_detect_s` | `docker compose up --wait` with the wrong password returned an error, and after how long (40 s is the cap). |
| `c14.p3.misconfig_really_broken`, `c14.p3.misconfig_silent` | `/api/ready` through the web page did not answer 200; "silent" means the deploy said success anyway. |
| `c14.p3.runbook_entries_count`, `c14.p3.runbook_complete_count`, `c14.p3.runbook_numbers_match` | Entries found under "Entries", entries with every field filled, and whether each **Measured:** number is close to this run's number. |

## What is different on Docker Desktop

- Memory limits are enforced inside Docker Desktop's virtual machine. The OOM kill of a container is the same as on Linux. The `docker events` output lists container events of that engine only.
- A limit on a container does not limit the virtual machine. Without a limit, the api in this experiment can take 600 MB of the VM's memory, which is safe, but a real leak could take all of it.
- Never use `docker system prune` to clean up. `node toolkit/cleanup.mjs 14` removes only what this challenge made.

## Stuck?

- `the stack did not come up`: complete part 1 first, or read the error line. `docker compose logs` is the next command.
- The runbook step says "no entry found": the heading must contain a word like kill or crash, starve or memory, misconfigure or password. Put the entries after the line `## Entries`.
- "does not match": run the experiments again and copy the number from the output, with its unit `s`.

## Next

Part 4 is the defence: five minutes, six numbers of your own, and four questions.
