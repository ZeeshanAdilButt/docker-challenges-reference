# Challenge 13, part 3: roll back

**Time:** about 45 minutes. **Download:** `docker:29-dind` (about 122 MB packed), `registry:3` (about 21 MB), `nginx:1.27-alpine` (about 21 MB) and `node:24-alpine` (about 63 MB). If you did part 2 you have them all. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Friday, 17:10. Release 2 goes out and customers cannot be read. You decide to roll back. The command you run says `1.0.0`. It starts, the health check is green, and the customer list is still broken. Two things went wrong at once.

First, someone had re-pushed the tag `1.0.0` that afternoon, so "go back to 1.0.0" went to a different image than the one that ran on Thursday. Second, release 2 had renamed a column in the database. The old code asks for the old column name, and that column is gone. The rollback put back the old code, and nobody put back the old schema.

## The idea

**A rollback is a deploy of an older release.** Three rules make it safe.

1. **Roll back by digest.** Keep a history of what you deployed: version, tag and digest. Go back to the digest of the previous entry. A tag can be moved after you recorded it. A digest cannot.
2. **Change a schema in two steps.** Never rename or drop in the same release that stops using the old column.
   - Step 1, **expand**: add the new column, copy the data, write both columns, read the new one. The old column stays. Release 1 can still run against this database.
   - Step 2, **contract**: much later, when release 2 has run for a while and you will not go back past it, drop the old column.
   A rollback in between is safe because the old code still finds what it needs.
3. **Ask the host what is running.** The repository says what should run. The host says what does run. Someone in a hurry starts a container by hand, and the next deploy never mentions it. Compare the digests on the host with the history.

The service here is `ledger`: a customer list in a SQLite file on a volume. It has three releases: `1.0.0` (a `name` column), `2.0.0` (the expand release: adds `full_name`, writes both) and `2.0.1` (the rename release: renames `name` to `full_name`).

This part uses the same single privileged Docker-in-Docker host as part 2 (`dkr-c13-prod`, started with `--privileged` because a Docker engine inside a container needs it; capped, labelled, TLS on `127.0.0.1`, removed at the end; no Docker socket of your machine). Read the box in [part 2](../part-2-deploy-by-digest/README.md) for the reasons.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-13-ship-it/part-3-roll-back/test.mjs` | Fails on purpose. Read each message. |
| 2 | `node challenges/challenge-13-ship-it/part-3-roll-back/run.mjs` | Runs the story twice on the host: a control and yours. About 4 minutes. |
| 3 | Edit `rollback.mjs`: `rollbackTarget(history)` | Return `{ digest }` of the previous release. The starter returns a tag. |
| 4 | Edit `release-plan.json` | `"secondRelease"` is `"rename"` (one step) or `"expand"` (two steps). |
| 5 | Run steps 2 and 1 again | The test goes green when the host runs release 1's digest and the data is readable. |
| 6 | `node toolkit/show-facts.mjs c13.p3` | Shows the saved numbers. |

What step 2 does, in order:

1. Starts the registry and the host. Builds and pushes the three releases of `ledger`.
2. **Control:** deploys 1.0.0, adds three customers, deploys the rename release 2.0.1, adds one more, re-pushes the tag `1.0.0` with another image, and rolls back by digest. The code is right and the data is out of reach.
3. **Yours:** the same story with your `release-plan.json` and your `rollbackTarget()`.
4. Repeats deploy and rollback until it has three rollback times.
5. Starts a container by hand on the host and runs the drift check.

## What you should see

On the starter, the rollback by tag lands on the moved image, and the customer list answers 500. With the fixed files, the host runs the digest of release 1, the list answers 200 with every customer, and a new customer can be added. The full recorded run is in [results.md](results.md). Your times will differ.

![Rollback time and what it brings back](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c13.p3.plan_second_release` | `release-plan.json`. |
| `c13.p3.tag_moved` | The registry's digest for `1.0.0` after the re-push differs from the digest deployed first. |
| `c13.p3.rollback_by` | Whether your `rollbackTarget()` returned a `digest` or a `tag`. |
| `c13.p3.rollback_digest_matches` | The `RepoDigests` of the image behind the running container include the digest of release 1. |
| `c13.p3.rollback_version` | The `version` field of `GET /` on the running service. |
| `c13.p3.data_readable_after_rollback`, `c13.p3.data_count_before_rollback`, `c13.p3.data_count_after_rollback`, `c13.p3.write_after_rollback` | `GET /customers` and `POST /customers` through the proxy after the rollback. |
| `c13.p3.control_data_readable`, `c13.p3.control_digest_matches`, `c13.p3.control_rollback_s` | The same checks for the control story (the rename release, rolled back by digest). |
| `c13.p3.rollback_s` | Median of three rollbacks: from `compose up` of the old digest until the new colour is serving and the other is gone. |
| `c13.p3.drift_found_count`, `c13.p3.drift_expected_count` | Containers on the host with no compose project or a digest that is not the one in the history. Expected: the one started by hand. |

## What is different on Docker Desktop

- The host is a Docker engine inside a container inside Docker Desktop's virtual machine. Everything here behaves the same as on Linux. Startup is a few seconds slower.
- The database volume lives inside the host's `tmpfs` disk, so it disappears with the host at teardown. That is on purpose.
- Never use `docker system prune` to clean up. `node toolkit/cleanup.mjs 13` removes only what this challenge made.

## Stuck?

- `Docker is not ready`: start Docker Desktop and wait until it says running.
- The control says the data was readable: run again. Check that `ledger/v2-rename.mjs` still renames the column.
- `docker context ls` still lists `dkr-c13-prod` after a crash: `docker context rm -f dkr-c13-prod`, then `node toolkit/cleanup.mjs 13`.

## Next

Part 4 breaks the host three ways and checks that your files survive.
