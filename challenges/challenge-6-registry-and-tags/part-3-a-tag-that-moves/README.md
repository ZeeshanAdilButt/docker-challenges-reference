# Challenge 6, part 3: a tag that moves, and a deploy by digest

**Time:** about 40 minutes. **Download:** `registry:3` (from part 1) and `node:24-alpine` (62 MB packed, from challenge 4). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Server A runs `daftar-api:1.4`. At lunch someone pushes a hotfix and calls it `1.4` again. In the afternoon you add server B and deploy `daftar-api:1.4`. Now two servers run "the same version" and answer differently. A user says "it works on one page load and not on the next", because the load balancer sends them to A, then to B. Nobody changed the deploy. A tag moved.

## The idea

A **tag** is a name the registry keeps for a manifest. Whoever can push can move it. A **digest** is the SHA-256 of the manifest, so it names exact bytes and cannot move. That gives three habits:

| Habit | Why |
|---|---|
| Deploy by digest: `repo@sha256:...` | Every server that gets the same release record runs the same bytes, whatever the tags do |
| Keep a release record: tag, digest, version, commit | Rollback becomes "deploy the digest of the release before" |
| Put the commit in a label on the image | From a running container, `docker inspect` tells you which commit it is, even after the tag has moved |

A rollback is the cheapest deploy you have: the old image is already in the registry, so it needs no build and no test run. It works only if you kept its digest.

## Your job

Two functions in `deploy.mjs` decide what a server runs. Today `imageRef(release)` returns the tag, and `rollbackTarget(releases)` returns the newest release, which is the bad one. Fix both in this folder (not the file in `reference/`).

`run.mjs` is the story: release 1.4 goes to server A, a hotfix moves the tag, server B is deployed from "release 1.4", release 1.5 is deployed and breaks, and you roll back. "Server A" and "server B" are two containers on your machine that pull from a registry the script starts.

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-6-registry-and-tags/part-3-a-tag-that-moves/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-6-registry-and-tags/part-3-a-tag-that-moves/run.mjs` | Builds and pushes three images, starts two servers, moves the tag, breaks a release and rolls back three times. About 2 minutes. |
| 3 | Look at the line `server A: version ..., server B: version ...`. | With the starter they differ. |
| 4 | Fix `imageRef` so it returns `registry/repo@digest`. Fix `rollbackTarget` so it returns the release before the newest one. | |
| 5 | Run step 2 again. | Both servers answer `1.4.0`. The rollback ends on `1.4.0` and is healthy. |
| 6 | `node toolkit/show-facts.mjs c6.p3` | Shows the saved numbers. |
| 7 | `node --test challenges/challenge-6-registry-and-tags/part-3-a-tag-that-moves/test.mjs` | The test passes. |

## What you should see

With a deploy by tag (starter):

```text
server A: version 1.4.0          revision aaa1111
server B: version 1.4.0-hotfix   revision bbb2222
```

With a deploy by digest (reference): both lines read `1.4.0` and `aaa1111`. In both runs the tag `1.4` moved, and the registry still holds the old digest. The last step shows the rollback times and the version you end on. The full recorded run is in [results.md](results.md).

![Release 1.4 on two servers: do they run the same code?](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c6.p3.tag_moved` | `HEAD /v2/<repo>/manifests/1.4` before and after the hotfix push gives two different `Docker-Content-Digest` values. |
| `c6.p3.a_version`, `c6.p3.b_version` | `GET /` on each server. `daftar-api` returns the `APP_VERSION` set at build time. |
| `c6.p3.same_code`, `c6.p3.same_image_id` | The two versions are equal, and `docker inspect --format {{.Image}}` gives the same image id for both containers. |
| `c6.p3.trace_revision_found` | `docker inspect` shows the label `org.opencontainers.image.revision` on both containers. |
| `c6.p3.rollback_s` | Median of three. From the moment `rollbackTarget` is called until the old release answers `/health`. It includes `docker run --pull always`. |
| `c6.p3.rollback_to_previous`, `c6.p3.rollback_healthy` | After the rollback, `GET /` returns the version of release 1.4 and `/health` answers 200. |

## What is different on Docker Desktop

Nothing changes in the results. Both servers run on the same Docker, so the "second server" is a second container, not a second machine. On two real machines the effect is the same: each machine pulls the tag when it deploys, and the answer depends on the time of the pull.

## Stuck?

- `could not start server-b from <registry>/...`: read the line under it. A mistyped digest gives "not found".
- `the bad release did not break as planned`: the script calls `GET /break` on the new server, and expects `/health` to answer 500. Run it again.
- Left-over objects after a crash: `node toolkit/cleanup.mjs 6`.

## Next

Part 4: [push from GitHub Actions to GHCR](../part-4-push-from-actions/README.md).
