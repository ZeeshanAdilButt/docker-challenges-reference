# Challenge 9, part 2: swap two copies behind a proxy

**Time:** about 45 minutes. **Download:** two images you may already have: `node:24-alpine` (about 62 MB) and `nginx:1.27-alpine` (about 26 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Part 1 ended with a graceful restart that still refused requests for a moment: with one copy of the service, there is always a gap between the old one stopping and the new one listening. To close it you need two copies for a short time, and something in front that decides which one gets traffic.

## The idea

A **reverse proxy** (here nginx) sits in front of your service. Clients talk to the proxy, and the proxy talks to the service. Because clients never talk to the service directly, you can change what is behind the proxy without them noticing. This is a **blue/green swap on one host**:

1. Blue (version 1) is running and gets all the traffic.
2. Start green (version 2) next to it. It is not in use yet.
3. **Health gate:** wait until green says it is ready (`/ready` answers 200). Pointing the proxy at a container that is not listening yet would send clients to a dead end.
4. Change the proxy's upstream from blue to green and **reload** nginx. A reload is graceful: nginx starts new workers with the new config, and the old workers finish their requests before they exit.
5. **Drain:** give blue a moment to finish whatever it was still doing, then stop it. Its own graceful shutdown (part 1) does the rest.

The two settings you control are `healthGate` and `drainMs` in `swap.json`. The starter has both off, the careless swap: start green, point nginx at it at once, stop blue at once. The script runs this careless swap first as a control, and then yours. Green here is an app that needs 4 seconds to boot: the container is up, but nothing listens for the first 4 seconds (a stand-in for an app that loads data or compiles something before it serves). So the health gate has something to wait for.

`/ready` is the key part. `/health` says "the process is alive". `/ready` says "I can take traffic now". A proxy must be gated on readiness. This is the difference between a liveness check and a readiness check that interviewers ask about.

This is one host and two containers, not a cluster. It is the same idea as a rolling update in Kubernetes: new pods must be ready before old ones are removed.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-9-deploy-without-drops/part-2-proxy-swap/test.mjs` | Tests **fail** on purpose. |
| 2 | `node challenges/challenge-9-deploy-without-drops/part-2-proxy-swap/run.mjs` | Swaps three times with the careless settings, then three times with yours. With the starter `swap.json` both are careless. Takes about three minutes. |
| 3 | Open `swap.json`. Set `healthGate` to `true`, and `drainMs` to `1500`. | Two values. |
| 4 | `node challenges/challenge-9-deploy-without-drops/part-2-proxy-swap/run.mjs --record` | Zero failed requests with your settings. Writes `results.md` and `chart.svg`. |
| 5 | `node toolkit/show-facts.mjs c9.p2` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-9-deploy-without-drops/part-2-proxy-swap/test.mjs` | All tests pass. |

In each trial: a network, blue and an nginx proxy are started. The proxy is published on `127.0.0.1` and a random free port. The load generator sends requests through the proxy. After two seconds the swap starts. After it, two more seconds of load, then everything is removed. The load asks for `/` (which answers with the version) and `/slow?ms=150` alternately, so you can see both versions answer and some requests are always in flight.

## What you should see

With the careless swap, nginx is pointed at green while green is still booting. For the next second or so every request that nginx sends to green fails with a 502, and about 80 requests per second are arriving, so on the reference machine one swap lost about 120 to 150 requests. With the health gate and the drain, none fail, and the counts of answers from version 1 and version 2 are both well above zero: the swap really happened under load. Compare with part 1: the same service restarted in place lost requests while nothing was listening; swapped behind a proxy, it lost none. The full recorded run is in [results.md](results.md).

![Failed requests during one swap (median of 3)](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c9.p2.control_total_count`, `c9.p2.control_failed_count`, `c9.p2.control_swap_s` | The careless swap (`healthGate` false, `drainMs` 0): requests sent, requests failed, and seconds from starting green until blue was stopped. Median of three. |
| `c9.p2.yours_total_count`, `c9.p2.yours_failed_count`, `c9.p2.yours_swap_s` | The same for the settings in your `swap.json`. |
| `c9.p2.yours_version1_count`, `c9.p2.yours_version2_count` | Successful `/` answers that said version 1 and version 2 (median of three). Both must be above zero. |
| `c9.p2.yours_health_gate`, `c9.p2.yours_drain_ms` | The two values read from your `swap.json`. |

The careless swap is a race with the boot time of green, so its count depends on your machine. Yours has to be zero because the order of steps prevents the failures, not luck. This part does not separate the effect of the drain from the effect of the health gate: with the gate in place nothing failed, so the drain is cheap insurance for requests that were already on their way to blue, not something these runs prove necessary.

## What is different on Docker Desktop

- Both versions run in the same Docker network and nginx reaches them by container name, which works the same everywhere.
- nginx's reload is the same on Linux. The published port on Docker Desktop passes through the port forwarder of Docker Desktop, which is not touched by the swap.
- Green's four seconds of boot time are simulated (a `sleep 4` before node starts), so the careless swap fails the same way on every setup. Real container start times in the Docker Desktop virtual machine are a little longer than on bare Linux, which only makes the careless swap worse.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- Your swap still fails requests: look at the order. The proxy must not point at green until green's `/ready` answers 200.
- `nginx: [emerg] host not found in upstream`: the container name in the config does not exist yet on the network.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 9`.

## Next

Part 3 looks at the other two ways a deploy goes wrong: a container that crashes in a loop, and a stop that takes much longer than you think.
