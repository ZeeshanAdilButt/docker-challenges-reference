# Results: Challenge 11, part 2: services that run but cannot be used

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
cd services/05-port-clash && docker compose up -d --build
```

**Output**

```text
 Container dkr-c11-port-clash-web Created 
 Container dkr-c11-port-clash-admin Created 
 Container dkr-c11-port-clash-web Starting 
 Container dkr-c11-port-clash-admin Starting 
 Container dkr-c11-port-clash-web Started 
Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint dkr-c11-port-clash-admin (<id>): Bind for 127.0.0.1:18105 failed: port is already allocated
port-clash-web: running; port-clash-admin: created
ok   GET http://127.0.0.1:18105/health: HTTP 200 {"status":"ok","service":"port-clash"}
FAIL admin site: no answer (admin has no published port)
```

**Note:** Ticket: The web site is fine but the admin site never starts. The compose file looks right. Here is what the starter version does.

## Step 2

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-port-clash --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                      STATUS         PORTS
dkr-c11-port-clash-admin   Created        
dkr-c11-port-clash-web     Up 4 seconds   127.0.0.1:18105->8080/tcp
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 3

**Command**

```sh
docker logs --tail 15 dkr-c11-port-clash-admin
```

**Output**

```text
(no output)
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output (the error is usually in the first few lines of a stack trace).

## Step 4

**Command**

```sh
docker inspect dkr-c11-port-clash-admin --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=128 oom=false error=failed to set up container networking: driver failed programming external connectivity on endpoint dkr-c11-port-clash-admin (87b1c5faf698476332e15204fd22ac907bcdef8ffdd2f5576be7b7b8f3492b42): Bind for 127.0.0.1:18105 failed: port is already allocated restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error.

## Step 5

**Command**

```sh
docker inspect dkr-c11-port-clash-admin --format "error={{.State.Error}}"
```

**Output**

```text
error=failed to set up container networking: driver failed programming external connectivity on endpoint dkr-c11-port-clash-admin (87b1c5faf698476332e15204fd22ac907bcdef8ffdd2f5576be7b7b8f3492b42): Bind for 127.0.0.1:18105 failed: port is already allocated
```

**Note:** Rung 4. The admin container never started. The engine says why: the port is already allocated.

## Step 6

**Command**

```sh
docker port dkr-c11-port-clash-web
```

**Output**

```text
8080/tcp -> 127.0.0.1:18105
```

**Note:** Rung 5. The web container holds the same host port.

## Step 7

**Command**

```sh
cd reference/services/05-port-clash && docker compose up -d --build
```

**Output**

```text
port-clash-web: running; port-clash-admin: running
ok   GET http://127.0.0.1:18105/health: HTTP 200 {"status":"ok","service":"port-clash"}
ok   admin site on port 18115: HTTP 200 {"service":"port-clash","role":"admin"}
```

**Note:** Fixed. The service is running and every check answers.

## Step 8

**Command**

```sh
cd services/06-bad-healthcheck && docker compose up -d --build
```

**Output**

```text
 Network dkr-c11-bad-healthcheck_default Created 
 Network dkr-c11-bad-healthcheck_default Created 
 Container dkr-c11-bad-healthcheck Creating 
 Container dkr-c11-bad-healthcheck Created 
 Container dkr-c11-bad-healthcheck Starting 
 Container dkr-c11-bad-healthcheck Started
bad-healthcheck: running, unhealthy
ok   GET http://127.0.0.1:18106/health: HTTP 200 {"status":"ok","service":"bad-healthcheck"}
```

**Note:** Ticket: The reports API answers requests, but Docker says it is unhealthy and the deploy tool refuses to continue. Here is what the starter version does.

## Step 9

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-bad-healthcheck --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                     STATUS                     PORTS
dkr-c11-bad-healthcheck   Up 3 seconds (unhealthy)   127.0.0.1:18106->8080/tcp
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 10

**Command**

```sh
docker logs --tail 15 dkr-c11-bad-healthcheck
```

**Output**

```text
{"event":"listening","service":"bad-healthcheck","port":8080}
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output (the error is usually in the first few lines of a stack trace).

## Step 11

**Command**

