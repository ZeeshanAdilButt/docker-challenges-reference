# Defence: Daftar platform

Write what you would say in a five-minute walkthrough: about 150 words a minute, so 300 to 800 words in all.
Use your own numbers (`node toolkit/show-facts.mjs c14`). Write each number with its unit, for example `245 MB` or `4.1 s`.
Delete the lines in brackets as you write.

## Before and after

(The three images before and after: sizes, how long a build takes with and without the cache, and how long the stack takes to be healthy.)

## The pipeline

(What runs before the push and in what order. The CI run with its cache hit. What is scanned, listed and signed, and what is still to come from challenge 12.)

## The deploy

(Deploy by digest to the local production host. The rollout under load and how many requests failed. The rollback drill and its time.)

## One failure

(Pick one of the three experiments. What you broke, what the chart shows, what the runbook entry says to do.)

## At ten times the team

(What you would change if fifty people worked on this instead of five.)
