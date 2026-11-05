# Diagnosis ladder: answer key for part 2

These three services are running. The ladder changes: rung 1 is "what does Docker say about it", and the network rungs matter.

1. Is it running, and what does Docker say? `docker ps -a --filter name=<name>`
2. What does it log?
3. Why did it stop, or what does it think is wrong? `docker inspect` (State, Health)
4. Does it have what it needs? Files, config, mounts.
5. Can it reach the network? From the inside: `docker exec <name> nslookup <other>` and `wget`.
6. Is it starved?

The exact output for each service is in [results.md](../results.md).

## 05-port-clash

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a --filter name=dkr-c11-port-clash` | web `Up` with `127.0.0.1:18105->8080/tcp`, admin `Created` with no ports | One of two never started. |
| 2 | `docker logs <admin>` | No output | It never ran. |
| 3 | `docker inspect <admin> --format 'exit=...'` | `exit=128` and an error | Exit 128 and an engine error: the container was created but could not be started. |
| 4 | `docker inspect <admin> --format 'error={{.State.Error}}'` | `Bind for 127.0.0.1:18105 failed: port is already allocated` | Cause found. |
| 5 | `docker port <web>` | `8080/tcp -> 127.0.0.1:18105` | The other container holds that host port. |

Fix: give admin its own host port, for example `127.0.0.1:18115:8080`. Also remember that a port can be taken by something that is not Docker (`netstat -ano` on Windows, `ss -ltnp` on Linux).

## 06-bad-healthcheck

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | `Up 3 seconds (unhealthy)` | Running, but the check fails. The app may be fine. |
| 2 | `docker logs` | `listening` on 8080 | The app is up. |
| 3 | `docker inspect` | `exit=0` | It has not stopped. Docker only marks unhealthy. Plain Docker does not restart it. |
| 4 | `docker inspect --format '{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}'` | `wget: can't connect to remote host (127.0.0.1): Connection refused` | The check cannot connect. |
| 5 | `docker exec <name> wget -q -O - http://127.0.0.1:8080/health` | `{"status":"ok",...}` | The service answers on 8080, the check asks 3000. |

Fix: change the port in the check. Do not remove the check.

## 07-dns-typo

| Rung | Command | What you see | What it tells you |
|---|---|---|---|
| 1 | `docker ps -a` | Both `Up` | Nothing is down. |
| 2 | `docker logs <gateway>` | `backend call failed ... url http://backnd:8080 ... aborted due to timeout` | The URL has the name `backnd`. Read the name. A bad name does not always say "not found": here the call timed out after 3 seconds. |
| 3 | `docker inspect <gateway>` | `exit=0` | Not stopped. |
| 4 | `docker exec <gateway> nslookup backnd` | `server can't find backnd: NXDOMAIN` | The name does not exist on this network. Cause found. |
| 5 | `docker exec <gateway> nslookup backend` | An address on the compose network | The real name works. |

Fix: `BACKEND_URL: http://backend:8080`. Service names are the DNS names on a Compose network.
