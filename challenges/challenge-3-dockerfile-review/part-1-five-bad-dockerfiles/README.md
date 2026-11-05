# Challenge 3, part 1: review and fix five Dockerfiles

**Time:** about 50 minutes. **Download:** none. The Dockerfiles use `node:24-alpine`, which you pulled in challenge 0 (about 62 MB packed). `docker build --check` asks Docker Hub for image details, not for the image. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A pull request adds a Dockerfile. It builds. The container starts. The reviewer says "looks good" and merges it. Three weeks later the build takes four minutes for a one-line change, a secret turns up in `docker inspect`, and a deploy takes ten seconds longer than it should because nobody can say why.

None of the five faults in this part stops the container from starting. That is why they get through review. Your job is to see them in the file, before they cost anything.

## The idea

A Dockerfile has a few places where one quiet line causes a loud problem later:

| Look for | Why it hurts |
|---|---|
| `FROM node:latest` or no tag | The base moves under you. Yesterday's build and today's differ. Pin a tag that names a version. |
| no `USER` | The app runs as root inside the container. Any bug in it starts with more power than it needs. |
| `COPY . .` before `RUN npm ci` | Docker caches a step only when its inputs did not change. Copying all the code first means every code edit reruns the install. |
| `ENV SECRET=...` or `ARG TOKEN=...` | Both stay in the image config and in `docker history`. Anyone who can pull the image reads them. |
| `ADD` for local files | `ADD` also downloads URLs and unpacks archives. That surprises people. `COPY` only copies. |
| `CMD npm start` (shell form) | The command runs as `/bin/sh -c "npm start"`. A shell, or npm, can end up as PID 1 instead of your program, and then the signals Docker sends go to the wrapper. Some wrappers pass them on and some do not. Part 2 measures which. |
| `COPY . .` with no ignore file | The whole folder goes into the image: env files, notes, tests, `.git`. |

You do not need a linter to know these. This part gives you two anyway, so you can see what each one catches:

- `review.mjs` is a tiny reviewer written for this challenge. Run it on any Dockerfile.
- `docker build --check` is BuildKit's own rule set. It catches some of the faults and misses others. A clean report does not mean a good Dockerfile.

The five Dockerfiles are in `dockerfiles/`. Each has one main fault. `faults/` holds untouched copies; the run uses them for the "before" numbers. Do not edit `faults/`.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/review.mjs challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/dockerfiles/01-unpinned-root/Dockerfile` | The reviewer names the problems it sees. Try all five. |
| 2 | `node --test challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/test.mjs` | Fails on purpose. Each failure says which fault is left and how to think about it. |
| 3 | Edit the five files in `dockerfiles/` | One folder per Dockerfile. In `05-no-ignore` you may add `Dockerfile.dockerignore`. Keep the app working: it must answer `/health`. |
| 4 | `node --test challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/test.mjs` | Repeat until it passes. The test builds each file for real. About 2 minutes. |
| 5 | `node challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/run.mjs` | Before and after for all five: reviewer, `docker build --check`, a real build, and the property test. About 4 minutes. |
| 6 | `node toolkit/show-facts.mjs c3.p1` | Shows the saved facts. |

Rules for your edits: use only `node:24-alpine` as the base (it is on your machine, and the test never downloads another). Do not change `server.mjs` or `package.json`; the build context is a copy of `daftar-api`.

## What you should see

The originals pass `docker build` and answer `/health`. The reviewer finds seven problems in total; BuildKit's check finds fewer:

```text
01-unpinned-root     base-not-pinned, runs-as-root
02-cache-buster      copy-all-before-install, no-dockerignore
03-leaky-env         secret-in-env
04-add-and-shell     add-for-local-files, shell-form
05-no-ignore         no-dockerignore
```

For the cache fault, the proof is a number: after a one-line change in `server.mjs`, the original rebuilds in several seconds because `npm ci` runs again; the fixed one finishes in a fraction of that because `npm ci` is `CACHED`. For the PID fault, the original shows node as a child of a wrapper, with a PID far from 1 (136 in the recorded run); the fixed one shows PID 1.

The full recorded run is in [results.md](results.md).

![Problems found per Dockerfile](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c3.p1.f01_findings_before_count` ... `f05_...` | Findings of `review.mjs` on `faults/<name>/Dockerfile`. |
| `c3.p1.fNN_findings_after_count` | The same on your `dockerfiles/<name>/Dockerfile`. Must be 0. |
| `c3.p1.fNN_check_warnings_before_count`, `..._after_count` | Number of `WARNING:` rules in `docker build --check`. |
| `c3.p1.fNN_original_ok`, `c3.p1.fNN_fixed_ok` | The property test for that fault, on the original and on yours. |
| `c3.p1.findings_before_total`, `c3.p1.findings_after_total` | Sums of the reviewer findings. |
| `c3.p1.check_warnings_before_total`, `c3.p1.check_warnings_after_total` | Sums of the BuildKit warnings. |
| `c3.p1.fixed_ok_count` | How many of your five pass their property test. Must be 5. |
| `c3.p1.rebuild_original_s`, `c3.p1.rebuild_fixed_s` | Time to rebuild after a one-line code change. Median of three builds each. |
| `c3.p1.pid1_original`, `c3.p1.pid1_fixed` | PID of the node process in the `04` container, from `GET /pid`. -1 means the original could not be tested. |

## What is different on Docker Desktop

- `docker build --check` and the cache behaviour are the same on every platform. Build times depend on your disk; Docker Desktop on Windows is slower at copying a build context than Linux, so the first build can take longer.
- `node:latest` is not on your machine, so the original `01` is only reviewed, not built. That is on purpose: the test never downloads a base image.

## Stuck?

- `base image ... is not on this machine`: you used another tag. Use `node:24-alpine`.
- `02` still fails: the `npm ci` step must come before any `COPY` that includes `server.mjs`.
- `03` still fails: check both `ENV` and `ARG`, and any `RUN` that echoes the secret.
- `05` still fails: the ignore file must be named `Dockerfile.dockerignore` and sit next to the Dockerfile. Or copy only `server.mjs`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 3`. Image tags that start with `dkr-c3-` are yours: remove them by full name with `docker image rm`.
