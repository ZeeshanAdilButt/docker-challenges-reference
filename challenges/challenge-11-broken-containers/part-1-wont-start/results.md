# Results: Challenge 11, part 1: services that will not start

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
cd services/01-wrong-entrypoint && docker compose up -d --build
```

**Output**

```text
 Network dkr-c11-wrong-entrypoint_default Created 
 Network dkr-c11-wrong-entrypoint_default Created 
 Container dkr-c11-wrong-entrypoint Creating 
 Container dkr-c11-wrong-entrypoint Created 
 Container dkr-c11-wrong-entrypoint Starting 
Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "/app/start": stat /app/start: no such file or directory
wrong-entrypoint: created
FAIL GET http://127.0.0.1:18101/health: no answer (ECONNREFUSED)
```

**Note:** Ticket: Deploy of the orders API: the container never comes up. `docker compose up` prints an error. Here is what the starter version does.

## Step 2

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-wrong-entrypoint --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                      STATUS    PORTS
dkr-c11-wrong-entrypoint   Created
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 3

**Command**

```sh
docker logs --tail 5 dkr-c11-wrong-entrypoint
```

**Output**

```text
(no output)
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output.

## Step 4

**Command**

```sh
docker inspect dkr-c11-wrong-entrypoint --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=127 oom=false error=failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "/app/start": stat /app/start: no such file or directory restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error.

## Step 5

**Command**

```sh
docker image inspect dkr-c11/wrong-entrypoint:1 --format "entrypoint={{json .Config.Entrypoint}} user={{.Config.User}}"
```

**Output**

```text
entrypoint=["/app/start"] user=node
```

**Note:** Rung 4. What does the image try to run?

## Step 6

**Command**

```sh
docker run --rm --name dkr-c11-ladder --label dkr.challenge=11 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges --entrypoint ls dkr-c11/wrong-entrypoint:1 -l /app
```

**Output**

```text
total 8
-rwxr-xr-x    1 root     root           764 Nov  5 00:18 server.mjs
-rwxr-xr-x    1 root     root           133 Nov  5 00:18 start.sh
```

**Note:** Rung 5. Does that file exist? The entrypoint says /app/start, the folder has start.sh.

## Step 7

**Command**

```sh
cd reference/services/01-wrong-entrypoint && docker compose up -d --build
```

**Output**

```text
wrong-entrypoint: running
ok   GET http://127.0.0.1:18101/health: HTTP 200 {"status":"ok","service":"wrong-entrypoint"}
```

**Note:** Fixed. The service is running and every check answers.

## Step 8

**Command**

```sh
cd services/02-missing-env && docker compose up -d --build
```

**Output**

```text
 Network dkr-c11-missing-env_default Created 
 Network dkr-c11-missing-env_default Created 
 Container dkr-c11-missing-env Creating 
 Container dkr-c11-missing-env Created 
 Container dkr-c11-missing-env Starting 
 Container dkr-c11-missing-env Started
missing-env: exited, exit 1
FAIL GET http://127.0.0.1:18102/health: no answer (ECONNREFUSED)
FAIL GET http://127.0.0.1:18102/: no answer (ECONNREFUSED)
```

**Note:** Ticket: The billing API starts and is gone a second later. Nothing answers on port 18102. Here is what the starter version does.

## Step 9

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-missing-env --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                 STATUS                     PORTS
dkr-c11-missing-env   Exited (1) 2 seconds ago
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 10

**Command**

```sh
docker logs --tail 5 dkr-c11-missing-env
```

**Output**

```text
FATAL: DATABASE_URL is not set. Set it to a postgres:// address.
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output.

## Step 11

**Command**

```sh
docker inspect dkr-c11-missing-env --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=1 oom=false error= restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error.

## Step 12

**Command**

```sh
docker inspect dkr-c11-missing-env --format "{{json .Config.Env}}"
```

**Output**

```text
["DB_URL=postgres://shop:secret@db.internal:5432/shop","PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=24.22.2","YARN_VERSION=1.22.22"]
```

**Note:** Rung 4. Which variables did the container really get? The name is DB_URL, the app wants DATABASE_URL.

## Step 13

**Command**

```sh
cd reference/services/02-missing-env && docker compose up -d --build
```

**Output**

```text
missing-env: running
ok   GET http://127.0.0.1:18102/health: HTTP 200 {"status":"ok","service":"missing-env"}
ok   GET http://127.0.0.1:18102/: HTTP 200 {"service":"missing-env","database_host":"db.internal"}
```

**Note:** Fixed. The service is running and every check answers.

## Step 14

**Command**

```sh
cd services/03-volume-permission && docker compose up -d --build
```

**Output**

```text
 Network dkr-c11-volume-permission_default Created 
 Network dkr-c11-volume-permission_default Created 
 Container dkr-c11-volume-permission Creating 
 Container dkr-c11-volume-permission Created 
 Container dkr-c11-volume-permission Starting 
 Container dkr-c11-volume-permission Started
