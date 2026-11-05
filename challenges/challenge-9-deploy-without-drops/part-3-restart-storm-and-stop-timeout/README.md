# Challenge 9, part 3: a restart storm, and how long `docker stop` really waits

**Time:** about 40 minutes. **Download:** two images you may already have: `alpine:3.23` (about 4 MB) and `node:24-alpine` (about 62 MB, used to build the two daftar-api images). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Two things go wrong around a deploy, and both hide.

1. A new version crashes at start. The restart policy is `always`, so Docker restarts it, again and again, with longer pauses. The service is down, but the container list shows "restarting", the dashboard shows "running" half the time, and nothing ever says "failed". If the crashing service holds a database connection open for a moment each time, you are also hammering the database.
2. A deploy takes much longer than it should, and nobody knows why. Each stop waits for a timeout, because the process in the container did not react to the stop signal. The docs say the wait is 10 seconds. How long is it on your machine?

## The idea

**Restart policies.** `no` never restarts. `on-failure[:N]` restarts when the process exits with an error code, at most N times. `always` and `unless-stopped` restart whatever happens, without a limit. Docker waits a little before each restart, and the wait grows: it roughly doubles each time (measured below). That keeps a crash loop from using all your CPU, and it also means that a service that crashes at start is "up" only for an instant, in a pattern that looks like activity. `always` hides a crash loop. `on-failure` with a small limit ends it: the container stays `exited`, which a health check, an alert or `docker ps` can see. A manual stop (including `docker kill`, as challenge 8 showed) is never restarted.

**The stop.** `docker stop` sends `SIGTERM` (or the stop signal set in the image) to PID 1 of the container, waits for the **stop timeout**, then sends `SIGKILL`. A process that handles `SIGTERM` exits at once, so the wait does not happen. A process that ignores it, or never receives it (a shell in front of it, part 1), makes every stop and every deploy wait for the whole timeout. An exit code of 137 means "killed" (128 + 9); 143 means "ended by SIGTERM" (128 + 15); 0 is a clean exit.

What changes how long `docker stop` waits:

- `docker stop -t N` sets the timeout for this one stop.
- `docker run --stop-timeout N` (or `STOPSIGNAL` in a Dockerfile for the signal, `stop_grace_period` in Compose for the time) stores it in the container.
- `docker run --init` puts a tiny init program (tini) at PID 1. It passes signals on to your process and cleans up child processes. A process that ignores SIGTERM only because it was PID 1 now stops at once.
- The process itself: handle `SIGTERM` (daftar-api does) and the question disappears.

This part does not assume the default. It measures it. A container whose PID 1 is `sleep 1000` ignores `SIGTERM` (PID 1 has no signal handler, and the kernel does not apply the default action to it), so `docker stop` has to wait out the full timeout. The script times that for the default, for `-t` from 0 to 10, and for each of the settings above.

`settings.json` holds the four values you edit: the restart policy and its limit, the stop timeout, and `init`. The starter has `always` with no limit and the default stop, the same as many real Compose files.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-9-deploy-without-drops/part-3-restart-storm-and-stop-timeout/test.mjs` | Tests **fail** on purpose. |
| 2 | `node challenges/challenge-9-deploy-without-drops/part-3-restart-storm-and-stop-timeout/run.mjs` | Measures the stop times first (about two minutes), then runs two crash loops side by side for 60 s: `--restart always` (the control) and your policy. |
| 3 | Open `settings.json`. Use `on-failure` with `maxRetries` 5, and set `init` to `true`. | Four values. |
| 4 | `node challenges/challenge-9-deploy-without-drops/part-3-restart-storm-and-stop-timeout/run.mjs --record` | Your policy gives up after 5 restarts, and your stop is quick. Writes `results.md`, `chart.svg` and `chart-storm.svg`. |
| 5 | `node toolkit/show-facts.mjs c9.p3` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-9-deploy-without-drops/part-3-restart-storm-and-stop-timeout/test.mjs` | All tests pass. |

Every container has 32 to 64 MB of memory and 20 processes at most. The crash loop is `alpine sh -c "exit 1"`: nothing else happens in it, so it cannot harm anything. The script reads the restart count of each loop every 250 ms with `docker inspect` and notes the moment it goes up.

