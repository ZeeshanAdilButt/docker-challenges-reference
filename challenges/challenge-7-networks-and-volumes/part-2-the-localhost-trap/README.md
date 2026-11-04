# Challenge 7, part 2: the localhost trap

**Time:** about 40 minutes. **Download:** two images you may already have: `postgres:18-alpine` (about 120 MB to download) and `node:24-alpine` (about 62 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

The API works on your laptop. You put it in a container, and now it says `ECONNREFUSED 127.0.0.1:5432`. The database is running and you can connect to it from your computer. The connection string has not changed: `localhost`, port 5432. The same address gives a different answer in every place, and that is the whole trap.

## The idea

`localhost` is not a place. It means "this machine", and each container is its own machine as far as the network goes. Every container has its own network stack, so it has its own `localhost`.

- Inside the **api** container, `localhost` is the api container. Nothing listens on 5432 there, so the connection is refused at once.
- Inside the **database** container, `localhost:5432` works, because the database lives there.
- On **your computer**, `localhost` is your computer. A published port (`-p 127.0.0.1:56921:5432`) is a door on your computer that leads into the container. It works from your computer only.
- From the api to the database you use the **name** of the other container on a user-defined network. Docker's DNS turns the name into an IP address (part 1).

A refused connection is a fast answer: someone answered, and said "nobody here". That is different from a timeout, where nobody answered at all (part 1, the other network).

The starter `api.env` has the trap: `DB_HOST=localhost`. You fix it.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-7-networks-and-volumes/part-2-the-localhost-trap/test.mjs` | Some tests **fail** on purpose. |
| 2 | `node challenges/challenge-7-networks-and-volumes/part-2-the-localhost-trap/run.mjs` | Starts Postgres and an api container, then asks "can I open port 5432?" from seven places. The third step shows your `api.env` failing. |
| 3 | Open `api.env`. Change `DB_HOST` to the name the database has on the network. | The database container has the network alias `db`. |
| 4 | `node challenges/challenge-7-networks-and-volumes/part-2-the-localhost-trap/run.mjs --record` | The third step now says `open`. It writes `results.md` and `chart.svg`. |
| 5 | `node toolkit/show-facts.mjs c7.p2` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-7-networks-and-volumes/part-2-the-localhost-trap/test.mjs` | All tests pass. |

The seven places the script asks from:

1. The api, with your `api.env`.
2. The api, with `DB_HOST=localhost` (refused).
3. The api, with `DB_HOST=db` (open).
4. Inside the database container, to its own `localhost` (open).
5. Your computer, to the published port on `127.0.0.1` (open).
6. The api, to `host.docker.internal` and the published port (see the Desktop box).
7. The api, to `127.0.0.1` and the published port number (refused: the door is on your computer, not inside the api).

Each question is asked three times and the median time is kept.

## What you should see

Place 2 prints `ECONNREFUSED`, place 3 prints `open`. Your computer reaches the same database through the published port. The full recorded run is in [results.md](results.md). The database is published on `127.0.0.1` and a random high port, so nothing else on your network can reach it.

![Milliseconds to get an answer from the database port](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c7.p2.api_localhost_result`, `c7.p2.api_localhost_ms` | The api's check with `DB_HOST=localhost`: the error code, and the median connect time in ms. |
| `c7.p2.api_by_name_result`, `c7.p2.api_by_name_ms` | The same check with `DB_HOST=db`. |
| `c7.p2.db_own_localhost_ok` | `nc -z localhost 5432` inside the database container. |
| `c7.p2.host_published_result` | A TCP connect from Node on your computer to `127.0.0.1:<published port>`. |
| `c7.p2.api_host_docker_internal_result` | The api's check with `DB_HOST=host.docker.internal` and the published port. |
| `c7.p2.api_published_port_on_localhost_result` | The api's check with `DB_HOST=127.0.0.1` and the published port number. |
| `c7.p2.published_port` | The random free port the script chose for this run. |
| `c7.p2.api_env_db_host`, `c7.p2.api_env_result` | The `DB_HOST` in your `api.env`, and what the api's check printed with it. |

## What is different on Docker Desktop

- `host.docker.internal` exists by default on Docker Desktop, and the reference run reached a port published on `127.0.0.1` through it. On Linux Engine the name does not exist until you add `--add-host=host.docker.internal:host-gateway`, and a port published only on `127.0.0.1` is usually not reachable through that address. Do not build on it: use a shared network and the container name.
- On Docker Desktop for Windows and macOS, a published port is opened on your computer by Docker Desktop, then forwarded into the virtual machine. On Linux Engine Docker itself opens it (with `iptables` rules). The result for `127.0.0.1` is the same.
- The database listens inside its container on 5432 on every setup. Only the published port number changes.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- Postgres does not become ready within 60 s: the first start on a new install can be slow. Run the script again.
- The check says `ENOTFOUND` or `EAI_AGAIN`: the api and the database are not on the same network. This script puts them on `dkr-c7-p2-app`; if you changed it, change it back.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 7`.

## Next

Part 3 asks the opposite question: who else can reach your database, and how do you close the door?
