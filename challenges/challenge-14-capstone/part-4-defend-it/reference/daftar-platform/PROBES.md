# Probes

A mentor asks these after the walkthrough. Answers in 60 to 200 words each.

## Probe 1: Why do you deploy by digest and not by tag?

A tag is a label that anyone with push rights can move, and my own pipeline moves it on every build. Between the moment I tested an image and the moment the host pulled it, the tag `latest` can point to something else, so the host would run code I never tested. I measured it in challenge 13: a second build finished first and `latest` named version 3 while I meant to deploy version 2. A digest is the fingerprint of the image content. It cannot move, so the pipeline prints the digest it tested and the deploy asks the host for exactly that. A rollback works the same way: I keep a history of digests and go back to the previous one, even if someone re-pushed the old tag meanwhile. I keep the tag in the file only as a comment for people to read.

## Probe 2: Your rollback is quick. What does it not undo?

It does not undo the database. A rollback is a deploy of older code and older images, and it takes about eleven seconds, but the data and the schema stay as the newer release left them. If release 2 renamed a column in one step, then release 1 asks for a column that no longer exists, the health check is green and every request for data fails. I showed this in challenge 13 with a control. So I change a schema in two steps: expand first, which adds the new column, copies the data and writes both, so the old version still works and I can roll back; and contract much later, when I will never go back past it. Messages already processed by a worker are also not undone, which is why jobs here are safe to do twice.

## Probe 3: How do you know the image that runs in production is the one your CI built?

The pipeline pushes an image and records its digest. The deploy job receives that digest as an output and the production file names the image by it, so the host cannot pull anything else under that name. I checked it on the host: `docker inspect` of the running container and the `RepoDigests` of its image equal the three digests the pipeline pushed. The part I cannot prove yet is who built it. For that I need a signature and provenance on the digest, made by the pipeline with a short-lived identity, and a check at deploy time that refuses an unsigned digest. That is the work of challenge 12, and today my scan, SBOM and signing steps are placeholders, marked pending in the rubric.

## Troubleshooting: The api container restarts every 20 seconds. What do you do, in order?

First I look at what Docker says, not at my guess. `docker compose ps` shows the state and whether it is restarting. Then `docker inspect --format '{{.State.ExitCode}} {{.State.OOMKilled}} {{.RestartCount}}'` on the container: exit 137 with OOMKilled true is a memory limit, exit 1 is a crash in the code, exit 0 means something stopped it. Then `docker compose logs --tail 50 api` for the last lines before it died. If the health check is the cause, the container is killed by orchestration and not by itself, so I read `docker inspect` health log and call `/ready` by hand. Every 20 seconds smells like a health check with ten retries two seconds apart, so I suspect the database first: a wrong password or the database not up. I change one thing at a time.
