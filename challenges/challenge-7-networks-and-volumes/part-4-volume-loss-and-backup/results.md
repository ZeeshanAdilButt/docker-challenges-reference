# Results: Challenge 7, part 4: lose a volume, then get the data back

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, Compose 5.6.1, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker compose -p dkr-c7-p4 up -d   (then: docker inspect dkr-c7-p4-db-1 --format "{{json .Mounts}}")
```

**Output**

```text
/var/lib/postgresql <- volume dkr-c7-p4_pgdata
```

**Note:** The data directory is on a volume with a name you chose. You can find it, back it up and keep it.

## Step 2

**Command**

```sh
docker compose -p dkr-c7-p4 exec -T db psql -U postgres -tA -c "SELECT count(*) FROM notes"
```

**Output**

```text
3
```

**Note:** Three rows written. This is the data we must not lose.

## Step 3

**Command**

```sh
docker compose -p dkr-c7-p4 rm -sf db && docker compose -p dkr-c7-p4 up -d db   (then count rows)
```

**Output**

```text
rows: 3
same data volume as before: true
```

**Note:** The data survived. The new container mounted the same named volume.

## Step 4

**Command**

```sh
docker compose -p dkr-c7-p4 exec -T db pg_dump -U postgres --clean --if-exists postgres
```

**Output**

```text
DROP SEQUENCE IF EXISTS public.notes_id_seq;
DROP TABLE IF EXISTS public.notes;
CREATE TABLE public.notes (
CREATE SEQUENCE public.notes_id_seq
COPY public.notes (id, body) FROM stdin;
1	first
2	second
3	third
```

**Note:** A logical backup: SQL text, 2209 bytes, 0.35 s (median of 3). It can be read, searched and restored into another Postgres version.

## Step 5

**Command**

```sh
docker stop the database, then: docker run --rm -v <volume>:/data:ro alpine:3.23 tar cf - -C /data .
```

**Output**

```text
41441280 bytes of tar stream
```

**Note:** A file copy of the volume with the database stopped: 39.5 MB, 3.11 s (median of 3). Copying the files of a running database gives a broken copy, so the database was stopped first.

## Step 6

**Command**

```sh
docker compose -p dkr-c7-p4 down -v && docker compose -p dkr-c7-p4 up -d   (then count rows)
```

**Output**

```text
volume dkr-c7-p4_pgdata removed: true
rows: 0
```

**Note:** The -v flag removes the volumes of the project. One flag, and the data is gone. The database starts again, empty and healthy, and nothing complains.

## Step 7

**Command**

```sh
docker compose -p dkr-c7-p4 exec -T db psql -U postgres -q  < dump.sql   (then count rows)
```

**Output**

```text
rows: 3
```

**Note:** Restored from the logical backup in 0.41 s (median of 3). The database was running the whole time.

## Step 8

**Command**

```sh
docker run --rm -i -v <volume>:/data alpine:3.23 sh -c "rm -rf /data/*; tar xf - -C /data"   (then start the database and count rows)
```

**Output**

```text
rows: 3
```

**Note:** Restored from the volume copy in 3.5 s (median of 3), with the database stopped. It brings back everything, including users and settings, but only for the same Postgres major version.
