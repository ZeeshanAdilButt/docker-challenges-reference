# Challenge 3, part 3: multi-stage builds with a test target

**Time:** about 45 minutes. **Download:** none. It uses `node:24-alpine` from challenge 0. **Disk:** each build makes an image of about 70 to 100 MB on disk (a 30 MB pretend toolchain is part of it) and removes it again. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Two questions come up in every team that ships containers.

1. "Did anyone run the tests before this image went out?" The tests run in CI, in a different job, on a different machine. The image that was tested is not the image that was pushed.
2. "Why does the production image contain the compiler, the test files and the build cache?" Because the Dockerfile has one stage, and everything the build needed is still there when it ends.

Both have the same fix: stages.

## The idea

A Dockerfile can have several `FROM` lines. Each starts a new **stage**, with its own file system. A stage can copy files from an earlier stage with `COPY --from=<name>`. Only the **last stage** becomes the image, unless you ask for another with `--target`.

- **Name your stages:** `FROM node:24-alpine AS test`.
- **A test stage runs the tests as a build step.** `RUN node --test test.mjs` returns a non-zero exit code when a test fails, and a failed step fails the build. `docker build --target test .` is then a test command: it stops where the tests stop, and builds nothing after them.
- **The last stage is the runtime.** It starts from the base again (or from a shared first stage), copies in only what the service needs to run, and sets the user and the command. The toolchain and the test files stay behind in the other stages. They never reach the image you ship.
- **A cached test step does not run.** If nothing that the test stage depends on changed, BuildKit reuses the step (`CACHED`) and the tests do not run again. That is right for speed and wrong for a CI gate that must prove the tests pass for this commit. The run and the test build the test stage with `--no-cache-filter test`, which ignores the cache for that one stage. Do the same in CI.
- BuildKit builds only the stages the target needs. Building `runtime` does not build `test`, unless `runtime` copies something from it. So in CI the order is: `docker build --target test .` first, then the plain build.

This part uses a pretend toolchain: a 30 MB file `/opt/toolchain/compiler.bin` that the build checks for and the service never reads. It stands for a compiler or a build cache.

Your task: `Dockerfile` is a copy of `Dockerfile.single`. Split it into stages: a stage named `test` that has the toolchain and the tests and runs them, and a last stage that ships only the service.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-3-dockerfile-review/part-3-multi-stage-with-a-test-target/test.mjs` | Fails on purpose: there is no stage named `test`. About 40 seconds. |
| 2 | Edit `Dockerfile` | Read the comment at its top. A shared first stage (for example `base`, which installs the dependencies) keeps the other stages short. |
| 3 | `node --test challenges/challenge-3-dockerfile-review/part-3-multi-stage-with-a-test-target/test.mjs` | Repeat until it passes. |
| 4 | `node challenges/challenge-3-dockerfile-review/part-3-multi-stage-with-a-test-target/run.mjs` | Builds the single-stage image and yours three ways, and looks inside. About 1 minute. |
| 5 | `node toolkit/show-facts.mjs c3.p3` | Shows the saved facts. |

What the run does, in order:

1. Builds `Dockerfile.single` (the "before") and looks inside: tests and toolchain are in the image.
2. Builds your `--target test` and counts the tests that `node --test` ran.
3. Builds your `--target test` on a copy of the code with **one failing test**. The build must fail.
4. Builds your default target (the runtime), looks inside, and checks that it answers `/health`.

## What you should see

```text
single stage: /app has test.mjs, /opt has toolchain          (about 100 MB root file system)
--target test:  builds, node --test ran 13 tests
failing test:   exit code 1, "forced failure" in the output
runtime:        /app has server.mjs and the package files only, /opt has only yarn (from the base image), user id 1000
```

The runtime image is about 30 MB smaller, and a failing test fails the build. The exact numbers are in [results.md](results.md).

![Root file system of the image that ships](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c3.p3.stage_count`, `c3.p3.has_test_stage` | Your `Dockerfile`, parsed: the number of `FROM` lines, and whether one is `AS test`. |
| `c3.p3.single_root_mb`, `c3.p3.runtime_root_mb`, `c3.p3.saved_mb` | `du -sx /` inside each image. This counts the files of the root file system, so it does not depend on the image store. |
| `c3.p3.single_has_tests`, `c3.p3.single_has_toolchain` | `ls /app` and `ls /opt` in the single-stage image. |
| `c3.p3.runtime_has_tests`, `c3.p3.runtime_has_toolchain` | The same in your runtime image. Both must be `false`. |
| `c3.p3.runtime_user_id`, `c3.p3.runtime_healthy` | `id -u` in the runtime image, and whether it answered `/health`. |
| `c3.p3.test_target_builds`, `c3.p3.test_target_tests_run_count`, `c3.p3.test_target_build_s` | The `--target test` build: did it pass, how many tests `node --test` reported, how long it took. |
| `c3.p3.failing_test_blocks_build` | The build with the failing test exited non-zero and printed `forced failure`. |

## What is different on Docker Desktop

- BuildKit is on by default in Docker Desktop and Docker Engine 29. On an old Engine without BuildKit, `--target` still works but unused stages are built too.
- Build time depends on your disk: the 30 MB toolchain is copied into the build context first.

## Stuck?

- `target stage "test" could not be found`: name a stage with `FROM ... AS test`.
- `COPY --from=base` fails: the earlier stage needs `AS base`.
- Your runtime still has `test.mjs`: copy it in the `test` stage only.
- The failing-test build passes: the test stage must `RUN node --test test.mjs`. `COPY`ing the file is not running it.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 3`. Image tags that start with `dkr-c3-` are yours: remove them by full name with `docker image rm`.
