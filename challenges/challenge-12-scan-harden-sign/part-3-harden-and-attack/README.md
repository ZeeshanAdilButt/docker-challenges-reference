# Challenge 12, part 3: harden a container and attack it

**Time:** about 45 minutes. **Download:** `alpine:3.23` (about 4 MB packed, already here) plus about 1 MB of packages added when the target image is built. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Someone finds a way to run a command inside your container: a bug in the app, a bad dependency, a stolen token. What can they do next? With Docker's defaults, quite a lot. The container runs as root, keeps a set of powers called capabilities, can write anywhere in its filesystem, can start thousands of processes, and may hold a program that climbs to root. Hardening means taking away everything the service does not need, so that the next step of the attacker fails.

The attacks in this part run **only against the container the script starts for you** (`dkr-c12-target`). Never run them against anything you do not own.

## The idea

Five settings take power away. Each stops a different step.

| Setting | In `docker run` | In Compose | What it removes |
|---|---|---|---|
| Run as a normal user | `--user 10001:10001` | `user: "10001:10001"` | The right to read root's files and change system files |
| Drop capabilities | `--cap-drop ALL` | `cap_drop: [ALL]` | Slices of root's power, for example CHOWN and MKNOD |
| Read-only root | `--read-only` (and `--tmpfs /tmp`) | `read_only: true` | Writing into the image's files |
| No new privileges | `--security-opt no-new-privileges` | `security_opt: [no-new-privileges:true]` | Gaining power by running a setuid program such as `sudo` or `doas` |
| Process limit | `--pids-limit 32` | `pids_limit: 32` | A fork flood |

Two rules to remember. First, these settings **overlap** on purpose. If one is wrong or missing, another may still hold. That is called defence in depth. Second, the Docker socket is a different matter: a container with `/var/run/docker.sock` mounted can ask the daemon to start any container, so it is root on the host. No setting above helps. This challenge never mounts it.

The target image is a little careless on purpose. It has `doas` installed (a setuid program, like `sudo`) with a rule that lets the user `app` run it without a password, and it holds a secret file that only root may read. The service is a tiny web server that answers `GET /health`.

You edit one file, `harden.json`. The starter turns everything off. The script translates it into `docker run` flags, starts the container, checks that `/health` still answers, and runs six attack scripts with `docker exec`.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-12-scan-harden-sign/part-3-harden-and-attack/test.mjs` | Seven tests **fail** on purpose: every attack succeeds on the starter settings. |
| 2 | `node challenges/challenge-12-scan-harden-sign/part-3-harden-and-attack/run.mjs` | Builds the target, starts it with `harden.json`, prints which attacks succeeded and which were blocked. |
| 3 | Edit `harden.json`: `user`, `cap_drop`, `read_only`, `no_new_privileges`, `pids_limit`, `tmpfs` | The comments above say what each does. Use `10001:10001` as the user. |
| 4 | `node challenges/challenge-12-scan-harden-sign/part-3-harden-and-attack/run.mjs --matrix` | After your settings, removes **one setting at a time** and attacks again. It shows which attack each setting stops. |
| 5 | `node toolkit/show-facts.mjs c12.p3` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-12-scan-harden-sign/part-3-harden-and-attack/test.mjs` | All tests pass. |

The six attacks:

| Attack | What the attacker tries |
|---|---|
| `write-rootfs` | Write a new program into `/usr/local/bin` |
| `read-secret` | Read `/root/secret.txt`, which only root may read |
| `setuid-climb` | Run `doas cat /root/secret.txt` to climb to root through a setuid program |
| `chown-file` | Give a file to another user (needs the CHOWN capability) |
| `make-device` | Create a device file (needs the MKNOD capability) |
| `fork-flood` | Start 150 processes at once |

Two things the tests also check: the service must still answer `/health` (hardening that breaks the service is not hardening), and `pids_limit` must be between 1 and 64. If you set a read-only root, give the service a `tmpfs` for `/tmp`, because some programs need a writable temporary folder.

The container always gets 64 MB of memory and at most 200 processes, whatever you write.

## What you should see

On the starter settings every attack works: `CapEff: 00000000a80425fb` (the default capability set of root in a container), and 6 of 6 attacks succeed.

On the reference settings: `uid=10001 CapEff: 0000000000000000 NoNewPrivs=1`, and 0 of 6 succeed. The service still answers.

The in-between results teach the most.

| Settings | Attacks that succeed |
|---|---|
| Starter (root, everything default) | 6 of 6 |
| Only a non-root user added | `setuid-climb`, `fork-flood` (2) |
| Non-root user plus `no_new_privileges` | `fork-flood` (1) |
| Reference | none |
| Reference without the user (root) | `read-secret` (1) |
| Reference without `cap_drop` | none (the other settings still hold) |
| Reference without `read_only` | none |
| Reference without `no_new_privileges` | none (dropped capabilities also stop `doas`) |
| Reference without `pids_limit` | `fork-flood` (1) |

"Non-root" alone is not enough: the attacker climbs back to root through `doas`. The full recorded run is in [results.md](results.md).

![Attacks that succeeded](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c12.p3.starter_attacks_succeeded_count` | Number of the six attacks that worked against the starter `harden.json`. |
| `c12.p3.starter_capeff`, `hardened_capeff` | `CapEff` line of `/proc/self/status`, read inside the container with `docker exec`. |
| `c12.p3.hardened_nonewprivs` | `NoNewPrivs` line of `/proc/self/status`. |
| `c12.p3.hardened_attacks_succeeded_count` | Attacks that worked against the reference settings. Must be 0. |
| `c12.p3.only_user_attack_ids`, `user_nnp_attack_ids` | Attack ids that worked when only a non-root user, or a non-root user plus `no_new_privileges`, was added to the starter. |
| `c12.p3.without_<setting>_attack_ids` | Attack ids that worked when the named setting was removed from the reference. |
| `c12.p3.<prefix>service_ok` | `GET /health` answered 200 with that configuration. |

## What is different on Docker Desktop

- Capabilities, `no-new-privileges`, read-only roots and process limits are enforced by the kernel inside Docker Desktop's Linux virtual machine. The results match Linux.
- The published port is bound to `127.0.0.1:18130`. If something on your computer uses it, stop that program.
- User namespaces and rootless mode (other ways to harden) are not used here. On a Linux server they add one more layer: root inside the container is a normal user outside.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- The service does not answer after hardening: check that `user` is `10001:10001` (the image's `app` user) and that `/tmp` is a `tmpfs` when `read_only` is true.
- `setuid-climb` still works: it is stopped by `no_new_privileges`, or by dropping all capabilities (with a non-root user).
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 12`.

## Next

Part 4 produces the proof of what is inside an image and who built it: an SBOM, provenance and a signature.
