# Results: Challenge 10, part 3: audit the host

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker create ... (four times, flags differ)
```

**Output**

```text
dkr-c10-aud-good: --memory 64m --memory-swap 64m --pids-limit 50 --log-driver json-file --log-opt max-size=1m --log-opt max-file=2 --restart on-failure:3 --user 10001:10001 --read-only --cap-drop ALL --security-opt no-new-privileges --health-cmd true --health-interval 30s
dkr-c10-aud-nolimits: (no flags at all)
dkr-c10-aud-unrotated: --memory 64m --pids-limit 50 --log-driver json-file --user 10001:10001 --read-only
dkr-c10-aud-restart-always: --memory 64m --pids-limit 50 --log-driver json-file --log-opt max-size=1m --log-opt max-file=2 --restart always --user 10001:10001
```

**Note:** Four containers with different settings: one careful, three with a problem each. They are only created, so nothing runs without a cap.

## Step 2

**Command**

```sh
docker inspect --format '{{.Name}} memory={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}} log={{.HostConfig.LogConfig.Type}}{{.HostConfig.LogConfig.Config}} restart={{.HostConfig.RestartPolicy.Name}} user={{.Config.User}}' <container>
```

**Output**

```text
/dkr-c10-aud-good memory=67108864 pids=50 log=json-filemap[max-file:2 max-size:1m] restart=on-failure user=10001:10001
/dkr-c10-aud-nolimits memory=0 pids=<nil> log=localmap[] restart=no user=
/dkr-c10-aud-unrotated memory=67108864 pids=50 log=json-filemap[] restart=no user=10001:10001
/dkr-c10-aud-restart-always memory=67108864 pids=50 log=json-filemap[max-file:2 max-size:1m] restart=always user=10001:10001
```

**Note:** Everything the audit needs is already in docker inspect. Zero means no limit. An empty user means root.

## Step 3

**Command**

```sh
docker ps -a -s --filter name=dkr-c10-aud-good --format '{{.Size}}'
```

**Output**

```text
4.1kB (virtual 9.11MB)
parseSize gives 4100 bytes
```

**Note:** Docker prints sizes in decimal units (1 kB is 1000 bytes). Your parseSize has to read the first number only.

## Step 4

**Command**

```sh
docker inspect <the four> | node audit.mjs -
```

**Output**

```text
ok      -                dkr-c10-aud-good            no findings
HIGH    no-memory-limit  dkr-c10-aud-nolimits        no --memory: one leak can take the whole host
MEDIUM  no-pids-limit    dkr-c10-aud-nolimits        no --pids-limit: a fork loop can exhaust the host process table
MEDIUM  runs-as-root     dkr-c10-aud-nolimits        the process runs as root inside the container
LOW     writable-rootfs  dkr-c10-aud-nolimits        the root filesystem is writable: a compromised process can change the image files
LOW     no-healthcheck   dkr-c10-aud-nolimits        no health check: Docker cannot tell a stuck process from a working one
HIGH    log-not-rotated  dkr-c10-aud-unrotated       json-file log without max-size: the log grows until the disk is full
LOW     no-healthcheck   dkr-c10-aud-unrotated       no health check: Docker cannot tell a stuck process from a working one
MEDIUM  restart-always   dkr-c10-aud-restart-always  restart always hides crashes and restarts forever
LOW     writable-rootfs  dkr-c10-aud-restart-always  the root filesystem is writable: a compromised process can change the image files
LOW     no-healthcheck   dkr-c10-aud-restart-always  no health check: Docker cannot tell a stuck process from a working one

4 containers: 0 critical, 2 high, 3 medium, 5 low
exit code 1
```

**Note:** One line per finding. Exit code 1 means at least one critical or high finding.

## Step 5

**Command**

```sh
compare the findings with the expected ones
```

**Output**

```text
PASS  good: 0 findings
PASS  nolimits: 5 findings
PASS  unrotated: 2 findings
PASS  restart-always: 3 findings
```

**Note:** Your audit matches on all four containers.

## Step 6

**Command**

```sh
node audit.mjs --live --label dkr.challenge=10
```

**Output**

```text
MEDIUM  restart-always   dkr-c10-aud-restart-always  restart always hides crashes and restarts forever
LOW     writable-rootfs  dkr-c10-aud-restart-always  the root filesystem is writable: a compromised process can change the image files
LOW     no-healthcheck   dkr-c10-aud-restart-always  no health check: Docker cannot tell a stuck process from a working one
HIGH    log-not-rotated  dkr-c10-aud-unrotated       json-file log without max-size: the log grows until the disk is full
LOW     no-healthcheck   dkr-c10-aud-unrotated       no health check: Docker cannot tell a stuck process from a working one
HIGH    no-memory-limit  dkr-c10-aud-nolimits        no --memory: one leak can take the whole host
MEDIUM  no-pids-limit    dkr-c10-aud-nolimits        no --pids-limit: a fork loop can exhaust the host process table
MEDIUM  runs-as-root     dkr-c10-aud-nolimits        the process runs as root inside the container
LOW     writable-rootfs  dkr-c10-aud-nolimits        the root filesystem is writable: a compromised process can change the image files
LOW     no-healthcheck   dkr-c10-aud-nolimits        no health check: Docker cannot tell a stuck process from a working one
ok      -                dkr-c10-aud-good            no findings

4 containers: 0 critical, 2 high, 3 medium, 5 low
```

**Note:** Live mode asks Docker for the containers itself. It only reads. Without --label it audits every container on your Docker.

## Step 7

**Command**

```sh
node audit.mjs --live   (only the counts are shown here)
```

**Output**

```text
43 other containers on this Docker
35 have no memory limit
23 keep an unrotated json-file log
1 use restart always
```

**Note:** This is the real use of the tool: run it on a host and read the counts. Names are not printed here because they are not yours.
