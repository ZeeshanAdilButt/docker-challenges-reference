# Challenge @@N@@, part @@M@@: @@TITLE@@

**Time:** about 45 minutes. **Download:** TODO image names and packed size. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

TODO. Why does the learner care? Start from a real situation: what broke, what it cost, what they could not see. Two to four short sentences.

## The idea

TODO. The 101 for the idea in plain words. Say what the thing is before you say how to run it. Use a real example from Docker, not a made up story.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/@@CHALLENGE_DIR@@/@@PART_DIR@@/test.mjs` | The test fails on purpose. Read the message. |
| 2 | `node challenges/@@CHALLENGE_DIR@@/@@PART_DIR@@/run.mjs` | TODO what the experiment does. |
| 3 | `node toolkit/show-facts.mjs c@@N@@.p@@M@@` | Shows the saved numbers. |
| 4 | `node --test challenges/@@CHALLENGE_DIR@@/@@PART_DIR@@/test.mjs` | The test passes. |

## What you should see

TODO. Show the key lines of the output. Link the full recorded run: [results.md](results.md).

![TODO chart title](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c@@N@@.p@@M@@.example_s` | Median of three timed runs. |

## What is different on Docker Desktop

TODO. If nothing differs, say so in one line.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs @@N@@`.
