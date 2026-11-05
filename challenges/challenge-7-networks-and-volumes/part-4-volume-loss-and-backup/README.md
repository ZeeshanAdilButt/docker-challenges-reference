# Challenge 7, part 4: lose a volume, then get the data back

**Time:** about 45 minutes. **Download:** two images you may already have: `postgres:18-alpine` (about 120 MB to download) and `alpine:3.23` (about 4 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Someone upgrades the database image, or runs `docker compose down -v` to "clean up", and the orders table is empty. The database starts without a single error. It is healthy, and it has no data. Containers are meant to be thrown away. Your data is not.

You will lose a database three ways in a few minutes, and bring it back two ways.

## The idea

A container's own filesystem lives and dies with the container. Anything you want to keep must be stored outside it, in a **mount**:

- A **named volume** is a folder that Docker owns and manages. It outlives the container. It is the right place for database files.
- A **bind mount** maps a folder of your computer into the container. It is right for source code during development, where you want to edit the files yourself.
- A **tmpfs** mount lives in memory and is gone when the container stops. It is right for scratch data and secrets you do not want on disk.

The trap is the **anonymous volume**. The Postgres image says "my data directory is a volume". If your Compose file does not name a volume there, Docker creates one with a random 64 character name. The data does survive a restart. But when the container is removed and created again, the new container gets a new, empty anonymous volume. The old one is still on disk, with your data in it, and nothing points at it. People then "fix" this with `docker volume prune`, which deletes volumes that no container uses, including the one that held their data.

A volume is not a backup. It sits on one disk of one machine. `docker compose down -v` deletes it in one command. A backup is a copy somewhere else, and you only know it works if you have restored it. This part takes two kinds:

- **Logical backup** (`pg_dump`): the database writes out SQL text. Small, readable, works while the database runs, and restores into other Postgres versions.
- **Volume copy** (`tar` of the files): the raw data directory. Big, fast to restore, and only valid if the database is stopped while you copy it, and only for the same Postgres major version.

Should a database be in a container at all? For development and tests, yes, always. In production, it can work on one host with a named volume and tested backups, but you must own backups, upgrades and disk. If nobody on the team will do that, a managed database is the cheaper answer. This part gives you the numbers to argue either way.

The starter `compose.yaml` has the fault: the `db` service has no volume entry. You fix it by naming one.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-7-networks-and-volumes/part-4-volume-loss-and-backup/test.mjs` | The static check **fails**: no named volume. |
| 2 | `node challenges/challenge-7-networks-and-volumes/part-4-volume-loss-and-backup/run.mjs` | Writes 3 rows, recreates the container, and the count is `0`. |
| 3 | Open `compose.yaml`. Add `volumes: ["pgdata:/var/lib/postgresql"]` to `db`, and declare `pgdata` at the top level with the label `dkr.challenge: "7"`. | Two small edits. Compare with `reference/compose.yaml` only if you are stuck. |
| 4 | `node challenges/challenge-7-networks-and-volumes/part-4-volume-loss-and-backup/run.mjs --record` | The count after recreate is `3`. The volume is then deleted on purpose, and both backups bring the rows back. Writes `results.md` and `chart.svg`. |
| 5 | `node toolkit/show-facts.mjs c7.p4` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-7-networks-and-volumes/part-4-volume-loss-and-backup/test.mjs` | All tests pass. |

What step 2 does, in order: start the database, write three rows; remove the container and start it again; take a `pg_dump` and a `tar` copy of the volume (each three times for timing); `docker compose down -v` and start again (empty); restore the dump; restore the volume copy.

Backups are held in memory while the script runs and are never written to your disk. In real life, store them somewhere else.

With the starter file, the volume Docker made for the first container is left over after the recreate. The script tracks the volume names of its own containers and removes exactly those at the end. It never uses `docker volume prune`.

## What you should see

The row count goes 3, 3, 0, 3, 3 with the fixed file: written, after recreate, after the volume is lost, after restoring the dump, after restoring the volume copy. With the starter it goes 3, 0 and stays at 0, because the data was already out of reach before any backup. The full recorded run is in [results.md](results.md).

![Rows in the database after each event](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c7.p4.rows_before`, `c7.p4.rows_after_recreate` | `SELECT count(*) FROM notes` after the insert and after `compose rm -sf db` then `up -d db`. |
| `c7.p4.same_volume_after_recreate` | Whether the container mounted the same volume name before and after the recreate. |
| `c7.p4.volume_is_named` | Whether the data directory is on the volume `dkr-c7-p4_pgdata`. |
| `c7.p4.rows_after_volume_loss` | The count after `compose down -v` and `up -d`. |
| `c7.p4.rows_after_restore_dump`, `c7.p4.rows_after_restore_tar` | The count after each restore. |
| `c7.p4.dump_bytes`, `c7.p4.dump_s` | Size of the `pg_dump` output, and the median of three runs. |
| `c7.p4.tar_mb`, `c7.p4.tar_s` | Size of the `tar` stream of the stopped database's volume, and the median of three runs. |
| `c7.p4.restore_dump_s`, `c7.p4.restore_tar_s` | Median of three restores. The tar restore times the empty-and-unpack step only; starting the database again takes a few more seconds. |

The dump of three rows is tiny because it holds only your data. The volume copy is about 39 MB because it holds everything Postgres keeps: system catalogs, write-ahead log files and empty pages. The gap shrinks as your real data grows.

## What is different on Docker Desktop

- The volume lives inside Docker Desktop's virtual machine, in its disk image. On Linux it is a folder under `/var/lib/docker/volumes/`, and you can look at it as root. On Desktop you cannot browse it from Windows, so a throwaway container (as in step 4) is the way to reach it.
- Speed numbers (`tar_s`, `restore_tar_s`) depend on that virtual disk. Expect different seconds on Linux, and slower on bind mounts from Windows or macOS folders.
- `docker volume rm` and `down -v` behave the same everywhere. Neither asks for confirmation.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- The test says the volume is not declared: `pgdata` must also appear under the top-level `volumes:` key, with the label.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 7`, then `docker compose -p dkr-c7-p4 down -v`.
- With the starter file, a crash can leave one volume with a long random name. Find it with `docker volume ls`, check with `docker volume inspect <name>` that it is yours (its mount belonged to `dkr-c7-p4-db-1`), and remove it by its full name.

## Next

Challenge 8 puts API, database, cache, worker and a migration job in one Compose file.