```sh
docker inspect dkr-c11-bad-healthcheck --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=0 oom=false error= restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error.

## Step 12

**Command**

```sh
docker inspect dkr-c11-bad-healthcheck --format "{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}"
```

**Output**

```text
1 wget: can't connect to remote host (127.0.0.1): Connection refused
1 wget: can't connect to remote host (127.0.0.1): Connection refused
```

**Note:** Rung 4. What did the health check print? Nothing answered on port 3000.

## Step 13

**Command**

```sh
docker exec dkr-c11-bad-healthcheck wget -q -O - http://127.0.0.1:8080/health
```

**Output**

```text
{"status":"ok","service":"bad-healthcheck"}
```

**Note:** Rung 5. Run the real check by hand on the right port. The service is fine.

## Step 14

**Command**

```sh
cd reference/services/06-bad-healthcheck && docker compose up -d --build
```

**Output**

```text
bad-healthcheck: running, healthy
ok   GET http://127.0.0.1:18106/health: HTTP 200 {"status":"ok","service":"bad-healthcheck"}
```

**Note:** Fixed. The service is running and every check answers.

## Step 15

**Command**

```sh
cd services/07-dns-typo && docker compose up -d --build
```

**Output**

```text
 Container dkr-c11-dns-typo-backend Created 
 Container dkr-c11-dns-typo-gateway Created 
 Container dkr-c11-dns-typo-gateway Starting 
 Container dkr-c11-dns-typo-backend Starting 
 Container dkr-c11-dns-typo-gateway Started 
 Container dkr-c11-dns-typo-backend Started
dns-typo-gateway: running; dns-typo-backend: running
ok   GET http://127.0.0.1:18107/health: HTTP 200 {"status":"ok","service":"dns-typo"}
FAIL GET http://127.0.0.1:18107/orders: HTTP 502 {"error":"backend unreachable","detail":"The operation was aborted due to timeout"}
```

**Note:** Ticket: Both containers are running. The gateway answers /health but /orders returns a 502 error. Here is what the starter version does.

## Step 16

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-dns-typo --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                      STATUS          PORTS
dkr-c11-dns-typo-gateway   Up 21 seconds   127.0.0.1:18107->8080/tcp
dkr-c11-dns-typo-backend   Up 19 seconds
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 17

**Command**

```sh
docker logs --tail 15 dkr-c11-dns-typo-gateway
```

**Output**

```text
{"event":"listening","service":"dns-typo","port":8080}
{"event":"backend call failed","url":"http://backnd:8080","error":"The operation was aborted due to timeout"}
{"event":"backend call failed","url":"http://backnd:8080","error":"The operation was aborted due to timeout"}
{"event":"backend call failed","url":"http://backnd:8080","error":"The operation was aborted due to timeout"}
{"event":"backend call failed","url":"http://backnd:8080","error":"The operation was aborted due to timeout"}
{"event":"backend call failed","url":"http://backnd:8080","error":"The operation was aborted due to timeout"}
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output (the error is usually in the first few lines of a stack trace).

## Step 18

**Command**

```sh
docker inspect dkr-c11-dns-typo-gateway --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=0 oom=false error= restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error.

## Step 19

**Command**

```sh
docker exec dkr-c11-dns-typo-gateway nslookup backnd
```

**Output**

```text
Server:		127.0.0.11
Address:	127.0.0.11:53

Non-authoritative answer:

** server can't find backnd: NXDOMAIN
```

**Note:** Rung 4. Can the gateway find the name it calls? No: NXDOMAIN.

## Step 20

**Command**

```sh
docker exec dkr-c11-dns-typo-gateway nslookup backend
```

**Output**

```text
Server:		127.0.0.11
Address:	127.0.0.11:53

Non-authoritative answer:

Non-authoritative answer:
Name:	backend
Address: 172.24.0.3
```

**Note:** Rung 5. The real service name resolves to an address on the network.

## Step 21

**Command**

```sh
cd reference/services/07-dns-typo && docker compose up -d --build
```

**Output**

```text
dns-typo-gateway: running; dns-typo-backend: running
ok   GET http://127.0.0.1:18107/health: HTTP 200 {"status":"ok","service":"dns-typo"}
ok   GET http://127.0.0.1:18107/orders: HTTP 200 {"orders":[{"id":1,"item":"tea"},{"id":2,"item":"sugar"}]}
```

**Note:** Fixed. The service is running and every check answers.