## What you should see

- **The stop timeout.** On the reference machine (Docker Desktop, Engine 29.9.2) `docker stop` on a process that ignores `SIGTERM` took between 3.6 s and 4 s by default over several runs, not 10 s. The sweep shows that a stop takes about the `-t` value plus a fixed overhead of 0.4 to 0.7 s (`-t 0` took 0.4 s, `-t 3` 3.6 s, `-t 10` 10.8 s), and that the default behaves like `-t 3`. A container started with `--stop-timeout 3` took the same 3.4 s as the default. `Config.StopTimeout` of the container is empty, and no setting for it was found in `docker info` or in the Docker Desktop settings files. The documentation's 10 s did not hold here. **Measure it on your machine and do not quote a default.** `--init` and a process that handles `SIGTERM` stop in under a second.
- **The storm.** A container that exits at once under `--restart always` was restarted 10 times in 60 s, and the pauses grew from about 1 s to about 26 s. With `on-failure:5` it was restarted 5 times and then stayed `exited`. The recorded restart times and gaps are in [results.md](results.md).

![Seconds docker stop waits for a process that ignores SIGTERM](chart.svg)

![When "--restart always" restarted a crashing container](chart-storm.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c9.p3.stop_default_s`, `c9.p3.stop_default_exit_code` | `docker stop` of `alpine sleep 1000`, median of three, and the container's exit code (137 means killed). |
| `c9.p3.config_stop_timeout_field` | `Config.StopTimeout` from `docker inspect` of a container started without `--stop-timeout`. Empty means "use the default". |
| `c9.p3.stop_t0_s`, `c9.p3.stop_t1_s`, `c9.p3.stop_t2_s`, `c9.p3.stop_t3_s`, `c9.p3.stop_t6_s`, `c9.p3.stop_t10_s` | The same stop with `docker stop -t N`, median of three. |
| `c9.p3.stop_timeout_flag_s` | The same with `docker run --stop-timeout 3`, median of three. |
| `c9.p3.stop_init_s` | The same with `docker run --init`, median of three. |
| `c9.p3.stop_yours_s` | The same with the `init` and `stopTimeoutSeconds` of your `settings.json`. |
| `c9.p3.stop_naive_image_s` | `docker stop` of the naive daftar-api image (shell-form CMD). |
| `c9.p3.stop_graceful_image_s`, `c9.p3.stop_graceful_image_exit_code` | `docker stop` of the exec-form daftar-api image, and its exit code (0). |
| `c9.p3.always_restart_count`, `c9.p3.always_restart_at_s`, `c9.p3.always_window_s` | Restarts of the crash loop under `--restart always` in 60 s, the seconds since the start at which each was first seen, and the window. |
| `c9.p3.yours_policy`, `c9.p3.yours_restart_count`, `c9.p3.yours_final_status` | Your restart policy, how many restarts it allowed, and the container state at the end (`exited` or `restarting`). |

The times are the time of the `docker stop` command, including its fixed overhead. The restart times are sampled every 250 ms, so they are accurate to about a quarter of a second.

## What is different on Docker Desktop

- The stop timeout is the main thing. This part exists because the docs (10 s), an earlier run on this laptop (about 4 s) and a note in a related course (about 3 s) did not agree. On your machine it may be different again, on Docker Desktop, on Docker Engine in WSL2 or on a Linux server. Run the script and read your own `stop_default_s`.
- The fixed overhead of a stop (0.4 to 0.7 s here) includes the Docker Desktop virtual machine. On a Linux server it is smaller.
- The restart pauses are Docker's own backoff and do not depend on Docker Desktop. The first pause includes the time to start a container again, which is longer in the virtual machine than on a bare Linux host.
- `--init` uses the `docker-init` program that ships with Docker. It needs no extra image.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- The storm never ends with your policy: `on-failure` needs a limit (`maxRetries` above 0). Without it, it is as endless as `always`.
- Stops take longer than expected while the storm runs: that is why the script measures the stops first. A crash loop keeps the Docker daemon busy.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 9`.

## Next

Challenge 10 caps memory, processes and files, and watches logs grow in a box that cannot hurt your machine.
