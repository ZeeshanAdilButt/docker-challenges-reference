# Defence: Daftar platform

## Before and after

I took over a system of three services and a database that only ran on its author's machine. The api image was 1635 MB and ran as root. The worker was 240 MB, also root. Nothing stopped when Docker asked: the api and the worker took the whole stop limit and were killed with exit 137. The database password was in the history of the api image and in a `.env` file copied into all three.

After my changes the api is 245 MB, the worker 177 MB and the web image 74 MB. All three run as an unprivileged user. They stop in under a second with exit 0. A cold build of the api takes 3.9 s, and after an edit of the source it takes 1.9 s, because the package layer comes before the source and is reused. The whole stack is healthy in 22.5 s, and a job goes through the web page, the api, the database and the worker in about 2 s.

## The pipeline

The pipeline runs in a fixed order: lint with `docker build --check`, build, the unit tests of the api as a Dockerfile stage, scan, SBOM, push, then sign. A failing test stops everything before the push; I proved it with a planted bug in challenge 13. Every action in the workflow is pinned to a full commit, permissions are narrow per job, a pull request never pushes, and the login uses the token GitHub gives the run. The workflow caches layers with `type=gha`, so a run after a small edit reuses the packages.

Scan, SBOM and signing are placeholders in my pipeline today. They are marked as pending, not as passed. They get wired in with the tools from challenge 12, and the rubric will then count them.

## The deploy

The host runs exactly the three digests the pipeline pushed, not tags. The database is a separate fixed file, so a rollout never touches it. A rollout starts a whole new colour of api, worker and web, waits until all three are healthy, moves the proxy, and removes the old colour after a short drain. Under load from six clients, three rollouts took 10.8 s each as a median and not one of 5358 requests failed. The rollback to the previous digests also took 10.8 s, against a target of 120 s, and dropped nothing. A rollback does not undo a schema change, so for any database change I would ship two steps: add first, remove much later.

## One failure

I chose the wrong database password. I started the api with the right host and a wrong password. The process was alive, but `/ready` asks the database a question and got a refusal, so the health check turned the container unhealthy and `docker compose up --wait` failed after 22.9 s. The old copy kept serving the whole time. Without that chain, the deploy would have said success and customers would have found the fault. The runbook entry says: check `docker compose ps` and the api logs, compare the password in `DATABASE_URL` with the one in `.env`, fix it and run `docker compose up -d --wait` again. The other two experiments: a crashed api came back in 1.4 s and lost no job, and a memory hog was stopped at its 256 MB limit and the api was back after 3.6 s, while the worker and the database never restarted.

## At ten times the team

With fifty people I would stop deploying from one script. I would make the pipeline the only way to production and put a required reviewer on the deploy job. I would run two copies of the api so a restart is not an outage, and move from one host to a managed container service once the second team needs its own releases. I would add the real scanner, SBOM and signature checks as a gate that blocks the push, and automate the weekly rebuild of the base images. I would keep the runbook next to the code and make every incident add or fix an entry.
