# Notes for challenge 3: review and fix five Dockerfiles

Builder notes. Not for learners.

## What each part proves

1. **Five bad Dockerfiles.** Five quiet faults (unpinned base and root, cache-busting `COPY` order, a secret in `ENV`, `ADD` plus shell-form `CMD`, `COPY .` with no ignore file). Each fault is tested by building the learner's file and checking the thing it was about. Proves that BuildKit's own `--check` catches two of five (a secret in ENV, shell-form CMD) and that a rebuild after a one-line change is several times faster with the right `COPY` order.
2. **Signals and PID 1.** Nine ways to start the same service, measured with `docker stop`. The learner fixes an entrypoint script (`exec`). Proves who is PID 1 decides everything, and measures three things the roadmap and dossier assumed.
3. **Multi-stage with a test target.** A `test` stage that runs `node --test` gates the build (a copy of the code with a failing test fails `--target test`), and the last stage ships 30 MB less (a pretend toolchain).
4. **Build and run secrets.** An `ARG` used in a `RUN` leaks into the history and the config, though no layer has it. `RUN --mount=type=secret` leaves no trace. A key given as `-e` is in `docker inspect`; a read-only file mount is not.

## Measured differences from the dossier and the roadmap (trust the measurement)

- **The default `docker stop` wait is not 10 seconds here.** A container whose PID 1 ignores SIGTERM took 3.5 s with no option (median of 3), 3.8 s with `-t 3`, 10.8 s with `-t 10`. The default behaves like `-t 3` plus the command overhead. This agrees with the dossier's own M4 (4.2 s) and the system design chapter (about 3 s), and disagrees with the docs [D26]. Cause not found; not tested on Docker Engine in Linux. Recorded as `c3.p2.default_stop_s` and friends. Chapter writers must say "measure it", not "10 seconds".
- **npm passes SIGTERM on.** `CMD ["npm","start"]` and `CMD npm start` both stopped in about a second with exit 0 and a shutdown line, with npm as PID 1 and node as its child. The dossier (failure mode 7, module 4 teach-with-care) assumed that a `npm start` wrapper swallows the signal. With the npm in `node:24-alpine` it does not. The real trap is a shell that stays PID 1.
- **Shell form is not always a trap.** `CMD node server.mjs` (one command) made node PID 1, because the Alpine shell executes the last command directly. `CMD node server.mjs; echo ...` and an entrypoint script without `exec` keep `sh` as PID 1: exit 137.
- **`--init` does not rescue a shell wrapper.** With `CMD node server.mjs; echo ...` and `--init`, tini signals the shell, the shell dies at once, and the container exits 143 with no shutdown line: node is killed without ever hearing. With `CMD ["node", ...]` and `--init` it works.
- Chapter 4.3's "Send SIGTERM down sh, npm and node and see who receives it" should be rewritten around these results.

## Design decisions

- **Tests build the learner's file for real.** A Dockerfile that is "clean" to a reviewer can still be wrong, so every part's test builds and runs it. No test downloads a base image: an unpinned `FROM node:latest` is reviewed but not built (`node:latest` is not on the machine). Part 1's README says so.
- **`faults/` and `dockerfiles/`.** Part 1 keeps pristine copies of the five originals in `faults/` for the "before" numbers, and the learner edits `dockerfiles/`. The same idea in part 2 (`variants/`), part 3 (`Dockerfile.single`) and part 4 (`Dockerfile.leaky`, `secret-run.original.mjs`).
- **`lib/tar.mjs` and `lib/image.mjs` are copies of challenge 2's.** Part 4 needs to look into saved layers. A copy keeps challenge 3 free of an import from another challenge folder.
- **A reviewer is provided (`review.mjs`).** It is a teaching tool, not a hadolint replacement. It lets the learner see which faults a static reviewer can find.
- **The `package-lock.json` is made on the fly.** `daftar-api` has no dependencies and no lock file, but `npm ci` needs one. The empty lock lets `npm ci` run offline in about 4 s, so the cache fault is visible. `daftar-api` itself was not changed.

## Problems hit

- BuildKit prints a cached step without its output. The first version of part 3 counted tests from the build log and got 0 because the test stage was a cache hit (its parent chain equals the single-stage Dockerfile's). The test stage is now built with `--no-cache-filter test`. The README tells learners to do the same in CI: a cached test step does not run the tests.
- `docker inspect` on an image has no `Config.StopTimeout` key when it is unset: a Go template on it fails. Read `{{json .Config}}` instead.
- The reference part 1 test failed once in a full run (the `05` container did not answer in time) and passed on repeat. The wait for `/health` is now 60 s instead of 30 s. The machine was under load from other builders.
- The base image `node:24-alpine` has `/opt/yarn-v1.22.22`: part 3 checks only for the `toolchain` folder.
- The shell tool in this environment fails on long here-documents with quotes; files were written with a file tool.

## What the Docker Desktop learner will see differently

- `docker stop` costs a second or two more than on Engine in Linux, so rows in part 2 should be compared with each other.
- Secrets mounts (part 4) need a path under a folder that Docker Desktop shares. The script uses a temp folder under the user profile.
- `docker build --check` asks Docker Hub for image metadata (a few seconds each).

## Things not done

- Nothing was run on Docker Engine in Linux or WSL2, so the default stop wait there is unmeasured.
- Part 1 has no check for `.dockerignore` of the original `02` and `05` beyond the property tests; the BuildKit check does not flag them.
- Part 4's runtime secret uses a bind mount of a single file. Compose secrets and Kubernetes secrets are only named in the README, not run.
- The `docker build --check` numbers (three of the five originals get zero warnings) depend on the rule set of the Buildx version in use (0.37.2 here).
