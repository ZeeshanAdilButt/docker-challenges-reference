# Challenge 9, part 1: restart a service under load, and count what fails

**Time:** about 45 minutes. **Download:** one image you may already have: `node:24-alpine` (about 62 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

You deploy a small fix at 14:00. The release goes fine, the health check is green, and your monitoring shows 40 failed requests in the minute of the deploy. Nobody sees 40 requests, so nobody complains, until the day those 40 are payments. You cannot fix what you have not counted.

This part gives you a load generator that counts failed requests, and uses it on a plain restart.

## The idea

A restart has two phases, and each can fail requests.

1. **Stop.** Docker sends `SIGTERM` to the process that is PID 1 in the container. A well-behaved service stops accepting new connections, finishes the requests it already has, and exits. If PID 1 does not react, Docker waits for its stop timeout and then sends `SIGKILL`, which cuts every request in flight. A request cut in the middle shows up as a **connection reset**.
2. **Start.** The new container needs a moment before it listens. Between the old process stopping and the new one listening, nobody is there. A new connection in this gap is **refused**.

The Dockerfile decides the first phase. With the shell form `CMD node server.mjs; echo done`, Docker starts `/bin/sh -c "..."`, and the shell is PID 1. The shell does not forward `SIGTERM` to node, so node never hears about it. With the exec form `CMD ["node", "server.mjs"]`, node is PID 1 and receives the signal itself. `daftar-api` handles `SIGTERM` properly: it closes its listener, finishes what is in flight and exits.

The second phase cannot be fixed by the Dockerfile. A graceful stop removes the resets. The refused connections between "old is gone" and "new is listening" remain, as long as you have only one copy. Part 2 removes them with a proxy and two copies.

The load generator (`challenges/challenge-9-deploy-without-drops/load.mjs`) sends about 80 requests per second from 8 workers, each on a new connection, half of them slow (150 ms) so that some are always in flight. It counts a request as failed if the connection is refused or reset, if it times out, or if the answer is not a 2xx. You can use it on its own: `node challenges/challenge-9-deploy-without-drops/load.mjs http://127.0.0.1:<port> 10`. Only point it at containers you started.

The starter `Dockerfile` has the shell form. You fix it.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-9-deploy-without-drops/part-1-naive-vs-graceful-restart/test.mjs` | Tests **fail** on purpose. |
| 2 | `node challenges/challenge-9-deploy-without-drops/part-1-naive-vs-graceful-restart/run.mjs` | Builds the naive image (the control) and an image from your `Dockerfile`, restarts each under load, three times each. Takes about three minutes. |
| 3 | Open `Dockerfile`. Change `CMD` to the exec form. | One line. |
| 4 | `node challenges/challenge-9-deploy-without-drops/part-1-naive-vs-graceful-restart/run.mjs --record` | Your restart is fast and cuts nothing. Writes `results.md` and `chart.svg`. |
| 5 | `node toolkit/show-facts.mjs c9.p1` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-9-deploy-without-drops/part-1-naive-vs-graceful-restart/test.mjs` | All tests pass. |

In each trial the script starts one container, sends load for two seconds, runs `docker restart` (timed), waits until the service answers again, sends load for two more seconds, stops the load, and runs `docker stop` once more to read the exit code. The container has 128 MB of memory and 50 processes at most, and is published only on `127.0.0.1` at a random free port.

## What you should see

The naive image makes `docker restart` wait for the stop timeout before it kills node (5 to 9 s on the reference machine), and a later `docker stop` ends with exit code 137. Your fixed image restarts in under two seconds and ends with exit code 0: node got the signal and finished cleanly. The number of failed requests is **not** much lower. Both versions fail a handful to a few dozen requests, because for a moment nothing is listening. The old naive process even serves normally while Docker waits for it, then loses a burst when it is killed. A graceful stop makes the restart fast and clean, and it does not make it invisible. That is why part 2 exists.

On Docker Desktop many of the failures show as **resets**, not refusals. The port forwarder on your computer accepts the connection first and then drops it when the container behind it is gone. On Linux Engine you will see more "refused". Count them together. The full recorded run is in [results.md](results.md). Your counts will differ: they depend on how fast your machine starts a container.

![Failed requests during one docker restart (median of 3)](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c9.p1.naive_total_count`, `c9.p1.yours_total_count` | Requests the load generator sent in one trial, median of three trials. |
| `c9.p1.naive_failed_count`, `c9.p1.yours_failed_count` | Requests that failed (refused, reset, timeout or non-2xx), median of three. |
| `c9.p1.naive_refused_count`, `c9.p1.yours_refused_count` | Of those, connections refused: nobody was listening. |
| `c9.p1.naive_reset_count`, `c9.p1.yours_reset_count` | Of those, connections reset or cut: a request in flight was killed. |
| `c9.p1.naive_outage_ms`, `c9.p1.yours_outage_ms` | Time from the first failed request to the last, median of three. |
| `c9.p1.naive_restart_s`, `c9.p1.yours_restart_s` | How long `docker restart` itself took, median of three. |
| `c9.p1.naive_stop_s`, `c9.p1.yours_stop_s` | After the load, one more `docker stop` of the same container: how long it took (median of three). |
| `c9.p1.naive_stop_exit_code`, `c9.p1.yours_stop_exit_code` | The exit code of that stop: 137 means killed after the timeout, 0 means node handled SIGTERM. |

## What is different on Docker Desktop

- On Docker Desktop for Windows and macOS the load goes through a port forwarder on your computer before it reaches the container. On Linux Engine it goes through the kernel's NAT rules. The refused window can differ by tens of milliseconds, and the resets are the same.
- Starting a container takes longer in the Docker Desktop virtual machine than on a bare Linux host, so the refused window is usually longer here.
- How long `docker restart` waits for a process that ignores `SIGTERM` is the "stop timeout" question that part 3 measures on your machine.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- Your restart still takes several seconds: node is not PID 1. Check the `CMD` line, and `docker top <container>`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 9`.

## Next

Part 2 puts two copies behind a proxy so that the refused window closes.
