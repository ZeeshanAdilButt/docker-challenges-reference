# Results: Challenge 14, part 4: defend it

Recorded run. Machine: win32, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
read DEFENCE.md: the five sections, the words, and the numbers followed by a unit that match facts.json
```

**Output**

```text
sections found: 5 of 5   words: 755 (about 5 minutes at 150 words a minute; the range is 300 to 800)
numbers quoted from your own facts: 12 of 12 that could be quoted
  c14.p1.api_size_mb
  c14.p1.worker_size_mb
  c14.p1.web_size_mb
  c14.p1.api_build_cold_s
  c14.p1.api_edit_rebuild_s
  c14.p1.compose_up_s
  c14.p2.first_deploy_s
  c14.p2.rollout_s
  c14.p2.rollback_s
  c14.p3.kill_recovery_s
  c14.p3.starve_recovery_s
  c14.p3.misconfig_detect_s
```

**Note:** The shape is right and the numbers are yours. A mentor will check that the words are true.

## Step 2

**Command**

```sh
read PROBES.md: three probes and one troubleshooting question, 60 to 200 words each, each on the point
```

**Output**

```text
Probe 1          146 words  ok
Probe 2          140 words  ok
Probe 3          124 words  ok
Troubleshooting  133 words  ok
```

**Note:** Each answer is the right length and names the ideas the question is about. The mentor decides whether it is good.

## Step 3

**Command**

```sh
score the rubric from facts.json:  six areas, one line for each criterion
```

**Output**

```text
pass      9  images          images are small: api, worker and web within their size targets
pass      4  images          every image runs as an unprivileged user
pass      4  images          every base image is pinned by digest
pass      3  images          docker build --check finds nothing in the three Dockerfiles
pass      3  build and cache every build context has a .dockerignore
pass      3  build and cache the api builds in stages and has a test stage
pass      4  build and cache editing the source does not reinstall the packages
pass      6  run and recover each service stops within 3 seconds and exits 0
pass      4  run and recover the stack is healthy in under 60 seconds, every container with a health check
pass      4  run and recover the system works end to end: a job goes through web, api, database and worker
pass      2  run and recover the dev stack has a profile for tools and watch on the api
pass      4  security        no secret in any image (history, environment or files)
... (15 lines left out)
pass      3  security        compose.prod.yaml: no literal secret, health checks, limits and restart on eve
pass      3  security        every image is scanned before the push, with a before and after report
pass      3  security        every image has an SBOM
pass      3  security        every pushed digest is signed
pass      5  run and recover kill: the crashed api comes back within 20 seconds and no job is lost
pass      5  run and recover starve: a memory hog is stopped by its limit, restarted, and the worker keeps 
pass      5  run and recover misconfigure: a wrong database password is caught by the health gate within 30
pass      5  communication   RUNBOOK.md has an entry for kill, starve and misconfigure with symptom, check,
pass      5  evidence        the runbook quotes the numbers your own run measured
pass      5  communication   DEFENCE.md is a five-minute walkthrough with all five sections and between 300
pass      6  evidence        the defence quotes at least six numbers from your own facts
pass      8  communication   PROBES.md answers three probes and one troubleshooting question, each in 60 to
```

**Note:** Score: 149 of 149 points available, 100 %. The pass mark is 80 %.

## Step 4

**Command**

```sh
the score for each area
```

**Output**

```text
images            21 of  21
build and cache   20 of  20
run and recover   43 of  43
security          32 of  32
evidence          11 of  11
communication     22 of  22
```

**Note:** A mentor reads the same six areas in under 45 minutes, then asks one to three follow-up probes.
