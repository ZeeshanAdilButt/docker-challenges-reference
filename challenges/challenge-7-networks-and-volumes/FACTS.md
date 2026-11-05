# Facts of challenge 7

Every number a chapter may quote. Names are `c7.p<part>.<what>_<unit>`. Values come from the reference run on the machine named in each `results.md`. Timings that matter are the median of three runs. Booleans and result words (`open`, `ECONNREFUSED`) are single observations.

## Part 1: default bridge against user-defined bridge

| Fact | Meaning | How it was measured |
|---|---|---|
| `c7.p1.default_bridge_nameserver` | The DNS server a container on the default bridge uses | First `nameserver` line of `/etc/resolv.conf` in a container on `bridge` |
| `c7.p1.default_bridge_name_lookup_ok` | Does a container name resolve on the default bridge | `getent hosts <other container>`, exit code 0 or not |
| `c7.p1.default_bridge_failed_lookup_s` | Seconds the failed lookup takes | Median of 3 `docker exec` calls, includes about 0.15 s of `docker exec` overhead |
| `c7.p1.default_bridge_ip_reach_ok` | Can one container reach the other by IP on the default bridge | `nc -w 2 <ip> 8000` answers `hello-from-db` |
| `c7.p1.user_bridge_nameserver` | DNS server on a user-defined network | First `nameserver` line, always `127.0.0.11` |
| `c7.p1.user_bridge_name_lookup_ok` | Does the name resolve there | `getent hosts <container>` |
| `c7.p1.user_bridge_lookup_ms` | Milliseconds for that lookup | Median of 3, includes `docker exec` overhead |
| `c7.p1.user_bridge_name_reach_ok` | Can a container connect by name | `nc -w 2 <container> 8000` |
| `c7.p1.cross_network_ip_reach_ok` | Can a container on another user-defined network reach it by IP | `nc -w 2 <ip> 8000` |
| `c7.p1.cross_network_probe_s` | Seconds until the client gives up (the 2 s `nc` timeout plus overhead) | Median of 3 |
| `c7.p1.topology_name_ok` | Does `api` reach `db` by the name `db` in the learner's `topology.json` | `nc -w 2 db 8000` inside `api` |
| `c7.p1.topology_user_networks_count` | User-defined networks the learner's topology created | Count of `networks` entries except `bridge` |

## Part 2: the localhost trap

| Fact | Meaning | How it was measured |
|---|---|---|
| `c7.p2.api_localhost_result` | Result of a TCP connect from the api to `localhost:5432` | Node `net.connect` inside the api container, error code or `open` |
| `c7.p2.api_localhost_ms` | Milliseconds to get that answer | Median of 3, measured inside the container |
| `c7.p2.api_by_name_result`, `c7.p2.api_by_name_ms` | The same to `db:5432` | Same method |
| `c7.p2.db_own_localhost_ok` | `localhost:5432` from inside the database container | `nc -z -w 2 localhost 5432` |
| `c7.p2.host_published_result` | Connect from the host to the published port on `127.0.0.1` | Node `net.connect` on the host |
| `c7.p2.api_host_docker_internal_result` | The api to `host.docker.internal` and the published port | Same probe as the api's |
| `c7.p2.api_published_port_on_localhost_result` | The api to `127.0.0.1` and the published port number | Same probe |
| `c7.p2.published_port` | The random free host port of this run | Chosen by `freePort()` |
| `c7.p2.api_env_db_host` | `DB_HOST` in the learner's `api.env` | Read from the file |
| `c7.p2.api_env_result` | The api's probe using the learner's `api.env` | Same probe, container environment |

## Part 3: exposure scan

| Fact | Meaning | How it was measured |
|---|---|---|
| `c7.p3.published_ports_count` | Distinct host ports the stack publishes | `docker inspect` `NetworkSettings.Ports`, IPv4 and IPv6 bindings of one port counted once |
| `c7.p3.wildcard_bound_count` | How many of them are bound to `0.0.0.0` or `::` | Same inspect data |
| `c7.p3.lan_reachable_count` | How many answer on a non-loopback address of the host | TCP connect to each published port on each address from `os.networkInterfaces()` (not loopback, not 169.254.x.x), 1.5 s timeout |
| `c7.p3.lan_addresses_count` | How many such addresses were used | Same list |
| `c7.p3.db_published` | Does the db service publish any port | `docker inspect` |
| `c7.p3.db_reachable_from_lan` | Does the db port answer on a non-loopback address | Same scan |
| `c7.p3.web_reaches_db` | Can the web container open `db:5432` | `nc -z -w 2 db 5432` inside web |
| `c7.p3.api_reaches_db` | Can the api container open `db:5432` | Same inside api |
| `c7.p3.end_to_end_ok` | A request to web's published port returns the api's JSON | `fetch` from the host, up to 20 tries |
| `c7.p3.networks_count` | Networks Compose created | `docker network ls` with the project label |
| `c7.p3.scan_s` | Seconds the scan took | `process.hrtime`, single run |

## Part 4: lose a volume, then get the data back

| Fact | Meaning | How it was measured |
|---|---|---|
| `c7.p4.rows_before` | Rows written | `SELECT count(*)` |
| `c7.p4.rows_after_recreate` | Rows after `rm -sf db` and `up -d db` | Same |
| `c7.p4.same_volume_after_recreate` | Same volume name mounted before and after | `docker inspect` mounts |
| `c7.p4.volume_is_named` | Data directory on `dkr-c7-p4_pgdata` | `docker inspect` mounts |
| `c7.p4.rows_after_volume_loss` | Rows after `down -v` and `up -d` | Same |
| `c7.p4.rows_after_restore_dump`, `c7.p4.rows_after_restore_tar` | Rows after each restore | Same |
| `c7.p4.dump_bytes`, `c7.p4.dump_s` | Size of the `pg_dump --clean --if-exists` output, and seconds | Bytes of stdout; median of 3 |
| `c7.p4.tar_mb`, `c7.p4.tar_s` | Size of the `tar` stream of the stopped volume in MB (10^6 is not used: 1 MB = 1048576 bytes), and seconds | Bytes of stdout of `tar cf -`; median of 3 |
| `c7.p4.restore_dump_s` | Seconds to feed the dump into a running `psql` | Median of 3 |
| `c7.p4.restore_tar_s` | Seconds to empty the volume and unpack the tar (database stopped, restart not included) | Median of 3 |
