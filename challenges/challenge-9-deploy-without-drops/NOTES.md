# Notes for challenge 9 (deploy without drops)

## What each part proves

1. **Naive and graceful restart.** A shell-form `CMD` makes `docker restart` wait for the stop timeout and kill node (a later `docker stop` ends with exit code 137). An exec-form `CMD` restarts in about a second and a half and ends with exit code 0. The number of failed requests is **not** much lower for the graceful image: both fail a few to a few dozen requests while nothing listens. The learner fixes the `Dockerfile`.
2. **Proxy swap.** nginx in front of blue and green. A careless swap (point nginx at green at once, stop blue at once) lost about 120 to 150 requests with a green that needs 4 s to boot. Waiting for green's `/ready` and draining blue lost none, and both versions answered. The learner edits `swap.json`.
3. **Restart storm and stop timeout.** `--restart always` on a container that exits at once restarted 10 times in 60 s with growing pauses (about 0.5 s to 26 s). `on-failure:5` stopped after 5. The default `docker stop` wait was measured, not assumed, with a sweep over `-t`. The learner edits `settings.json`.

## The stop timeout (resolves the dossier's open question)

- On Docker Desktop for Windows, Engine 29.9.2, `docker stop` on `alpine sleep 1000` took 3.6 s to 4 s by default, median of three, over several runs. The docs say 10 s.
- A sweep of `docker stop -t N` (N = 0, 1, 2, 3, 6, 10) gave 0.4, 1.3, 2.5, 3.6, 6.5, 10.8 s: about N plus 0.4 to 0.7 s. The default sits where `-t 3` sits. `--stop-timeout 3` gave 3.4 s.
- `Config.StopTimeout` of a container started without the option is `<nil>`. `docker info` has no timeout field, and `~/.docker/daemon.json` and the Docker Desktop settings store contain nothing about stopping. **The source of the 3 s default was not found.** It is measured on this machine only, and it may be different on Docker Engine on Linux. The README tells the learner to measure their own.
- Stops made while a crash loop ran in the background were slower and noisier (0.5 to 3 s extra). The script therefore measures the stops first.
- `docker restart` of the naive daftar-api image varied from 4.4 s to 12.5 s between runs in part 1. The 12.5 s run is above the measured default and is not explained; it may have waited on connections or on a busy daemon. The medians are used.
- The `--init` run ended with exit code 143: tini passed SIGTERM to `sleep`, which ended by the signal.

## Decisions

- **The load generator paces itself.** The first version sent requests as fast as possible, so a failing period produced thousands of instant failures and the counts measured how long the gap lasted times the speed of failing. Now each of 8 workers starts one request every 100 ms (about 80 requests per second), a new connection each time, half of them slow (150 ms). Counts are then roughly rate times outage.
- **Failures on Docker Desktop are mostly resets, not refusals.** The port forwarder on the host accepts the connection and drops it when the container behind it is gone. The README says to count them together, and says Linux Engine will show more refusals. The first design asserted "graceful means zero resets"; that was wrong here and was removed. Part 1 tests exit code and restart time instead.
- **Green's boot time is simulated** (`sleep 4` before `exec node server.mjs`). With only daftar-api's `WARMUP_MS` (which affects `/ready` only) the careless swap rarely lost a request, because node starts faster than the `docker exec` calls that reload nginx. The 4 s version fails reliably; a 2 s version failed in most but not all trials on a busy machine.
- **The drain is not separated from the health gate.** Only the pair of settings is compared with the careless pair, because with the gate in place nothing failed. The README says so.
- **nginx is changed with `docker exec` and a reload**, not with a bind-mounted file, to avoid file-sharing quirks on Windows. The config template contains the text `__UPSTREAM__` once in a comment and once in use; the script uses `replaceAll`.
- `AbortSignal.timeout` does not keep Node alive, so `get()` in `lib.mjs` uses `setTimeout` and `AbortController`.

## What is different on Docker Desktop

See the box in each README. In short: resets instead of refusals, container start times, the stop timeout and overhead, and `--init` needing no extra image.

## Not done

- No Linux Engine run. The default stop timeout, the refused/reset split and the stop overhead may differ there.
- The proxy swap is on one host with nginx. A Compose or Kubernetes rolling update is not run.
- A graceful `SIGTERM` handler for long-lived connections (draining WebSockets, for example) is not demonstrated; daftar-api serves short requests only.
- `docker stop` through Compose (`stop_grace_period`) is mentioned but not run.
