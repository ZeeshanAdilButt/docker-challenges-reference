# Results: Challenge 13, part 3: roll back

Recorded run. Machine: win32, Docker Desktop, Docker Engine 29.9.2, production host engine 29.9.3, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
release 2 renames the column name to full_name in one step (2.0.1), then:  roll back to release 1 by digest
```

**Output**

```text
rolled back by digest; the tag 1.0.0 had been moved after release 1 was deployed: true
rollback took 8 s
running now: version 1.0.0, the digest of release 1
GET /customers: 500 (no such column: name)
POST /customers: 500 (table customers has no column named name)
```

**Note:** The rollback put back the right code, and the right code cannot read the database any more: it asks for a column that no longer exists. The host is "healthy" and the data is out of reach. A rollback does not undo a schema change.

## Step 2

**Command**

```sh
release-plan.json: {"secondRelease":"expand"}   and   rollbackTarget(history) from rollback.mjs
```

**Output**

```text
rolled back by digest; the tag 1.0.0 had been moved after release 1 was deployed: true
rollback took 7.5 s
running now: version 1.0.0, the digest of release 1
GET /customers: 200 with 4 customers (there were 4 before the rollback)
POST /customers: 201
```

**Note:** Back on release 1, by digest, with every customer still readable and new ones accepted. The tag had been moved, and the rollback did not care. Release 2 only ADDED a column, so release 1 still understood the database.

## Step 3

**Command**

```sh
repeat: deploy release 2, roll back (3 rollbacks in all, time each)
```

**Output**

```text
rollback times: 7.5 s, 7.6 s, 7.4 s
median: 7.5 s   (target: under 120 s)
```

**Note:** A rollback is a deploy of an older digest that the host already has, so it takes about as long as a normal deploy. The registry is not needed: the image is already on the host.

## Step 4

**Command**

```sh
docker --context dkr-c13-prod run -d --name hotfix-by-hand ...   (a person on the host, in a hurry)
drift check: every container vs the digest the history says should run
```

**Output**

```text
expected digest: d24eff6adc69
hotfix-by-hand         project (none)         a90f287a221c  DRIFT
daftar-blue-api-1      project daftar-blue    d24eff6adc69  as expected
```

**Note:** The container nobody deployed through the pipeline is found: it has no compose project and a different digest. "What is actually running" is a question you answer with the host, not with the repository.
