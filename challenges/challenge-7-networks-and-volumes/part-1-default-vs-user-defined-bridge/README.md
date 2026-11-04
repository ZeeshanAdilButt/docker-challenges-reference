# Challenge 7, part 1: the default bridge against a user-defined bridge

**Time:** about 45 minutes. **Download:** one image, `alpine:3.23`, about 4 MB to download (13 MB on disk). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Your API container cannot find its database container. You wrote `db` in the connection string, the database is running, and the API says `bad address 'db'`. You can see both containers in `docker ps`. This is the most common first network problem, and the cause is one missing flag.

## The idea

When you run a container without a `--network` flag, it joins Docker's **default bridge**. A bridge is a virtual switch inside your machine. Every container on it gets an IP address such as `172.17.0.3`, and the containers can reach each other by that number.

The default bridge has no name service for containers. If you ask for `db`, the container asks the DNS server of your computer, and that server has never heard of `db`. The answer is "no such host", and it arrives slowly, because the container waits for the outside server first.

A **user-defined bridge** is a bridge you create with `docker network create`. It comes with a small DNS server of its own, at the address `127.0.0.11` inside every container on that network. That server knows the name of every container on the network. So `db` works, and it keeps working when the database container is recreated with a new IP address.

A user-defined network is also a wall. A container on network A cannot reach a container on network B. The packets are dropped, not refused, so the caller waits for its whole timeout and then gives up.

This part has two halves. First the script runs three fixed experiments, so you see the difference with your own eyes. Then it builds the topology in your `topology.json` and checks whether `api` can reach `db` by the name `db`. The starter topology has the fault: both containers sit on the default bridge. You fix it.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-7-networks-and-volumes/part-1-default-vs-user-defined-bridge/test.mjs` | Some tests **fail** on purpose. Read the messages. |
| 2 | `node challenges/challenge-7-networks-and-volumes/part-1-default-vs-user-defined-bridge/run.mjs` | Runs the three experiments, then your `topology.json`. The last step says `Your topology does not work`. |
| 3 | Open `topology.json`. Create a network in `networks`, and put `api` and `db` on it. | The fix is two lines. |
| 4 | `node challenges/challenge-7-networks-and-volumes/part-1-default-vs-user-defined-bridge/run.mjs --record` | The last step now prints `hello-from-db`. It also writes `results.md` and `chart.svg`. |
| 5 | `node toolkit/show-facts.mjs c7.p1` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-7-networks-and-volumes/part-1-default-vs-user-defined-bridge/test.mjs` | All tests pass. |

What step 2 does, in order:

1. Starts two containers on the default bridge. It reads `/etc/resolv.conf`, asks for the other container by name (fails), then by IP address (works).
2. Creates the network `dkr-c7-p1-demo` and starts two containers on it. It reads `/etc/resolv.conf` again (`127.0.0.11`), then asks for the name (works).
3. Creates a second network and tries to reach the first network's container by IP from there (dropped).
4. Removes all of that, then builds your `topology.json` and runs `nc -w 2 db 8000` inside the `api` container.

Every lookup and every reach test is run three times and the median is kept. The timings include the small cost of `docker exec` itself (about 0.15 s).

## What you should see

On the default bridge the name does not resolve, and the failure takes about four seconds. On the user-defined bridge the same lookup answers in about 0.2 s. The container on another network gets no answer for about two seconds, which is the `-w 2` timeout of `nc`. The full recorded run is in [results.md](results.md). Your times will differ.

![Seconds until the client gets its answer](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c7.p1.default_bridge_nameserver` | The first `nameserver` line of `/etc/resolv.conf` in a container on the default bridge. It is your computer's DNS forwarder, so it differs on your machine. |
| `c7.p1.default_bridge_name_lookup_ok` | `getent hosts <container name>` on the default bridge. `false` means the name did not resolve. |
| `c7.p1.default_bridge_failed_lookup_s` | Time of that failed lookup, median of three. |
| `c7.p1.default_bridge_ip_reach_ok` | `nc` to the other container's IP address on the default bridge. |
| `c7.p1.user_bridge_nameserver` | The `nameserver` line on a user-defined network. Always `127.0.0.11`. |
| `c7.p1.user_bridge_name_lookup_ok`, `c7.p1.user_bridge_lookup_ms` | `getent hosts` on the user-defined bridge, and its median time. |
| `c7.p1.user_bridge_name_reach_ok` | `nc` by container name on the user-defined bridge. |
| `c7.p1.cross_network_ip_reach_ok`, `c7.p1.cross_network_probe_s` | `nc -w 2` by IP from a second network, and how long it waited. |
| `c7.p1.topology_name_ok` | `nc -w 2 db 8000` from `api` in the topology you wrote. |
| `c7.p1.topology_user_networks_count` | How many user-defined networks your topology created. |

## What is different on Docker Desktop

- On Docker Desktop the "outside DNS server" on the default bridge is a forwarder inside the Docker virtual machine (`192.168.65.7` on the reference machine). On Linux Engine it is usually the DNS server from the host's `/etc/resolv.conf`. The failed lookup is slow on both, but the exact seconds differ.
- The IP addresses (`172.17.x.x` and `172.23.x.x`) belong to the virtual machine. You cannot reach them from Windows or macOS, only from inside a container. On Linux you can `ping` them from the host.
- The rule about names does not change: a user-defined network has DNS at `127.0.0.11`, the default bridge does not.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- The last step still says the name is not known: check that both containers list the same network in `topology.json`, and that the network is in `networks`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 7`.

## Next

Part 2 puts a database and an API on one network and shows what `localhost` means in each place.
