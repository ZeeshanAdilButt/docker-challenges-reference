# Daftar platform

A small job platform in three services and a database. You type a sentence on the web page. The API queues it, the worker shouts it back and counts the words, and the page shows the result.

| Service | What it is | Port |
|---|---|---|
| `web` | static page behind nginx; sends `/api/` to the API | 3000 on your machine (8080 inside) |
| `api` | Node 22 or newer, one dependency (`pg`) | 8080 |
| `worker` | Python 3.12, standard library only; asks the API for jobs | none |
| `db` | PostgreSQL 18; reachable only from the other services | none |

## Run it

You need Docker with Compose v2 or newer. Nothing else.

```sh
cp .env.example .env        # then set POSTGRES_PASSWORD
docker compose up --wait    # builds, starts, and returns when every service is healthy
```

Open <http://localhost:3000>. The API answers on <http://localhost:8080> (`/health`, `/ready`, `/jobs`, `/stats`).

Useful commands:

```sh
docker compose watch                          # rebuild a service when its source changes
docker compose --profile tools run --rm psql  # a SQL prompt on the database
docker compose down -v                        # stop and delete the data
```

## Tests

```sh
docker build --target test ./api   # the API unit tests run inside the image build
```

## Production

`compose.prod.yaml` runs the three built images by digest. The pipeline in `.github/workflows/ship.yml` builds, tests, scans, signs and pushes them. `RUNBOOK.md` says what to do when it breaks.
