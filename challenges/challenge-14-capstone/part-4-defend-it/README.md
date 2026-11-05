# Challenge 14, part 4: defend it

**Time:** about 90 minutes. **Download:** nothing. This part does not need Docker. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Doing the work is half of it. A team lead, an interviewer or a client will ask you to explain it: what you did, what you measured, what you would do differently, and what you would check first when it breaks. People who have only done the work find their words slowly. People who have written the explanation out loud find them at once.

## The idea

The defence has two pieces, and a mentor reads both in under 45 minutes using [the rubric](../rubric.mjs).

1. **A five-minute walkthrough**, written as you would say it (`DEFENCE.md`). Five sections: before and after; the pipeline; the deploy; one failure; at ten times the team. About 150 words a minute, so 300 to 800 words. Every claim has a number from your own run, with its unit.
2. **Answers to three probes and one troubleshooting question** (`PROBES.md`), 60 to 200 words each: why deploy by digest; what a quick rollback does not undo; how you know the image that runs is the one CI built; and the api that restarts every 20 seconds.

The script cannot tell whether your answer is good. It checks what can be checked without opinion: the shape, the length, that the numbers are the ones in your `facts.json`, and that each answer touches the ideas its question is about (for example, probe 2 must mention the database or the schema). The mentor checks the rest, and asks one to three follow-up probes.

You should also record the walkthrough, out loud, once. A written script that you have never said aloud is longer than five minutes.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-14-capstone/part-4-defend-it/test.mjs` | Fails on purpose. This test is the whole rubric. |
| 2 | `node challenges/challenge-14-capstone/part-4-defend-it/run.mjs` | Checks `DEFENCE.md` and `PROBES.md`, then prints the rubric score for the whole capstone. |
| 3 | Write `daftar-platform/DEFENCE.md` and `daftar-platform/PROBES.md` | The templates are there. Delete the lines in brackets. |
| 4 | Run steps 2 and 1 again, until it is green | Parts 1 to 3 must be done: the numbers in your defence come from them. |
| 5 | `node toolkit/show-facts.mjs c14` | Shows every number the capstone saved. Quote them with their units. |

The pass mark is 80 % of the points that can be earned today. The criteria for scan, SBOM and signing (9 points) count once the hooks of challenge 12 run in your pipeline. If a hook file is missing they are **pending**: listed, earning nothing and not counted against you.

## What you should see

On the starter: no walkthrough, no answers, and a score that is mostly "not run". With the fixed files: five sections, about 500 words, at least six of your own numbers, four good answers, and a rubric score above 80 %. The full recorded run is in [results.md](results.md). Your numbers will differ.

![Rubric points earned by area](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c14.p4.defence_sections_count`, `c14.p4.defence_words_count` | Headings `## Before and after`, `## The pipeline`, `## The deploy`, `## One failure`, `## At ten times the team`, and the words of `DEFENCE.md` without headings and without template lines in brackets. |
| `c14.p4.defence_numbers_matched_count`, `c14.p4.defence_numbers_possible_count` | Numbers followed by a unit (`MB`, `s`, `seconds`) in your text that are within a quarter (at least 0.6) of one of twelve facts from parts 1 to 3. |
| `c14.p4.probes_total_count`, `c14.p4.probes_ok_count` | Answers in `PROBES.md` with 60 to 200 words that mention the ideas of their question. |
| `c14.p4.rubric_percent`, `c14.p4.rubric_points_earned`, `c14.p4.rubric_points_available`, `c14.p4.rubric_pending_count` | The sum of the points of the passed criteria, of all criteria that are not pending, and the number that are pending. |

## What is different on Docker Desktop

Nothing. This part reads files and numbers.

## Stuck?

- "N of 5 sections": the heading text must match exactly (`## At ten times the team`).
- "does not mention": read the question again. Probe 1 needs both "digest" and "tag"; probe 4 needs a `docker` command and what you look for (exit code, OOM, health check).
- "not run": the part named in the message has no numbers yet. Run it.

## Next

You are done with the course challenges. Book the mentor review, with your `facts.json` and your recording.
