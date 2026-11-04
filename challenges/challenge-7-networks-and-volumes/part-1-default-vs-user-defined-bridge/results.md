# Results: Challenge 7, part 1: default bridge versus user-defined bridge

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-04.

## Step 1

**Command**

```sh
docker exec dkr-c7-p1-ctl-a grep nameserver /etc/resolv.conf
```

**Output**

```text
nameserver 192.168.65.7
```

**Note:** On the default bridge the container asks an outside DNS server. That server has never heard of your container names.

## Step 2

**Command**

```sh
docker exec dkr-c7-p1-ctl-a getent hosts dkr-c7-p1-ctl-b
```

**Output**

```text
(no answer, exit code 2)
```

**Note:** The name does not resolve. The failed lookup took 4 s (median of 3) because the outside server had to be asked first.

## Step 3

**Command**

```sh
docker exec dkr-c7-p1-ctl-a nc -w 2 172.17.0.3 8000
```

**Output**

```text
hello-from-db
```

**Note:** By IP address it works. But the address changes every time the container is recreated, so nobody should use it.

## Step 4

**Command**

```sh
docker network create dkr-c7-p1-demo
```

**Output**

```text
dkr-c7-p1-demo
```

**Note:** A user-defined bridge. Both containers below join it with --network.

## Step 5

**Command**

```sh
docker exec dkr-c7-p1-ctl-c grep nameserver /etc/resolv.conf
```

**Output**

```text
nameserver 127.0.0.11
```

**Note:** 127.0.0.11 is Docker's own DNS server, inside every container on a user-defined network. It knows every container name on that network.

## Step 6

**Command**

```sh
docker exec dkr-c7-p1-ctl-c getent hosts dkr-c7-p1-ctl-d
```

**Output**

```text
172.23.0.3        dkr-c7-p1-ctl-d  dkr-c7-p1-ctl-d
```

**Note:** The name resolves in 157 ms (median of 3).

## Step 7

**Command**

```sh
docker exec dkr-c7-p1-ctl-c nc -w 2 dkr-c7-p1-ctl-d 8000
```

**Output**

```text
hello-from-db
```

**Note:** Connecting by name works. The name stays the same when the container is recreated.

## Step 8

**Command**

```sh
docker exec dkr-c7-p1-ctl-e nc -w 2 172.23.0.3 8000
```

**Output**

```text
(no output, exit code 1)
```

**Note:** Another network cannot reach it, even by IP. It does not get "refused": the packets are dropped, so the client waits for its whole 2 s timeout (2.2 s).

## Step 9

**Command**

```sh
docker exec dkr-c7-p1-t-api nc -w 2 db 8000
```

**Output**

```text
hello-from-db
```

**Note:** Your topology works: api reaches db by name. ({"networks":["app"],"containers":["api on app","db on app"]})
