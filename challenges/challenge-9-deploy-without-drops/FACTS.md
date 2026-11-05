# Facts of challenge 9

Every number a chapter may quote. Names are `c9.p<part>.<what>_<unit>`. Values come from the reference run on the machine named in each `results.md`. Counts of failed requests and timings are the median of three trials. Load: 8 workers, each starting one request every 100 ms (about 80 requests per second), a new connection per request, half the requests `GET /slow?ms=150` and half `GET /`, 3 s timeout per request. A request fails if the connection is refused or reset, times out, or the status is not 2xx.

## Part 1: naive and graceful restart

| Fact | Meaning | How it was measured |
|---|---|---|
| `c9.p1.naive_total_count` | Requests sent during one `docker restart` of the naive image (shell-form CMD) | `load.mjs`, 2 s before the restart and 2 s after the service answers again |
| `c9.p1.naive_failed_count` | Of those, requests that failed | Same |
| `c9.p1.naive_refused_count` | Failed by connection refused (nobody listening) | Same |
| `c9.p1.naive_reset_count` | Failed by connection reset (request in flight was cut) | Same |
| `c9.p1.naive_outage_ms` | First failed request to last failed request | Same |
| `c9.p1.naive_restart_s` | Seconds `docker restart` itself took | `process.hrtime` around the command |
| `c9.p1.naive_stop_s`, `c9.p1.naive_stop_exit_code` | A `docker stop` of the same container after the load, and its exit code (137 = killed) | `process.hrtime`, `docker inspect` |
| `c9.p1.yours_*` | The same six numbers for the image built from the learner's Dockerfile | Same |

## Part 2: proxy swap

| Fact | Meaning | How it was measured |
|---|---|---|
| `c9.p2.control_total_count`, `c9.p2.control_failed_count` | Requests sent and failed during the careless swap (no health gate, no drain) | `load.mjs` through nginx |
| `c9.p2.control_swap_s` | Seconds from starting green until blue was stopped | `process.hrtime` |
| `c9.p2.yours_total_count`, `c9.p2.yours_failed_count`, `c9.p2.yours_swap_s` | The same for the learner's `swap.json` | Same |
| `c9.p2.yours_version1_count`, `c9.p2.yours_version2_count` | Successful `GET /` answers that reported version 1 and version 2 | `version` field of the JSON answer |
| `c9.p2.yours_health_gate`, `c9.p2.yours_drain_ms` | The two values in the learner's `swap.json` | Read from the file |

## Part 3: restart storm and stop timeout

| Fact | Meaning | How it was measured |
|---|---|---|
| `c9.p3.always_restart_count` | Restarts of a container that exits with code 1 at once, under `--restart always`, in a 60 s window | `docker inspect` `RestartCount` every 250 ms |
| `c9.p3.always_restart_at_s` | Seconds after the start at which each restart was first seen (comma separated) | Same samples |
| `c9.p3.always_window_s` | The length of the window | Constant 60 |
| `c9.p3.yours_policy`, `c9.p3.yours_restart_count`, `c9.p3.yours_final_status` | The learner's restart policy, restarts seen, and the container state at the end | Same samples, run side by side with the control |
| `c9.p3.stop_default_s` | Seconds `docker stop` takes for `alpine sleep 1000` (PID 1 ignores SIGTERM) with no option | Median of three on this machine |
| `c9.p3.stop_default_exit_code` | Exit code of that container after the stop | `docker inspect`. 137 means SIGKILL |
| `c9.p3.config_stop_timeout_field` | `Config.StopTimeout` of a container started without `--stop-timeout` | `docker inspect` |
| `c9.p3.stop_t0_s`, `c9.p3.stop_t1_s`, `c9.p3.stop_t2_s`, `c9.p3.stop_t3_s`, `c9.p3.stop_t6_s`, `c9.p3.stop_t10_s` | The same stop with `docker stop -t N` | Median of three each |
| `c9.p3.stop_timeout_flag_s` | The same with `docker run --stop-timeout 3` | Median of three |
| `c9.p3.stop_init_s` | The same with `docker run --init` | Median of three |
| `c9.p3.stop_yours_s` | The same with the learner's `settings.json` (`init`, `stopTimeoutSeconds`) | Median of three |
| `c9.p3.stop_naive_image_s` | `docker stop` of the naive daftar-api image | Median of three |
| `c9.p3.stop_graceful_image_s`, `c9.p3.stop_graceful_image_exit_code` | `docker stop` of the exec-form daftar-api image and its exit code | Median of three, `docker inspect` |