volume-permission: exited, exit 1
FAIL GET http://127.0.0.1:18103/health: no answer (ECONNREFUSED)
FAIL GET http://127.0.0.1:18103/: no answer (ECONNREFUSED)
```

**Note:** Ticket: The shop API keeps its data in a volume. Since we added the volume the container exits right after start. Here is what the starter version does.

## Step 15

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-volume-permission --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                       STATUS                     PORTS
dkr-c11-volume-permission   Exited (1) 2 seconds ago
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 16

**Command**

```sh
docker logs --tail 5 dkr-c11-volume-permission
```

**Output**

```text
  syscall: 'mkdir',
  path: '/var/lib/shop/db'
}

Node.js v24.22.2
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output.

## Step 17

**Command**

```sh
docker inspect dkr-c11-volume-permission --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=1 oom=false error= restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error.

## Step 18

**Command**

```sh
docker run --rm --name dkr-c11-ladder --label dkr.challenge=11 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges -v dkr-c11-volume-permission_shop-data:/v --entrypoint ls dkr-c11/volume-permission:1 -ldn /v
```

**Output**

```text
drwxr-xr-x    2 0        0             4096 Nov  5 00:27 /v
```

**Note:** Rung 4. Who owns the volume? User 0 (root) owns it.

## Step 19

**Command**

```sh
docker run --rm --name dkr-c11-ladder --label dkr.challenge=11 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges --entrypoint id dkr-c11/volume-permission:1
```

**Output**

```text
uid=1000(node) gid=1000(node) groups=1000(node),1000(node)
```

**Note:** Rung 5. Who is the app? User 1000 cannot write into a folder owned by root.

## Step 20

**Command**

```sh
cd reference/services/03-volume-permission && docker compose up -d --build
```

**Output**

```text
volume-permission: running
ok   GET http://127.0.0.1:18103/health: HTTP 200 {"status":"ok","service":"volume-permission"}
ok   GET http://127.0.0.1:18103/: HTTP 200 {"service":"volume-permission","started_at":"2026-11-05T00:27:22.009Z"}
```

**Note:** Fixed. The service is running and every check answers.

## Step 21

**Command**

```sh
cd services/04-exit-137 && docker compose up -d --build
```

**Output**

```text
 Network dkr-c11-exit-137_default Created 
 Network dkr-c11-exit-137_default Created 
 Container dkr-c11-exit-137 Creating 
 Container dkr-c11-exit-137 Created 
 Container dkr-c11-exit-137 Starting 
 Container dkr-c11-exit-137 Started
exit-137: exited, exit 137, OOMKilled
FAIL GET http://127.0.0.1:18104/health: no answer (ECONNREFUSED)
FAIL GET http://127.0.0.1:18104/: no answer (ECONNREFUSED)
```

**Note:** Ticket: The catalogue API loads a cache at start-up and then dies. Someone says "it is killed". By what? Here is what the starter version does.

## Step 22

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-exit-137 --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES              STATUS                      PORTS
dkr-c11-exit-137   Exited (137) 1 second ago
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 23

**Command**

```sh
docker logs --tail 5 dkr-c11-exit-137
```

**Output**

```text
(no output)
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output.

## Step 24

**Command**

```sh
docker inspect dkr-c11-exit-137 --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=137 oom=true error= restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error.

## Step 25

**Command**

```sh
docker inspect dkr-c11-exit-137 --format "memory_bytes={{.HostConfig.Memory}} env={{json .Config.Env}}"
```

**Output**

```text
memory_bytes=33554432 env=["PRELOAD_MB=48","PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=24.22.2","YARN_VERSION=1.22.22"]
```

**Note:** Rung 4. The limit is 33554432 bytes (32 MB) and the cache is 48 MB.

## Step 26

**Command**

```sh
cd reference/services/04-exit-137 && docker compose up -d --build
```

**Output**

```text
exit-137: running
ok   GET http://127.0.0.1:18104/health: HTTP 200 {"status":"ok","service":"exit-137"}
ok   GET http://127.0.0.1:18104/: HTTP 200 {"service":"exit-137","preloaded_mb":16}
```

**Note:** Fixed. The service is running and every check answers.
