# Runbook: Daftar platform

This is the page a person opens at 3 am. One entry for each failure that was caused on purpose in part 3 of the capstone.
Commands are for the development stack; for the production host add `--context dkr-c14-prod`.

## How to write an entry

Copy this template under "Entries" and fill every line. Each field needs at least a few words.
The **Check** line needs the commands in backticks. The **Measured** line needs the number from your own experiment, in seconds.

```
### Name of the failure
- **Symptom:** what a person sees (a page that does not load, jobs that stay queued)
- **Check:** the commands, in order, for example `docker compose ps` and `docker compose logs api`
- **Cause:** what is really wrong
- **Fix:** what to do now
- **Prevention:** the setting or the code that stops it next time
- **Measured:** 4.1 s
```

## Entries

### Kill: the api process dies
- **Symptom:** The page says "The API does not answer." New jobs are not accepted and queued jobs do not finish. `GET /api/ready` fails for a few seconds.
- **Check:** `docker compose ps` (is the api restarting or exited?), `docker inspect --format '{{.State.ExitCode}} {{.RestartCount}}' <api container>` (137 means killed), `docker compose logs --tail 30 api`.
- **Cause:** The api process exited. Exit 137 is a kill: an out-of-memory kill, a `kill -9`, or the `/crash` route used for this experiment.
- **Fix:** Nothing, if the restart policy is working: Docker starts the api again and the health check turns green. If it stays down (`restart: unless-stopped` missing, or someone ran `docker stop`), run `docker compose up -d api`. Jobs that a worker had claimed go back in the queue after eight seconds and are done again.
- **Prevention:** `restart: unless-stopped` on every service, a health check on `/ready`, and a queue that puts back a claimed job when its worker cannot report (`STALE_CLAIM_S`). A second api copy would remove the short outage.
- **Measured:** 1.5 s

### Starve: the api eats its memory
- **Symptom:** The api restarts by itself every time it grows past a certain size, and requests fail while it does. Without a limit the whole machine gets slow instead.
- **Check:** `docker events --filter event=oom --since 10m`, `docker inspect --format '{{.HostConfig.Memory}} {{.RestartCount}}' <api container>`, `docker stats --no-stream`.
- **Cause:** Something holds more memory than the limit (here `GET /alloc?mb=200`, in real life a leak or an unbounded cache). The kernel kills the process at the limit: exit 137 with an OOM event.
- **Fix:** Find what grows (`docker stats`, the logs before the kill). Raise `mem_limit` only if the work really needs it. The worker, the database and the web page are not affected and need no action.
- **Prevention:** `mem_limit` on every service (api 256 MB, worker 128 MB, web 64 MB, db 256 MB here), so a leak costs one restart of one container and not the host. Watch the restart count.
- **Measured:** 3.6 s

### Misconfigure: the api has the wrong database password
- **Symptom:** The deploy fails, or (without a health check) succeeds and every request through the web page answers 502 or 503. `GET /api/ready` answers 503.
- **Check:** `docker compose ps` (api unhealthy), `docker compose logs --tail 20 api`, `curl -s http://127.0.0.1:<api port>/ready`, and compare the password in `DATABASE_URL` with `POSTGRES_PASSWORD` in `.env`.
- **Cause:** `/ready` asks the database a question and the database refused the login, so the api reports not ready. The process is alive (`/health` is 200); the dependency is not reachable.
- **Fix:** Correct `POSTGRES_PASSWORD` in `.env` (or the secret in the deploy environment) and run `docker compose up -d --wait`. If the database password itself was changed, fix it on the database side, not in the api.
- **Prevention:** A `/ready` that touches the database, a health check that calls it, and `docker compose up --wait` in the deploy so a wrong value stops the rollout while the old copy keeps serving.
- **Measured:** 22 s
