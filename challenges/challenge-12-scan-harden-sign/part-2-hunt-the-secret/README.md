# Challenge 12, part 2: hunt the secret

**Time:** about 45 minutes. **Download:** `node:24-alpine` (about 62 MB packed) and `alpine:3.23` (about 4 MB packed), both already here. The optional scanner step also uses the pinned scanner from part 1 (about 63 MB packed; it needs **no** vulnerability database for secrets). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A token ends up in a container image. Maybe it was in a `.env` file that got copied by `COPY . .`. Maybe it was passed as a build argument. Maybe someone `rm`-ed it in a later step and thought it was gone. The image goes to a registry, and anyone who can pull it can read the token. Rotating the token is the only real fix after the fact, so the aim is never to put it there.

All four secrets in this part are **fake**. Each contains the text `dkrcanary`, so a test can find them. Nothing here is a real credential.

## The idea

An image is a stack of layers plus a configuration file. A secret can hide in three places.

| Where | How it gets there | Seen with |
|---|---|---|
| A file in a layer | `COPY . /app` copies `.env` | `docker run ... ls`, or reading the layer |
| The image configuration | `ENV`, `ARG` and the text of every `RUN` line are recorded in the history | `docker history --no-trunc`, `docker image inspect` |
| A **deleted** file in an earlier layer | `COPY deploy.key` and a later `RUN rm deploy.key` | Only by reading the layers. The running container does not show it. |

The third one is the surprise. A later layer can hide a file, but the earlier layer still holds the bytes. Anyone who pulls the image can unpack that layer. Deleting is not removing.

The safe ways:

- **`.dockerignore`** keeps files out of the build context, so `COPY . .` cannot copy them.
- **A BuildKit secret mount** (`RUN --mount=type=secret,id=...`) shows the secret to one `RUN` as a file under `/run/secrets` and never writes it into a layer.
- **Run-time variables** (`docker run -e API_KEY=...` or an env file) keep a key out of the image entirely.

A scanner helps, but it only knows secrets with a known shape (a PEM private key, a cloud key prefix). It cannot know that `dkrcanary-env-var-...` is a secret. You will see that when you run it.

## What is in `app/`

`app/Dockerfile` leaks four secrets, one for each way above. `app/.env` and `app/deploy.key` are the files that get copied. The build is given the token (as a build argument and as a BuildKit secret) by the script, so you can use either. `app/.dockerignore` is empty.

You edit **`app/Dockerfile`** and **`app/.dockerignore`**. The image must still build, still run as a normal user, and the app must still get its API key at run time.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-12-scan-harden-sign/part-2-hunt-the-secret/test.mjs` | Five tests **fail** on purpose: one for each leak, plus a check that the leaked files are gone. |
| 2 | `node challenges/challenge-12-scan-harden-sign/part-2-hunt-the-secret/run.mjs` | Builds `app/`, prints the history, and looks in every layer and in the configuration for the four fake secrets. |
| 3 | Read the output. Find each leak yourself in `app/Dockerfile`. | `docker history --no-trunc` shows two of them at once. |
| 4 | Fix `app/Dockerfile` and `app/.dockerignore`. | One fix for each leak. |
| 5 | `node challenges/challenge-12-scan-harden-sign/part-2-hunt-the-secret/run.mjs --trivy` | Adds the pinned scanner's secret scan, so you can compare it with the hunt. |
| 6 | `node toolkit/show-facts.mjs c12.p2` | Shows the saved numbers. |
| 7 | `node --test challenges/challenge-12-scan-harden-sign/part-2-hunt-the-secret/test.mjs` | All tests pass. |

How the hunt works (`layers.mjs`, about 100 lines, no packages): it runs `docker save`, reads the tar file, unpacks every layer (they are tar files, often compressed with gzip), and looks for the four strings in all of them and in the JSON configuration. It reports whether a string was in a `layer` or in the `config`.

## What you should see

On the starter, the hunt finds 4 of 4:

```text
FOUND   env_file     layer d858cf109f40
FOUND   build_arg    config 372174561aec
FOUND   env_var      config 372174561aec, layer d858cf109f40
FOUND   deleted_key  layer d858cf109f40
```

`docker history --no-trunc` prints the build argument and the `ENV` line in full. `docker run ... ls /app` shows `.env` but **not** `deploy.key`, and the hunt still finds the key in a layer.

The pinned scanner finds **1 of the 4**: the private key (`private-key (HIGH) in /app/deploy.key`), even though the key was deleted, because it reads the layers too. It does not find the token in the `.env` file, the build argument or the `ENV` variable.

On the reference, the hunt finds 0 of 4, the scanner finds nothing, and the app still reports `api_key_configured: true` because the key is given at run time.

The full recorded run is in [results.md](results.md).

![Secrets still in the image](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c12.p2.starter_secrets_found_count` | How many of the four fake secrets the hunt finds in the starter image (layers and configuration). |
| `c12.p2.starter_found_<vector>` | Whether that one secret was found. Vectors: `env_file`, `build_arg`, `env_var`, `deleted_key`. |
| `c12.p2.starter_layers_count` | Layers found in `docker save` of the starter. |
| `c12.p2.starter_scanner_findings_count` | Findings of the pinned scanner (`--scanners secret`) on the starter image. |
| `c12.p2.fixed_secrets_found_count` | The same hunt on `reference/app`. Must be 0. |
| `c12.p2.fixed_api_key_at_run_time` | `node server.mjs --check` in the fixed image, with `-e API_KEY=...`, reports a key. |
| `c12.p2.starter_build_s`, `fixed_build_s` | Seconds for `docker build`, one run each. |
| `c12.p2.secrets_found_count`, `found_<vector>` | The same hunt on **your** `app/` when you run the script yourself. |

## What is different on Docker Desktop

- `docker save` writes the image in the layout of the image store the daemon uses. With the containerd image store (the default on new installs) it is an OCI layout, and layers may be compressed. The hunt handles both; it reads any file that is a layer or a JSON configuration.
- `docker history` shows `<missing>` for layers that were pulled, not built. That is normal.
- Free disk: the saved image is held in memory by the hunt (about 175 MB for this image). It is not written to your disk, except in the optional scanner step, which writes it to a small labelled volume that cleanup removes.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- The build fails: with `--mount=type=secret` the script supplies `id=npm_token`. Use exactly that id.
- A leak is still found after your fix: the message names the place (`layer` or `config`). A `config` hit is a variable, an argument or a `RUN` line. A `layer` hit is a file.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 12`.

## Next

Part 3 assumes an attacker is already inside your container and takes away what they could use.
