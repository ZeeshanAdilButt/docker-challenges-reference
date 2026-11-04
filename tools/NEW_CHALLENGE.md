# Start a new challenge from the challenge 0 pattern

For challenge builders. Challenge 0 (`challenges/challenge-0-setup`) is the pattern to copy.

## The command

Run this from `C:\dkc` (replace the number, the challenge name and the part names):

```text
node tools/new_challenge.mjs 3 dockerfile-review "part-1-find-the-pid1-problem" "part-2-fix-the-signals"
```

It creates, for each part, `challenges/challenge-3-dockerfile-review/part-N-name/` with:

| File | What is in it |
|---|---|
| `README.md` | The skeleton: problem, idea, step table, what you should see, where each number comes from, Docker Desktop box, safety link. |
| `run.mjs` | A working script that uses `Recorder`, `safeArgs`, `cleanup`, `setFact` and `barsSvg`. It prints one example step and saves one example fact. |
| `test.mjs` | A `node:test` file that fails until `run.mjs` has been run (the fact is missing), plus the SAFETY link check. |

`results.md` and `chart.svg` are not created by hand. Run the part with `--record` and they are written for you.

Then replace the example step with the real experiment.

## The rules every part follows

1. First lines of the README: the problem (why the learner cares), then the idea, then the step table. Never a command list first.
2. Name everything `dkr-c<N>-...` and label it `dkr.challenge=<N>`. Use `safeArgs(N, 'what')` for every `docker run`. It sets name, label, `--memory`, `--memory-swap`, `--pids-limit`, a sized `--tmpfs`, log limits and `no-new-privileges`.
3. End every `run.mjs` with `cleanup(N)` in a `finally` block. Never use `docker system prune`, `volume prune` or `image prune`. Never remove something you did not create.
4. No `--privileged` and no Docker socket mount, except challenges 13 and 14 (one named Docker-in-Docker host, with the reason printed).
5. Pin every image to a version tag. Say the download size in the README.
6. Save numbers with `setFact('c<N>.p<M>.<what>_<unit>', value)`. Time is measured, never guessed. Use the median of three runs where timing matters (`median` from `toolkit/stats.js`).
7. Record the run: `node challenges/challenge-N-name/part-M-name/run.mjs --record` writes `results.md` (command, output, one-line note per step) and `chart.svg`.
8. Tests read facts and also check live Docker where it makes sense. The first run of a test in a fresh starter must fail with a message that says what to do.
9. Put fixed Dockerfiles and solutions in a `reference/` folder inside the part. `tools/make_starter.mjs` leaves every `reference/` folder out.
10. No em dashes and no en dashes anywhere. Short sentences, plain words.
11. Zero npm dependencies. Node 22 or newer, ESM, `node:test`.

## Check your part

```text
node --test "challenges/challenge-3-dockerfile-review/**/test.mjs"
node toolkit/cleanup.mjs 3
docker ps -a --filter label=dkr.challenge=3
```

The last command must print no containers.

## Make the learner starter

```text
node tools/make_starter.mjs C:\path\to\new-empty-folder
```

It copies the tree without `reference/` folders and without `facts.json` or `.git`. In the new folder, run the challenge 0 tests (they fail), run the two `run.mjs` files, run the tests again (they pass).
