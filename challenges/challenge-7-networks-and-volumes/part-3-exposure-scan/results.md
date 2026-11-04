# Results: Challenge 7, part 3: scan what your stack exposes

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Compose 5.6.1, Node 22.22.2. Date: 2026-11-04.

## Step 1

**Command**

```sh
docker ps --filter label=com.docker.compose.project=dkr-c7-p3 --format "table {{.Names}}\t{{.Ports}}"
```

**Output**

```text
NAMES   PORTS
dkr-c7-p3-web-1   127.0.0.1:53602->80/tcp
dkr-c7-p3-api-1   8080/tcp
dkr-c7-p3-db-1   5432/tcp
```

**Note:** 0 of 1 published ports are open on every address (0.0.0.0 or ::). Only a binding to 127.0.0.1 keeps a port to your own computer.

## Step 2

**Command**

```sh
node challenges/challenge-7-networks-and-volumes/part-3-exposure-scan/scan.mjs 53602
```

**Output**

```text
port   127.0.0.1  172.30.224.1    192.168.0.217   
53602  open       timeout         timeout
```

**Note:** No published port answers on your network addresses. Only your own computer can use them.

## Step 3

**Command**

```sh
docker exec dkr-c7-p3-web-1 nc -z -w 2 db 5432
```

**Output**

```text
nc: bad address 'db'
```

**Note:** The web tier cannot even find the database. It sits on another network.

## Step 4

**Command**

```sh
docker exec dkr-c7-p3-api-1 nc -z -w 2 db 5432
```

**Output**

```text
db:5432 -> open
```

**Note:** The api tier reaches the database. It must, that is its job.

## Step 5

**Command**

```sh
node -e "fetch('http://127.0.0.1:53602/')"  (web proxies to api)
```

**Output**

```text
{"app":"daftar-api","version":"1.0.0","hostname":"f03f2f67550a","requests":1}
```

**Note:** The page still loads through web and api. Closing doors did not break the stack.
