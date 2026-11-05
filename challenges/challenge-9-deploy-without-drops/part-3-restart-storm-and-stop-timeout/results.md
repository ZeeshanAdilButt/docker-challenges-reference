# Results: Challenge 9, part 3: a restart storm, and how long docker stop waits

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker run --init   (alpine sleep 1000)   then: docker stop   (3 times)
```

**Output**

```text
0.4 s, 0.6 s, 0.6 s   exit code 143
```

**Note:** With --init, a tiny init program is PID 1. It passes SIGTERM to sleep, so the container stops at once: median 0.6 s.

## Step 2

**Command**

```sh
docker run alpine:3.23 sleep 1000   then: docker stop   (3 times)
```

**Output**

```text
3.6 s, 3.6 s, 3.5 s   exit code 137
```

**Note:** PID 1 is sleep and ignores SIGTERM. docker stop waits, then sends SIGKILL (exit code 137). The default wait measured on this machine: 3.6 s (median of 3). The docs say 10 s.

## Step 3

**Command**

```sh
docker inspect <container> --format "{{.Config.StopTimeout}} [{{.Config.StopSignal}}]"
```

**Output**

```text
<nil> []
```

**Note:** No stop timeout is stored in the container: it is empty, so Docker uses its built-in default. No stop signal is stored either, so Docker uses SIGTERM.

## Step 4

**Command**

```sh
docker stop -t N <container>   for N = 0, 1, 2, 3, 6, 10   (3 times each)
```

**Output**

```text
-t 0: 0.6 s, 0.4 s, 0.4 s   (median 0.4 s)
-t 1: 1.3 s, 1.3 s, 1.4 s   (median 1.3 s)
-t 2: 3.4 s, 2.5 s, 2.5 s   (median 2.5 s)
-t 3: 3.6 s, 3.6 s, 3.7 s   (median 3.6 s)
-t 6: 6.5 s, 6.4 s, 6.8 s   (median 6.5 s)
-t 10: 10.8 s, 11.5 s, 10.5 s   (median 10.8 s)
```

**Note:** The -t flag of docker stop overrides the wait for this one stop. Every stop also costs a fixed overhead on top of the wait (about 0.4 s here, the time for -t 0 where nothing is waited for). The default behaves like -t 3 on this machine.

## Step 5

**Command**

```sh
docker run --stop-timeout 3 ...   then: docker stop   (3 times)
```

**Output**

```text
3.4 s, 3.4 s, 3.6 s   exit code 137
```

**Note:** --stop-timeout stores the wait in the container, so every stop of it uses it: median 3.4 s. In Compose this is stop_grace_period.

## Step 6

**Command**

```sh
your settings (init: true, stopTimeoutSeconds: 3)   then: docker stop   (3 times)
```

**Output**

```text
0.5 s, 0.6 s, 0.5 s   exit code 143
```

**Note:** Your settings: the stop takes 0.5 s.

## Step 7

**Command**

```sh
docker stop the naive daftar-api image (shell-form CMD)   (3 times)
```

**Output**

```text
3.6 s, 3.5 s, 3.6 s   exit code 137
```

**Note:** Node is behind a shell that does not forward SIGTERM, so it waits the default time and ends with SIGKILL: median 3.6 s.

## Step 8

**Command**

```sh
docker stop the daftar-api image (exec-form CMD, handles SIGTERM)   (3 times)
```

**Output**

```text
0.5 s, 1.2 s, 0.7 s   exit code 0
```

**Note:** Node is PID 1 and handles SIGTERM: it finishes its requests and exits with code 0: median 0.7 s.

## Step 9

**Command**

```sh
docker run -d --restart always alpine:3.23 sh -c "exit 1"   (read RestartCount every 250 ms for 60 s)
```

**Output**

```text
restart count: 10
restarted at (s): 2.2, 3.4, 3.9, 4.9, 6.1, 7.9, 11.5, 18.4, 31.6, 57.8
gaps (s): 2.2, 1.2, 0.5, 1, 1.2, 1.8, 3.6, 6.9, 13.2, 26.2
status at the end: restarting
```

**Note:** A container that crashes at once is restarted again and again, each wait about twice as long as the one before. The service is never up, and nothing ever says "this has failed". 10 restarts in 60 s.

## Step 10

**Command**

```sh
docker run -d --restart on-failure:5 alpine:3.23 sh -c "exit 1"   (your restart policy)
```

**Output**

```text
restart count: 5
restarted at (s): 2.3, 3.7, 4.1, 5.1, 6.6
status at the end: exited (after 14 s)
```

**Note:** Your policy gives up after 5 restarts and leaves the container exited, which a health check or an alert can see.
