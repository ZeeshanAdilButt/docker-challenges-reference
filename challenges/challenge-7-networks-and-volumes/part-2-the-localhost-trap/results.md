# Results: Challenge 7, part 2: the localhost trap

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-04.

## Step 1

**Command**

```sh
docker run -d --name dkr-c7-p2-db --network dkr-c7-p2-app --network-alias db -p 127.0.0.1:65012:5432 postgres:18-alpine
```

**Output**

```text
pg_isready -h 127.0.0.1: accepting connections
```

**Note:** The database listens on port 5432 inside its container. Docker also publishes it on 127.0.0.1:65012 of your computer.

## Step 2

**Command**

```sh
docker run -d --name dkr-c7-p2-api --network dkr-c7-p2-app --env-file api.env node:24-alpine sleep 600
```

**Output**

```text
api.env: DB_HOST=db DB_PORT=5432
```

**Note:** The api container gets its settings from your api.env. The check below plays the part of the api opening its database connection.

## Step 3

**Command**

```sh
docker exec dkr-c7-p2-api node -e "<connect to DB_HOST:DB_PORT>"
```

**Output**

```text
db:5432 -> open (38 ms)
```

**Note:** Your api.env works: the api reaches the database.

## Step 4

**Command**

```sh
docker exec -e DB_HOST=localhost dkr-c7-p2-api node -e "<connect>"
```

**Output**

```text
localhost:5432 -> ECONNREFUSED (23 ms)
```

**Note:** "localhost" inside a container means that container. Nothing listens on 5432 in the api container, so the connection is refused at once.

## Step 5

**Command**

```sh
docker exec -e DB_HOST=db dkr-c7-p2-api node -e "<connect>"
```

**Output**

```text
db:5432 -> open (21 ms)
```

**Note:** The name "db" is the network alias of the database. Docker's DNS (127.0.0.11) turns it into the IP of the database container.

## Step 6

**Command**

```sh
docker exec dkr-c7-p2-db nc -z -w 2 localhost 5432
```

**Output**

```text
localhost:5432 -> open
```

**Note:** From inside the database container, "localhost" is right: this container is the one that listens.

## Step 7

**Command**

```sh
node -e "<connect to 127.0.0.1:65012>"
```

**Output**

```text
127.0.0.1:65012 -> open (6 ms)
```

**Note:** From your computer, "localhost" is your computer. The published port 127.0.0.1:65012 leads to the database.

## Step 8

**Command**

```sh
docker exec -e DB_HOST=host.docker.internal -e DB_PORT=65012 dkr-c7-p2-api node -e "<connect>"
```

**Output**

```text
host.docker.internal:65012 -> open (27 ms)
```

**Note:** host.docker.internal is the name Docker Desktop gives to your computer. It is a way out of a container to the host, but a detour, and it only exists on some setups.

## Step 9

**Command**

```sh
docker exec -e DB_HOST=127.0.0.1 -e DB_PORT=65012 dkr-c7-p2-api node -e "<connect>"
```

**Output**

```text
127.0.0.1:65012 -> ECONNREFUSED (24 ms)
```

**Note:** A published port is a door on your computer. It does not exist inside the other containers, so using that port number from the api fails too.
