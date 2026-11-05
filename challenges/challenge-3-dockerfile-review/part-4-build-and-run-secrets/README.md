# Challenge 3, part 4: build secrets and run secrets

**Time:** about 40 minutes. **Download:** none. It uses `node:24-alpine` from challenge 0. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A build needs a token: a private package registry, a license server, a git host. The quick way is `ARG NPM_TOKEN`, then use it in a `RUN`, then delete the file it wrote. The build works. The image is pushed. Months later a scanner finds the token. It is not in any file. It is in the **history** of the image, in plain text, because Docker records every `RUN` command with the values of the build arguments it used.

Then there is the other half: the running service needs an API key. The quick way is `docker run -e API_KEY=...`. Anyone who can run `docker inspect` on that host reads the key.

Neither of these secrets is a real credential in this challenge. Both are made-up strings that open nothing. The mistakes are real.

## The idea

There are two moments when a secret is needed, and each has its own safe door.

**At build time:** a **build secret**. `docker build --secret id=npm_token,src=./token.txt` and, in the Dockerfile, `RUN --mount=type=secret,id=npm_token ...`. For that one `RUN` step, the secret appears as a file, `/run/secrets/npm_token`. When the step ends, the file is gone. It was never written into a layer, and the build arguments do not carry it, so it is not in the history or the config either.

What does not work:

| Way | Where the secret stays |
|---|---|
| `ENV TOKEN=...` | image config, every container started from it |
| `ARG TOKEN` used in `RUN` | image history and config |
| `COPY token.txt` then `RUN rm` | the layer that copied it (part 2 of challenge 2) |

**At run time:** give the container a **file**, not an environment variable. `docker run --mount type=bind,src=./api_key,dst=/run/secrets/api_key,readonly -e API_KEY_FILE=/run/secrets/api_key ...`. The path goes in the environment; the key itself does not. `docker inspect` shows the path and the read-only mount, not the key. (Compose and Kubernetes have secrets that do the same thing. The principle is the same: the secret is a file that is delivered when the container starts.)

Your task, in two parts:

1. In `Dockerfile`, use the token as a **build secret**. The install step must still be able to read it: it writes the fingerprint of the token (the first 8 characters of its sha256) to `/app/build-proof.txt`, and the test checks it.
2. In `secret-run.mjs`, write `runArgs(secretFile)`: the `docker run` flags that give the API key to the container as a read-only file.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-3-dockerfile-review/part-4-build-and-run-secrets/test.mjs` | Fails on purpose: the token is in the history and the key is in `docker inspect`. About 1 minute. |
| 2 | Edit `Dockerfile` | Replace the `ARG` with `RUN --mount=type=secret,id=npm_token`. The id must be `npm_token`. |
| 3 | Edit `secret-run.mjs` | Return an array of flags. `check-secret.mjs` reads the key from the file named in `API_KEY_FILE`. |
| 4 | `node --test challenges/challenge-3-dockerfile-review/part-4-build-and-run-secrets/test.mjs` | Repeat until it passes. |
| 5 | `node challenges/challenge-3-dockerfile-review/part-4-build-and-run-secrets/run.mjs` | Builds the original and yours, searches history, config and every layer for the token, then starts both with their run flags and reads `docker inspect`. About 1 minute. |
| 6 | `node toolkit/show-facts.mjs c3.p4` | Shows the saved facts. |

The build is always run with the token given both ways, `--build-arg NPM_TOKEN=...` and `--secret id=npm_token,src=<file>`, so either Dockerfile works. The temporary secret files are made in a temp folder and deleted at the end.

## What you should see

```text
                              history   config   layers
original (Dockerfile.leaky)   YES       YES      no
yours (Dockerfile)            no        no       no
```

The `.npmrc` file was deleted in the same `RUN`, so no layer holds the token. But the history and the config do. A scan of layers alone would have said "clean".

Both builds could use the token: `build-proof.txt` holds its fingerprint in both. And at run time:

```text
original (-e API_KEY=...)   source env   key in docker inspect: YES   read-only mount: no
yours (secret-run.mjs)      source file  key in docker inspect: no    read-only mount: YES
```

The full recorded run is in [results.md](results.md).

![Places where the build token can be read](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c3.p4.original_history_has_token`, `c3.p4.mine_history_has_token` | `docker history --no-trunc` contains the token. |
| `c3.p4.original_config_has_token`, `c3.p4.mine_config_has_token` | The image config (from `docker save`) contains the token. |
| `c3.p4.original_layers_have_token`, `c3.p4.mine_layers_have_token` | Any file in any layer contains the token. |
| `c3.p4.where_token_leaks_count` | How many of the three places leak in the original (out of 3). |
| `c3.p4.original_build_proof_ok`, `c3.p4.mine_build_proof_ok` | `build-proof.txt` in the image equals the fingerprint of the token: the build could read it. |
| `c3.p4.original_run_source`, `c3.p4.mine_run_source` | What `check-secret.mjs` reports: `env` or `file`. |
| `c3.p4.original_inspect_has_key`, `c3.p4.mine_inspect_has_key` | `docker inspect` of the running container contains the API key. |
| `c3.p4.mine_flags_have_key` | The key itself is one of your `docker run` flags. Must be `false`. |
| `c3.p4.mine_mount_readonly`, `c3.p4.mine_app_reads_key` | The secret mount is read-only, and the app read the right key from it. |

## What is different on Docker Desktop

- The secret file is on your computer. Docker Desktop shares it with the virtual machine through its file sharing. Use a path under your user folder, as the script does. A path outside the shared folders is refused with "mounts denied".
- Build secrets need BuildKit. It is the default in Docker Desktop and Docker Engine 29.
- A bind mount of a single file keeps the file's permissions. The script makes the test files readable by everyone, because the container user is not you.

## Stuck?

- `--mount=type=secret` is refused: the Dockerfile frontend is too old. Update Docker, or put `# syntax=docker/dockerfile:1` on the first line.
- `build-proof.txt is missing or wrong`: inside the step the secret is a file. Read it with `cat /run/secrets/npm_token`, not as `$NPM_TOKEN`.
- The token is still in the history: search your Dockerfile for `ARG NPM_TOKEN`. Remove it.
- `docker inspect` still shows the key: check for `-e API_KEY=...`. Pass only the path, in `API_KEY_FILE`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 3`. Image tags that start with `dkr-c3-` are yours: remove them by full name with `docker image rm`.
