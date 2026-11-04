# docker-challenges

Hands-on challenges for the course **Docker in Practice**, by Zeeshan Adil.

You read a chapter, then you run a small experiment on your own machine. Each experiment prints numbers, saves them, and has a test that checks your work. You see Docker do the thing, not just read about it.

## What you need

- Node.js 22 or newer (24 is best). Get it at nodejs.org.
- Docker: Docker Desktop, or Docker Engine on Linux or WSL2.
- About 2 GB of free disk to start. Each challenge README tells you how much it downloads.
- No npm packages. Nothing to install.

## Start here

1. On GitHub, press **Use this template** to make your own copy of this repository. Clone it.
2. Open a terminal in the folder.
3. Run the first challenge:

```text
node toolkit/check-setup.mjs
```

It prints a short table. No line should say `FAIL`. Then follow [challenge 0](challenges/challenge-0-setup/part-1-check-your-toolkit/README.md).

## Read the safety rules first

[SAFETY.md](SAFETY.md) is short. The most important rule: **never run `docker system prune` here.** Your Docker is shared with your other work. Every challenge names and labels what it creates, and cleans up only those things.

## How the challenges are organised

```text
toolkit/       shared helpers: Docker commands, charts, saved numbers, setup check
daftar-api/    the small web service many challenges use
challenges/
  challenge-N-name/
    part-N-name/
      README.md     the problem, the idea, the steps, what you should see
      run.mjs       the experiment (or a Dockerfile / compose.yaml you edit)
      test.mjs      checks your work
      results.md    what the reference run printed, to compare with yours
      chart.svg     a chart of the reference numbers
facts.json     numbers your scripts measured (created when you run a part)
```

Each part is small: about 30 to 60 minutes.

## Run one part

Every README has a table of exact commands. The pattern is always the same:

```text
node --test challenges/challenge-0-setup/part-1-check-your-toolkit/test.mjs
node challenges/challenge-0-setup/part-1-check-your-toolkit/run.mjs
node --test challenges/challenge-0-setup/part-1-check-your-toolkit/test.mjs
```

1. Run the test first. It fails, and the message tells you what is missing.
2. Run the experiment. It prints each step and saves its numbers in `facts.json`.
3. Run the test again. It passes.

Add `--record` to a `run.mjs` to rewrite that part's `results.md` and `chart.svg` with your own run.

To run every test at once:

```text
npm test
```

Some tests fail until you have done their part. That is normal.

## Useful commands

| Command | What it does |
|---|---|
| `node toolkit/check-setup.mjs` | Checks Node, Docker, memory and disk. |
| `node toolkit/cleanup.mjs <N>` | Removes only what challenge N created (by label). |
| `node toolkit/show-facts.mjs c0.p1` | Shows saved numbers that start with `c0.p1`. |

## If something is stuck

Run `node toolkit/cleanup.mjs <challenge number>`. If Docker itself is stuck, restart it. Your images and volumes stay.
