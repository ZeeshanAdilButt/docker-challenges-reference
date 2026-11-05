# Notes for challenge 7 (networks and volumes)

## What each part proves

1. **Default bridge against user-defined bridge.** The default bridge has no name resolution (the container asks the host's DNS forwarder, and the failed lookup takes about 4 s here). A user-defined bridge has Docker's DNS at 127.0.0.11 and resolves names in about 0.2 s. A container on another network is not refused but silently dropped (the client waits for its whole timeout). The learner fixes `topology.json`.
2. **The localhost trap.** The same Postgres, asked from seven places, answers differently. Inside the api `localhost` is refused, `db` works, the host reaches the published port, and the published port number does not exist inside the api. The learner fixes `api.env`.
3. **Exposure scan.** A Compose file with `ports: ["${DB_PORT}:5432"]` publishes on every address, and the scan shows the port answering on the computer's wifi address. The fixed file publishes only web on 127.0.0.1 and puts the tiers on two networks, with `back` internal. The learner fixes `compose.yaml`; the test lints it with `docker compose config --format json` and also checks the scan facts.
4. **Volume loss and backup.** No volume entry means an anonymous volume: the data does not survive the container being recreated. A named volume survives that, but not `down -v`. Both a `pg_dump` and a `tar` copy of the stopped volume bring the rows back. The learner fixes `compose.yaml`.

## Decisions

- Each part is checked two ways: static (the learner's file) and live (facts written by `run.mjs`). The facts alone would let a stale run pass, so the static check is what makes the starter fail even after a reference run.
- `--reference` (or `DKR_USE_REFERENCE=1` for the test) points a part at its `reference/` folder. The recorded `results.md` and `chart.svg` come from the reference run.
- Part 3's api image is built from `daftar-api/` as `dkr-c7-daftar-api:1` and removed at the end of the run. Nothing in `daftar-api/` was changed.
- Ports are chosen with a free-port helper (high random ports) and published on 127.0.0.1 unless the part is showing the fault. The scan only connects to the ports of the script's own containers. The faulty starter does bind three ports on all addresses for about ten seconds on the learner's machine; that is the point of the part, and the README says so.
- The Postgres password in the Compose files is a throwaway demo value (`dkr-demo-only`) for a database that exists for seconds and is not published in the reference.
- The 4 s failed lookup, the `host.docker.internal` result and the `timeout` (not `refused`) on a non-loopback address for a port bound to 127.0.0.1 are measurements from Docker Desktop on Windows 11. They differ on Linux Engine; the Desktop boxes say so, and the Linux expectations are not verified here.

## Problems met

- `docker inspect` in Engine 29 no longer has `.NetworkSettings.IPAddress` at the top level. Use `.NetworkSettings.Networks.<name>.IPAddress`.
- Busybox in alpine 3.23 has no `httpd`. The "database" in part 1 is `nc -lk -p 8000 -e /bin/echo hello-from-db`.
- Git Bash rewrites `/path` arguments. The scripts are Node and pass arguments directly, so they are not affected. If you test by hand in Git Bash, set `MSYS_NO_PATHCONV=1`.
- Anonymous volumes are not labelled and `cleanup(7)` cannot find them. Part 4 records the volume names from its own containers and removes exactly those by full name. Containers removed by `cleanup()` use `rm -v`, so their anonymous volumes go too.
- A user-defined network cannot be removed while a container is attached; `cleanup()` removes containers first, so that is already handled.

## What is different on Docker Desktop

See the box in each README. In short: the DNS forwarder address, container IPs that you cannot reach from the host, `host.docker.internal` present by default, no `iptables` or `ufw` to demonstrate bypass, and volumes inside the virtual machine.

## Not done

- The `ufw` bypass itself cannot be shown on Docker Desktop for Windows. Part 3 shows the cause (a port bound to every address) and the scan result, and the README tells a Linux learner how to repeat the scan from a second computer and where `DOCKER-USER` rules go.
- The optional toolbox image (`nicolaka/netshoot`, 219 MB) is not used. Everything runs with `alpine:3.23` and busybox tools.
- No Linux Engine run, so the "what is different" statements about Linux are expectations from the documentation, not measurements.
- A hot (running) `tar` copy of the database is not demonstrated.
