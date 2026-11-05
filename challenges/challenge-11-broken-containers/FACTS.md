# Facts for challenge 11

Every number a chapter may quote. The values are in `facts.json`. All runs: Windows 11, Docker Desktop, Docker Engine 29.9.2, cgroup v2, containerd image store, Compose v5. Each service is one observation of a deterministic fault, taken a moment after `docker compose up -d --build` (the script waits up to 15 seconds for a working state or a clear failure). No timing is quoted, so there is no median.

Service names in fact names use underscores: `wrong_entrypoint`, `missing_env`, `volume_permission`, `exit_137`, `port_clash`, `bad_healthcheck`, `dns_typo`, `read_only_root`, `missing_shell`, `wrong_user`. Parts: p1 has the first four, p2 the next three, p3 the last three.

| Fact pattern | Meaning | How it was measured |
|---|---|---|
| `c11.pN.<service>_broken_state` | State of the main container of the starter version (`created`, `exited`, `running`) | `docker inspect` State.Status. For `port_clash` it is the admin container, for `dns_typo` the gateway. |
| `c11.pN.<service>_broken_exit_code` | The container's exit code in the starter version (-1 if none). Values on the reference run: wrong_entrypoint 127 (state created), missing_env 1, volume_permission 1, exit_137 137, port_clash 128 (state created), bad_healthcheck 0 (still running), dns_typo 0 (still running), read_only_root 1, missing_shell 255, wrong_user 1 | `docker inspect` State.ExitCode |
| `c11.pN.<service>_broken_oomkilled` | The kernel's OOM flag. True only for `exit_137` | `docker inspect` State.OOMKilled |
| `c11.pN.<service>_broken_health` | Health status of the starter version: `unhealthy` for `bad_healthcheck`, `none` elsewhere | `docker inspect` State.Health.Status |
| `c11.pN.<service>_cause_rung` | The ladder rung (counting from 1) whose output proves the cause. Rungs 1 to 3 are the same for every service | The `cause: true` marker in `ladder.mjs`, set by the author after reading the recorded output |
| `c11.pN.<service>_fixed_working` | The reference version is running, healthy where a check exists, and every HTTP check answers | `settle()` in `harness.mjs` |
| `c11.pN.broken_count` | Services of the part that are broken in the starter (equals the number of services) | Count in `run.mjs --record` |
| `c11.pN.fixed_count` | Services of the part that work in the reference | Count in `run.mjs --record` |
| `c11.pN.<service>_working`, `c11.pN.working_count` | Written by a run without `--record`: whether your current files work | `settle()` |

The ten symptom texts (exact strings) are in each part's `results.md`.
