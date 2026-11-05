# Challenge 10, part 3: audit the host

**Time:** about 40 minutes. **Download:** `alpine:3.23` only (about 4 MB packed, already here from part 2). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Parts 1 and 2 showed what happens when limits are missing. On a real host you do not find that out from an experiment. You find it out at 3 am. A host often runs dozens of containers started by many people over many months. Nobody remembers which ones have a memory limit, which ones have a log that never rotates, and which ones restart forever. You need a tool that answers those questions in seconds.

## The idea

Everything you need is already in `docker inspect`. It prints a JSON document for each container. The fields that matter for host safety are few.

| Question | Field in the JSON | What the value means |
|---|---|---|
| Is memory limited? | `HostConfig.Memory` | `0` means no limit. |
| Are processes limited? | `HostConfig.PidsLimit` | `null`, `0` or `-1` mean no limit. |
| Does the log rotate? | `HostConfig.LogConfig` | `Type` is `json-file` and `Config` has no `max-size`: it never rotates. |
| Does it restart forever? | `HostConfig.RestartPolicy` | `always` restarts forever and hides crashes. |
| Who is the process? | `Config.User` | Empty or `0` means root. |
| Can it do anything? | `HostConfig.Privileged`, and `Binds` with `docker.sock` | Both are critical. |

An audit is only a function: one `inspect` object goes in and a list of findings comes out. You write that function. The rest (reading files, standard input, live mode, the table and the exit code) is already in `audit.mjs`.

Sizes are the second small job. `docker ps -s` prints sizes like `4.1kB (virtual 9.11MB)`. Docker uses decimal units, so 1 kB is 1000 bytes, not 1024. `parseSize` turns that text into a number.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-10-fill-the-box/part-3-audit-the-host/test.mjs` | Most tests **fail** on purpose: `audit.mjs` has two empty functions. |
| 2 | Open `audit.mjs`. Read the table of rules in the comment above `auditContainer`. | Ten rules, each with an id, a severity and a condition. |
| 3 | Write `parseSize` and `auditContainer` | Start with `no-memory-limit`. Add one rule at a time. |
| 4 | `node challenges/challenge-10-fill-the-box/part-3-audit-the-host/run.mjs` | Creates four containers (created, never started), audits them, and compares your findings with the expected ones. |
| 5 | `node challenges/challenge-10-fill-the-box/part-3-audit-the-host/audit.mjs challenges/challenge-10-fill-the-box/part-3-audit-the-host/fixtures/inspect.json` | Your audit on the saved inspect file. |
| 6 | `node toolkit/show-facts.mjs c10.p3` | Shows the saved numbers. |
| 7 | `node --test challenges/challenge-10-fill-the-box/part-3-audit-the-host/test.mjs` | All tests pass. |

The four containers: `good` has every limit, a non-root user, a read-only root and a health check. `nolimits` has nothing set. `unrotated` has a `json-file` log with no `max-size`. `restart-always` restarts forever. They are made with `docker create`, so no process ever runs without a cap.

Your audit must find the right findings on each, and must say nothing about `good`. It must also treat `-1` and `null` as "no limit", and must not call a `local` or `none` log driver "unrotated json-file".

Then try the tool on your own Docker: `node audit.mjs --live`. It only reads. In the reference run, most containers on a busy laptop had no memory limit and an unrotated log. That is normal, and exactly the problem.

## What you should see

```text
HIGH    no-memory-limit  dkr-c10-aud-nolimits        no --memory: one leak can take the whole host
HIGH    log-not-rotated  dkr-c10-aud-unrotated       json-file log without max-size: the log grows until the disk is full
MEDIUM  restart-always   dkr-c10-aud-restart-always  restart always hides crashes and restarts forever
```

and `4 containers: 0 critical, 2 high, 3 medium, 5 low` with exit code 1. The full recorded run is in [results.md](results.md).

![Findings by severity on the four containers](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c10.p3.ps_size_text`, `ps_size_parsed_bytes` | `docker ps -a -s --format '{{.Size}}'` for the `good` container, and your `parseSize` on that text. |
| `c10.p3.audit_exit_code` | Exit code of `node audit.mjs -` on the four inspect objects. 1 means a critical or high finding. |
| `c10.p3.containers_audited_count` | Containers your audit looked at. |
| `c10.p3.containers_correct_count` | Containers where your findings match the expected ones. Must be 4. |
| `c10.p3.findings_critical_count`, `high`, `medium`, `low` | Findings per severity over the four containers. |
| `c10.p3.live_exit_code` | Exit code of `node audit.mjs --live --label dkr.challenge=10`. |

## What is different on Docker Desktop

- `docker inspect` prints the same JSON on Docker Desktop and on Linux. The audit works on both.
- The daemon default for the log driver differs between installs. The reference machine reported `local`, which rotates by default. Others report `json-file`, which does not. That is why the audit looks at each container's own `LogConfig`, and why `local` is not flagged.
- Containers created by Docker Desktop's own features may show up in `--live`. Their settings are not yours to change.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- `parseSize` gives `NaN` for `4.1kB`: your pattern has to allow a decimal point and a lower case `k`.
- `good` has findings: read the finding ids in the test failure. A rule is firing when it should not, often because `Config.Healthcheck` or `Config.User` is read the wrong way.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 10`.

## Next

Challenge 10 is done. Module 12 starts with a container that will not start, and a method for finding out why.
