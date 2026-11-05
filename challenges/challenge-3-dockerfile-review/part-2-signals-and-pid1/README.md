# Challenge 3, part 2: who gets SIGTERM? Signals and PID 1

**Time:** about 45 minutes. **Download:** none. It uses `node:24-alpine` and `alpine:3.23` from challenge 0. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Every deploy, one service takes a few extra seconds to stop. Every deploy, a few requests that were in flight get an error. Nobody sees it in the logs, because the service never logs anything at shutdown. The service is not slow. It never learned that it was being stopped.

This is the failure that looks like nothing. It is also the one an interviewer asks about: "my container takes 10 seconds to stop, why?"

## The idea

`docker stop` does two things. It sends **SIGTERM** to the container's main process, which is **PID 1** inside the container. If the container is still running after a grace period, it sends **SIGKILL**, which cannot be caught. The exit code is then 137 (128 plus signal 9).

So a well-behaved service needs two things:

1. The process that handles SIGTERM must be the one that receives it, which means it must be PID 1, or PID 1 must pass the signal on.
2. The service must handle SIGTERM: finish requests in flight, then exit 0. `daftar-api` does. It logs `{"event":"shutdown","signal":"SIGTERM"}` when it gets the signal.

Two traps:

- **A wrapper in front.** If a shell, a script or another tool is PID 1 and your program is its child, the signal goes to the wrapper. The Linux kernel treats PID 1 specially: a signal with no handler is **ignored** (for any other process the default action is to die). A plain `sh` has no SIGTERM handler. So the shell shrugs, and node never hears.
- **`exec`.** The shell command `exec node server.mjs` replaces the shell with node, in the same process. The PID stays 1, and now it is node. An entrypoint script that ends with `exec "$@"` or `exec node ...` is the standard fix.

Not every wrapper is a trap, and this part tells you which are. It measures nine ways to start the same service. For each: who is PID 1, how long `docker stop` takes (median of three runs), the exit code, and whether the service logged the shutdown. Windows itself cannot send SIGTERM like this, so everything runs in capped containers.

