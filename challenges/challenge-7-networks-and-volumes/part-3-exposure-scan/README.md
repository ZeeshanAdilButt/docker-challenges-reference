# Challenge 7, part 3: scan what your stack exposes

**Time:** about 45 minutes. **Download:** three images you may already have: `postgres:18-alpine` (about 120 MB to download), `node:24-alpine` (about 62 MB, used to build the api image) and `nginx:1.27-alpine` (about 26 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A database is reachable from the internet. It happens every year to teams that did nothing unusual. They wrote `ports: ["5432:5432"]` in a Compose file, because it made `psql` from the laptop easy. That line opens the port on every network address of the machine. On a cloud server, with `ufw` switched on, the port is still open: Docker adds its own firewall rules before the ones `ufw` manages, so the firewall never sees the traffic.

You will scan your own stack, see what answers, and close what should be closed.

## The idea

There are three different things, and people mix them up.

- **Exposed** (`EXPOSE` in a Dockerfile, `expose:` in Compose) is only documentation. It opens nothing.
- **Published** (`-p`, `ports:`) opens a port on the host. `5432:5432` means "on every address of this machine". `127.0.0.1:5432:5432` means "on this machine only".
- **Reachable on a network** is separate again. Containers on the same Docker network can reach every port of each other, with or without publishing. Publishing is only for traffic coming from outside Docker.

So there are two ways to close a door: do not publish the port, or bind it to `127.0.0.1`. And there is a second wall: put the tiers on separate networks. In a stack with web, api and db, the web tier needs to reach the api and the api needs to reach the db. The web tier never needs to reach the db. If the web tier is broken into, a separate network stops the attacker one step short of your data. A network marked `internal: true` goes one step further: it has no route out to the outside at all.

The starter `compose.yaml` has the classic faults:

1. The database port is published on every address.
2. The api port is published too, although only the web tier talks to it.
3. All three services share one flat network.

You fix the file. The script scans the result with two kinds of checks: from outside (your computer's other network addresses) and from inside (who can open the database port).

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/test.mjs` | Tests **fail** on purpose. The static checks read your `compose.yaml` and tell you what is wrong. |
| 2 | `node challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/run.mjs` | Builds the api image, starts the stack, publishes ports, scans them. All three ports answer on your network address. |
| 3 | Open `compose.yaml`. Remove the `ports` of `db` and `api`. Bind web to `127.0.0.1`. Add two networks, `front` and `back`, and put each service on the right ones. Make `back` `internal: true`. | The reference file is about ten lines longer. |
| 4 | `node challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/run.mjs --record` | The scan finds nothing on your network address, web cannot reach db, api can, and the page still loads. Writes `results.md` and `chart.svg`. |
| 5 | `node challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/scan.mjs <port>` | Scan any port of your own containers by hand (see below). |
| 6 | `node toolkit/show-facts.mjs c7.p3` | Shows the saved facts. |
| 7 | `node --test challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/test.mjs` | All tests pass. |

`scan.mjs` makes one TCP connection per port to `127.0.0.1` and to each of your computer's other addresses (wifi or cable, and virtual adapters). Use it only on ports of containers you started. `run.mjs` only ever scans the ports of its own containers.

The ports in `compose.yaml` come from the environment (`WEB_PORT`, `API_PORT`, `DB_PORT`). `run.mjs` picks free random high ports and passes them to Compose, so nothing collides with your other work.

## What you should see

With the starter file, every published port answers on 127.0.0.1 and on your network addresses, and the web container can open `db:5432`. With the fixed file only web is published, only on 127.0.0.1, the scan finds no other open door, web gets `bad address 'db'`, and the page still loads. The full recorded run is in [results.md](results.md).

![Ports of the stack that answer from each place](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c7.p3.published_ports_count` | Distinct host ports in `docker inspect` (`NetworkSettings.Ports`) of the three containers. |
| `c7.p3.wildcard_bound_count` | How many of them are bound to `0.0.0.0` or `::`, which means every address. |
| `c7.p3.lan_reachable_count` | How many answer a TCP connect on one of your computer's non-loopback addresses. |
| `c7.p3.lan_addresses_count` | How many such addresses the scan used (`os.networkInterfaces()` without loopback and link-local). |
| `c7.p3.db_published`, `c7.p3.db_reachable_from_lan` | Whether the db container publishes anything, and whether it answers on a network address. |
| `c7.p3.web_reaches_db`, `c7.p3.api_reaches_db` | `nc -z -w 2 db 5432` run inside the web and the api container. |
| `c7.p3.end_to_end_ok` | A request to the published web port that must come back from the api through the proxy. |
| `c7.p3.networks_count` | Networks Compose created for the project. |
| `c7.p3.scan_s` | How long the scan took. Closed ports on a network address time out, so a clean scan is slower. |

## What is different on Docker Desktop

- On Linux Engine with `ufw` or `firewalld`, the interesting result is that a published port is open even when the firewall says it is closed. This part cannot show that on Docker Desktop for Windows or macOS, because Docker Desktop opens ports itself on your computer, and the Windows firewall is what stands in front. The scan still shows the real thing: which addresses answer. On a Linux server, run `scan.mjs` from a second computer on the same network, and run `sudo iptables -S DOCKER-USER` to see where your own rules would go.
- A port bound to `127.0.0.1` shows `timeout` on the other addresses on Windows (the packets are dropped). On Linux it is usually `refused`. Both mean closed.
- Docker Desktop for Windows or macOS keeps your containers in a virtual machine. Reaching a container IP from the host does not work there. Published ports and container-to-container traffic behave as described.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- `no configuration file` or `compose.yaml is not valid`: run `docker compose version`. Compose v2 or newer is needed.
- The page does not load after your change: web needs `front`, api needs `front` and `back`, db needs `back`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 7`. The stack is called `dkr-c7-p3`; you can also run `docker compose -p dkr-c7-p3 down -v`.

## Next

Part 4 is about the data itself: what is left when the container is gone, and what to do when the volume goes too.
