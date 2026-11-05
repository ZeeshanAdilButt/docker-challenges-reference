# Results: Challenge 11, part 3: services that need another way in

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
cd services/08-read-only-root && docker compose up -d --build
```

**Output**

```text
 Network dkr-c11-read-only-root_default Created 
 Container dkr-c11-read-only-root Creating 
 Container dkr-c11-read-only-root Created 
 Container dkr-c11-read-only-root Starting 
 Container dkr-c11-read-only-root Started
read-only-root: exited, exit 1
FAIL GET http://127.0.0.1:18108/health: no answer (ECONNREFUSED)
```

**Note:** Ticket: Security made the root filesystem read-only. Now the pricing API exits at start-up. Here is what the starter version does.

## Step 2

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-read-only-root --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                    STATUS                     PORTS
dkr-c11-read-only-root   Exited (1) 2 seconds ago
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 3

**Command**

```sh
docker logs --tail 15 dkr-c11-read-only-root
```

**Output**

```text
                         ^

Error: ENOENT: no such file or directory, mkdir '/app/cache'
    at mkdirSync (node:fs:1410:26)
    at file:///app/server.mjs:9:1
    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)
    at async node:internal/modules/esm/loader:647:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  errno: -2,
  code: 'ENOENT',
  syscall: 'mkdir',
  path: '/app/cache'
}

Node.js v24.22.2
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output (the error is usually in the first few lines of a stack trace).

## Step 4

**Command**

```sh
docker inspect dkr-c11-read-only-root --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=1 oom=false error= restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error. (For a container that is still running these are all zero or empty.)

## Step 5

**Command**

```sh
docker inspect dkr-c11-read-only-root --format "readonly_root={{.HostConfig.ReadonlyRootfs}} tmpfs={{json .HostConfig.Tmpfs}}"
```

**Output**

```text
readonly_root=true tmpfs=null
```

**Note:** Rung 4. The root is read-only and nothing writable is mounted.

## Step 6

**Command**

```sh
docker run --rm --name dkr-c11-ladder --label dkr.challenge=11 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges --read-only --entrypoint mkdir dkr-c11/read-only-root:1 /app/cache
```

**Output**

```text
mkdir: can't create directory '/app/cache': Read-only file system
```

**Note:** Rung 5. Prove it: the same image, read-only, cannot create the folder.

## Step 7

**Command**

```sh
cd reference/services/08-read-only-root && docker compose up -d --build
```

**Output**

```text
read-only-root: running
ok   GET http://127.0.0.1:18108/health: HTTP 200 {"status":"ok","service":"read-only-root"}
```

**Note:** Fixed. The service is running and every check answers.

## Step 8

**Command**

```sh
cd services/09-missing-shell && docker compose up -d --build
```

**Output**

```text
 Network dkr-c11-missing-shell_default Created 
 Container dkr-c11-missing-shell Creating 
 Container dkr-c11-missing-shell Created 
 Container dkr-c11-missing-shell Starting 
 Container dkr-c11-missing-shell Started
missing-shell: exited, exit 255
FAIL GET http://127.0.0.1:18109/health: no answer (ECONNREFUSED)
```

**Note:** Ticket: The new hardened image (no shell) exits at once. You cannot get a shell inside to look around. Here is what the starter version does.

## Step 9

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-missing-shell --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                   STATUS                      PORTS
dkr-c11-missing-shell   Exited (255) 1 second ago
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 10

**Command**

```sh
docker logs --tail 15 dkr-c11-missing-shell
```

**Output**

```text
exec /app/start.sh: no such file or directory
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output (the error is usually in the first few lines of a stack trace).

## Step 11

**Command**

```sh
docker inspect dkr-c11-missing-shell --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=255 oom=false error= restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error. (For a container that is still running these are all zero or empty.)

## Step 12

**Command**

```sh
docker run --rm --name dkr-c11-ladder --label dkr.challenge=11 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges --entrypoint sh dkr-c11/missing-shell:1
```

**Output**

```text
docker: Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "sh": executable file not found in $PATH

