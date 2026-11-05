# Challenge 8, part 2: a fast dev loop with Compose watch

**Time:** about 45 minutes. **Download:** one image you may already have: `node:24-alpine` (about 62 MB). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

You change one line, and you wait. The image rebuilds, the container is recreated, the server starts, and 6 seconds later you can look at the result. You do this 200 times a day. After a week the team stops using the container for development and runs the app on the laptop again, which brings back "works on my machine".

The loop from saving a file to seeing the change is the number that decides whether people use your Compose setup. You will measure it and make it short.

## The idea

`docker compose watch` (or `up --watch`) watches files on your computer and acts when they change. You choose the action for each path in a `develop.watch` block:

- **`rebuild`**: build a new image and recreate the container. Always correct, slowest. Right for files the image installs at build time, like `package.json`.
- **`sync`**: copy the changed file into the running container. Fast. The running process does not know the file changed, so something inside the container must reload: a tool such as `node --watch-path=src`, nodemon, or your framework's dev server.
- **`sync+restart`**: copy the file, then restart the container. No build, no reload tool needed, a little slower than `sync` with a watcher.

So there is no best action. There is a best action per path: source files `sync`, files that change what is installed `rebuild`.

Watch is for services you build from local code. The image needs `stat`, `mkdir` and `rmdir`; Alpine has them. The bind-mount alternative (mounting your source folder into the container) also gives instant edits, but on Windows and macOS it goes through a file-sharing layer that is slow for large trees, which is why watch is the safer default there.

The starter `compose.yaml` has a watch rule that works but is slow: every source change is a `rebuild`. You fix it, and the script checks three things: how fast your loop is, that a `package.json` change still rebuilds the image, and that `sync` alone does not reload anything.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-8-compose-stack/part-2-the-dev-loop-with-watch/test.mjs` | Tests **fail** on purpose. |
| 2 | `node challenges/challenge-8-compose-stack/part-2-the-dev-loop-with-watch/run.mjs` | Times four ready-made variants (`variants/*.yaml`), then your `compose.yaml`. Takes about five minutes. Your loop is as slow as `rebuild`. |
| 3 | Open `compose.yaml`. Change the `app/src` rule to `sync` with `target: /app/src`. Add a `command` that reloads: `["node", "--watch-path=src", "src/server.mjs"]`. Add a `rebuild` rule for `./app/package.json`. | Three small edits. |
| 4 | `node challenges/challenge-8-compose-stack/part-2-the-dev-loop-with-watch/run.mjs --record` | Your loop is now many times faster. Writes `results.md` and `chart.svg`. |
| 5 | `node toolkit/show-facts.mjs c8.p2` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-8-compose-stack/part-2-the-dev-loop-with-watch/test.mjs` | All tests pass. |

What the script does for each variant and for your file: `docker compose up -d --build`, then `docker compose watch --no-up` in the background, then it writes a new value into `app/src/message.mjs` (`v1`, `v2`, `v3`), starts a timer, and asks `GET /message` every 20 ms until the new value comes back. It waits until the watch output is quiet for 3 s before the next edit. It restores `message.mjs` and `package.json` when it ends, also after a crash.

The ready-made variants are complete Compose files you can read and copy from. The fourth one, `sync-only.yaml`, never shows the change, on purpose: the file arrives in the container and nobody tells the server.

## What you should see

The `rebuild` variant takes many seconds per edit (9 to 20 s across runs on the reference machine, depending on how busy Docker was), `sync+restart` a few seconds (2 to 6 s), and `sync` with a watcher about one second. Your fixed file should match the last. A `package.json` edit still rebuilds the image (the image ID changes). The full recorded run is in [results.md](results.md). Your times will differ, and a slow disk or a busy virtual machine moves them.

![Milliseconds from saving a file to seeing the change](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c8.p2.rebuild_edit_to_reload_ms` | Median of three edits with `action: rebuild` (`variants/rebuild.yaml`): from writing the file until `GET /message` returns the new value. |
| `c8.p2.sync_restart_edit_to_reload_ms` | The same with `action: sync+restart`. |
| `c8.p2.sync_watch_edit_to_reload_ms` | The same with `action: sync` and `node --watch-path=src` in the container. |
| `c8.p2.sync_only_reloaded` | Whether one edit with `action: sync` and no reload tool ever showed up in 6 s. It must be `false`. |
| `c8.p2.your_edit_reloaded`, `c8.p2.your_edit_to_reload_ms` | Whether the edits showed up with your `compose.yaml`, and the median time. |
| `c8.p2.package_json_triggers_rebuild` | After editing `app/package.json`, whether the ID of the image `dkr-c8-dev:1` changed within 15 s. |

The timings include the polling interval (20 ms) and the request itself, about 5 ms. They do not include the time to type or save.

## What is different on Docker Desktop

- On Docker Desktop for Windows or macOS, file events travel from your computer into the virtual machine. `sync` hides most of that cost because it copies one file. A bind mount of the whole source tree would pay it on every file read.
- On Linux Engine, a bind mount is direct and fast, and watch is a choice, not a need. The watch block works unchanged.
- `node --watch` (without `--watch-path`) lost track of the file after the first synced change in the reference run: the second edit was copied but the server did not restart. `node --watch-path=src` watches the folder and kept working across edits. If you use a reload tool with `sync`, test a second edit, not only the first.
- On Windows the script stops the background watch with `taskkill /PID <its own pid> /T`, because a plain kill leaves `docker-compose.exe` running.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- The change never shows up with `sync`: is something in the container reloading? Check `docker compose -p dkr-c8 logs api` for a "Restarting" line.
- `watch` says the service has no `build` section: watch only works for services built from local code.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 8`. If `app/src/message.mjs` does not say `v0`, set it back to `export const MESSAGE = 'v0';`.

## Next

Part 3 runs the whole stack in a CI job: bring it up, wait for health, test, and always clean up.
