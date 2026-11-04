# Challenge 0, part 1: check your toolkit

**Time:** about 20 minutes. **Download:** none. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Most failed challenges do not fail because of Docker ideas. They fail for boring reasons. Node is too old. Docker is not running. The disk is almost full, so the first image pull stops halfway. You lose an hour and you think the challenge is broken.

This part finds those problems in two minutes, before they cost you anything. It also gives you the habit that runs through the whole course: every script prints numbers, saves them, and a test checks them.

## The idea

The toolkit is a small set of files in `toolkit/`. They have no npm packages. You will use them in every challenge.

| File | What it does |
|---|---|
| `toolkit/check-setup.mjs` | Checks Node, Docker, memory and free disk. Exits with an error if you must fix something. |
| `toolkit/docker.js` | Runs docker commands, waits for things, and cleans up only what the challenge made. |
| `toolkit/facts.js` | Saves measured numbers in `facts.json`. |
| `toolkit/bars.js` | Draws a bar chart as an SVG file. |

A **fact** is a number the script measured, saved under a name such as `c0.p1.disk_free_gb`. The name says: challenge 0, part 1, what it is, and the unit. Tests read facts, so a test checks what really happened on your machine.

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-0-setup/part-1-check-your-toolkit/test.mjs` | The test **fails** on purpose. It says the facts are missing. Read the message. |
| 2 | `node --version` | Shows your Node version. You need 22 or newer. |
| 3 | `node toolkit/check-setup.mjs` | Prints a table of checks. No line should say `FAIL`. |
| 4 | `node challenges/challenge-0-setup/part-1-check-your-toolkit/run.mjs` | Runs the checks again, times Docker, and saves four facts. |
| 5 | `node toolkit/show-facts.mjs c0.p1` | Shows the facts that were saved. |
| 6 | `node --test challenges/challenge-0-setup/part-1-check-your-toolkit/test.mjs` | The test now **passes**. |

If you add `--record` to step 4, the script also rewrites `results.md` and `chart.svg` in this folder with your own run.

## What you should see

Step 3 prints one line per check. The first word is `ok`, `warn` or `FAIL`:

```text
ok    Node.js                  v22.22.2
ok    Docker engine            engine 29.9.2, client 29.9.2
ok    Docker memory            15.5 GB
...
ok    Free disk (this folder)  7.6 GB

All hard checks passed.
```

- `warn` means the course will work but you may hit a limit later. Read the hint.
- `FAIL` means stop. Fix it first. The hint after the line tells you how.

The full recorded run from the reference machine is in [results.md](results.md). Your numbers will be different. The shape should be the same.

![What your machine gives Docker](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c0.p1.node_major` | The first part of `process.versions.node`. |
| `c0.p1.docker_memory_gb` | `docker info`, field `MemTotal`, divided by 1024 three times. On Docker Desktop this is the memory of its Linux virtual machine. |
| `c0.p1.disk_free_gb` | Free space on the disk that holds this folder, from the operating system. |
| `c0.p1.docker_call_ms` | The median of three timings of `docker version`. It tells you how fast the Docker engine answers. |

## What is different on Docker Desktop

Docker Desktop runs Docker inside a small Linux virtual machine. So "Docker memory" is the memory given to that machine, not all of your computer. You can change it in Docker Desktop, under Settings, then Resources. The "Free disk" line measures your computer's disk, but Docker keeps images in a disk file inside the virtual machine. That file can fill up before your disk does. Part 2 shows how to see Docker's own usage.

## If a check fails

| You see | Do this |
|---|---|
| `FAIL Node.js` | Install Node 24 from nodejs.org, open a new terminal, run the check again. |
| `FAIL Docker engine ... not found` | Install Docker Desktop or Docker Engine. |
| `FAIL Docker engine ... cannot connect` | Start Docker Desktop, wait until it says running, run again. |
| `FAIL Free disk` | Free at least 2 GB. Do not run `docker system prune` to get space. See [SAFETY.md](../../../SAFETY.md). |
| `warn Docker memory` | Raise memory in Docker Desktop settings, or accept slower runs. |

## Next

Part 2: [check Docker and learn the safety rules](../part-2-check-docker-and-safety/README.md).