Run 'docker run --help' for more information
```

**Note:** Rung 4. Can you get a shell in this image? No shell exists.

## Step 13

**Command**

```sh
docker run --rm --name dkr-c11-ladder --label dkr.challenge=11 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges --entrypoint node dkr-c11/missing-shell:1 -e "console.log(require('fs').readFileSync('/app/start.sh','utf8').split('\n')[0], 'shell exists:', require('fs').existsSync('/bin/sh'))"
```

**Output**

```text
#!/bin/sh shell exists: false
```

**Note:** Rung 5. Use the one tool that is there (node) to read the first line of the script. It asks for /bin/sh, which was removed.

## Step 14

**Command**

```sh
cd reference/services/09-missing-shell && docker compose up -d --build
```

**Output**

```text
missing-shell: running
ok   GET http://127.0.0.1:18109/health: HTTP 200 {"status":"ok","service":"missing-shell"}
```

**Note:** Fixed. The service is running and every check answers.

## Step 15

**Command**

```sh
cd services/10-wrong-user && docker compose up -d --build
```

**Output**

```text
 Network dkr-c11-wrong-user_default Created 
 Container dkr-c11-wrong-user Creating 
 Container dkr-c11-wrong-user Created 
 Container dkr-c11-wrong-user Starting 
 Container dkr-c11-wrong-user Started
wrong-user: exited, exit 1
FAIL GET http://127.0.0.1:18110/health: no answer (ECONNREFUSED)
FAIL GET http://127.0.0.1:18110/: no answer (ECONNREFUSED)
```

**Note:** Ticket: The profile API runs as a normal user (good!) and exits at start-up. It worked as root. Here is what the starter version does.

## Step 16

**Command**

```sh
docker ps -a --filter label=dkr.challenge=11 --filter name=dkr-c11-wrong-user --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
```

**Output**

```text
NAMES                STATUS                     PORTS
dkr-c11-wrong-user   Exited (1) 2 seconds ago
```

**Note:** Rung 1. Is it running? The status column says what state it is in.

## Step 17

**Command**

```sh
docker logs --tail 15 dkr-c11-wrong-user
```

**Output**

```text
                   ^

Error: EACCES: permission denied, open '/app/config.json'
    at readFileSync (node:fs:483:20)
    at file:///app/server.mjs:7:27
    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)
    at async node:internal/modules/esm/loader:647:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  errno: -13,
  code: 'EACCES',
  syscall: 'open',
  path: '/app/config.json'
}

Node.js v24.22.2
```

**Note:** Rung 2. What did it say before it stopped? Read the last lines of its output (the error is usually in the first few lines of a stack trace).

## Step 18

**Command**

```sh
docker inspect dkr-c11-wrong-user --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}"
```

**Output**

```text
exit=1 oom=false error= restarts=0
```

**Note:** Rung 3. Why did it stop? Exit code, OOM flag and the engine error. (For a container that is still running these are all zero or empty.)

## Step 19

**Command**

```sh
docker run --rm --name dkr-c11-ladder --label dkr.challenge=11 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges --user 0 --entrypoint ls dkr-c11/wrong-user:1 -ln /app
```

**Output**

```text
total 8
-rw-------    1 0        0               47 Nov  5 00:18 config.json
-rwxr-xr-x    1 0        0              967 Nov  5 00:18 server.mjs
```

**Note:** Rung 4. Look as root. config.json belongs to user 0 and has mode 600.

## Step 20

**Command**

```sh
docker run --rm --name dkr-c11-ladder --label dkr.challenge=11 --memory 64m --memory-swap 64m --pids-limit 50 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges --entrypoint id dkr-c11/wrong-user:1
```

**Output**

```text
uid=1000(node) gid=1000(node) groups=1000(node),1000(node)
```

**Note:** Rung 5. The app runs as user 1000. It cannot read a file that only root may read.

## Step 21

**Command**

```sh
cd reference/services/10-wrong-user && docker compose up -d --build
```

**Output**

```text
wrong-user: running
ok   GET http://127.0.0.1:18110/health: HTTP 200 {"status":"ok","service":"wrong-user"}
ok   GET http://127.0.0.1:18110/: HTTP 200 {"service":"wrong-user","greeting":"hello from the config file","uid":1000}
```

**Note:** Fixed. The service is running and every check answers.