Your task: `Dockerfile.signals` starts `daftar-api` through `entrypoint.sh`. The script prints a "preparing" line and then starts node, and the stop takes the long way. Fix it. The script must still print its line.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-3-dockerfile-review/part-2-signals-and-pid1/test.mjs` | Fails on purpose: node is not PID 1 and `docker stop` waits. About 30 seconds. |
| 2 | Open `variants/` and read the seven Dockerfiles and two scripts | They are the nine ways the run measures. Guess which will be slow before you run anything. |
| 3 | Edit `entrypoint.sh` (and `Dockerfile.signals` if you want) | One word makes the difference. |
| 4 | `node --test challenges/challenge-3-dockerfile-review/part-2-signals-and-pid1/test.mjs` | Repeat until it passes. |
| 5 | `node challenges/challenge-3-dockerfile-review/part-2-signals-and-pid1/run.mjs` | Measures all nine variants, calibrates the default stop wait, and measures yours. About 4 minutes (the slow variants really wait). |
| 6 | `node toolkit/show-facts.mjs c3.p2` | Shows the saved facts. |

## What you should see

```text
way to start               PID 1 is                                stop   exit  graceful
CMD node ...; echo         /bin/sh -c node server.mjs; echo "     4.4 s   exit 137  killed, no shutdown line
CMD node server.mjs        node server.mjs                        1.1 s   exit 0    shutdown logged
CMD npm start              npm start                              0.6 s   exit 0    shutdown logged
CMD ["npm","start"]        npm start                              1.5 s   exit 0    shutdown logged
entrypoint.sh, no exec     /bin/sh /entrypoint.sh                 3.8 s   exit 137  killed, no shutdown line
entrypoint.sh, with exec   node server.mjs                        0.9 s   exit 0    shutdown logged
CMD ["node", ...]          node server.mjs                        0.5 s   exit 0    shutdown logged
CMD node ...; echo +init   /sbin/docker-init -- docker-entryp     0.5 s   exit 143  killed, no shutdown line
CMD ["node", ...] +init    /sbin/docker-init -- docker-entryp     1.7 s   exit 0    shutdown logged
```

Four findings, all measured, not assumed:

1. **The shell wrapper that stays PID 1 is the slow one.** `CMD node server.mjs; echo ...` and an entrypoint script without `exec` both keep a `sh` as PID 1. `docker stop` waits for the grace period, then kills: exit 137 and no shutdown line.
2. **Shell form is not always a trap.** The one-command `CMD node server.mjs` ran node directly, because the Alpine shell executes the last command of a script without forking. And `npm start` passes SIGTERM to node, in both forms (npm is PID 1 and node is its child). Do not teach "shell form is always broken". Teach "know who is PID 1".
3. **`--init` helps only if the right process is its child.** Docker's `--init` puts a tiny init program (`tini`) at PID 1. It forwards signals to its child and reaps zombies. With a shell in between, `tini` signals the shell, the shell dies at once (it is no longer PID 1, so the default action applies), tini exits 143, and node is killed without a word. With `CMD ["node", ...]` it works.
4. **The default grace period is not 10 seconds here.** The calibration step stops a container that ignores SIGTERM four ways. The documentation says 10 seconds; the measured default behaves like a short wait, close to `-t 3`. Docker Desktop adds a second or two to every `docker stop`. Measure the default on the machine where you deploy.

The full recorded run is in [results.md](results.md).

![Time for docker stop to finish](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c3.p2.<variant>_stop_s` | `docker stop <container>` with no `-t`, timed from the command to its return. Median of three runs. Variants: `shell_cmd`, `shell_plain`, `npm_shell`, `npm_exec`, `entry_noexec`, `entry_exec`, `node_exec`, `init_flag`, `init_node`. |
| `c3.p2.<variant>_exit_code` | `docker inspect`, `.State.ExitCode` after the stop. |
| `c3.p2.<variant>_graceful` | The container log has `"event":"shutdown"` and `"signal":"SIGTERM"`. |
| `c3.p2.<variant>_pid1_text` | `/proc/1/cmdline` inside the container, first 60 characters. |
| `c3.p2.default_stop_s`, `c3.p2.stop_t1_s`, `c3.p2.stop_t3_s`, `c3.p2.stop_t10_s` | `docker stop` on a container whose PID 1 ignores SIGTERM (`sh -c "sleep 1000; echo x"`), without `-t` and with `-t 1`, `-t 3`, `-t 10`. Median of three. |
| `c3.p2.default_stop_closest_t_s` | Which of 1, 3 and 10 the default time is closest to. |
| `c3.p2.mine_stop_s`, `c3.p2.mine_exit_code`, `c3.p2.mine_graceful`, `c3.p2.mine_prepared`, `c3.p2.mine_pid1_is_node` | The same measurements on your `Dockerfile.signals`, and whether the entrypoint still printed its line. |

## What is different on Docker Desktop

- Every `docker stop` costs a second or two more than on Docker Engine in Linux, because the command goes through Desktop's virtual machine. Compare rows of one run, not numbers across machines.
- The signals are sent by the Linux kernel inside the virtual machine. They behave the same as on Engine. Windows and macOS do not send SIGTERM to containers; that is why the experiment runs inside them.
- Engine 29 reports the default stop wait differently from the documentation. The calibration step measures it.

## Stuck?

- `PID 1 is "/bin/sh /entrypoint.sh"`: the script is running node as a child. End it with `exec node server.mjs`.
- The stop is fast but the exit code is 143: something killed the shell and left node alone. Check that node is PID 1.
- The test says the "preparing" line is missing: keep the `echo` before the `exec`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 3`. Image tags that start with `dkr-c3-` are yours: remove them by full name with `docker image rm`.
