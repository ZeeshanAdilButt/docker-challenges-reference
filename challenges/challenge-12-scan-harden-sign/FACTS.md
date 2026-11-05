# Facts for challenge 12

Every number a chapter may quote. The values are in `facts.json`. All runs: Windows 11, Docker Desktop, Docker Engine 29.9.2, containerd image store, Buildx 0.38.1, scanner Trivy 0.76.1 (digest in `lib.mjs`), cosign 3.1.4, vulnerability database of 2026-11-05. Timings are single runs unless the row says median of three. Scan counts depend on the database date: quote them with `c12.p1.db_updated_at`.

## Part 1: scan an old image

| Fact | Meaning | How it was measured |
|---|---|---|
| `c12.p1.scanner_image_packed_mb` | Download size of the pinned scanner image | Sum of the amd64 layer sizes in its manifest |
| `c12.p1.scanner_image_disk_mb` | Size on disk of that image | `docker image inspect` Size |
| `c12.p1.scanner_digest` | The index digest the scanner is pinned to | `docker buildx imagetools inspect aquasec/trivy:0.76.1` |
| `c12.p1.db_download_mb` | Download size of the vulnerability database | Layer size of `mirror.gcr.io/aquasec/trivy-db:2` |
| `c12.p1.db_disk_mb` | Size of `trivy.db` on disk | `stat` in the cache volume |
| `c12.p1.db_download_s` | Seconds to download and unpack the database the first time | `trivy image --download-db-only`, one run, on the reference connection |
| `c12.p1.db_updated_at` | Date of the database used | `UpdatedAt` in `metadata.json` |
| `c12.p1.old_*`, `year_old_*`, `current_*` | For `nginx:1.18-alpine`, `nginx:1.27-alpine`, `alpine:3.23`: `_total` findings, `_critical`, `_high`, `_fixable` (has a fixed version), `_fix_now` (rule in `triage.mjs`), `_pass` (verdict against `policy.json`), `_end_of_life` (base OS is end of life) | `triage.mjs` (reference) on the saved scan |
| `c12.p1.old_scan_s`, `year_old_scan_s`, `current_scan_s` | Seconds for one scan with the cached database | Median of three runs |

Values on the reference run: old 51 findings (6 critical, 29 high, all fixable, 8 fix-now, end of life); year-old 216 (3 critical, 60 high, 25 fix-now); current 0.

## Part 2: hunt the secret

| Fact | Meaning | How it was measured |
|---|---|---|
| `c12.p2.starter_secrets_found_count` | Fake secrets (of 4) found in the starter image | `layers.mjs`: reads every layer and the configuration of `docker save` |
| `c12.p2.starter_found_env_file`, `_build_arg`, `_env_var`, `_deleted_key` | Whether each one was found | Same |
| `c12.p2.starter_layers_count` | Layers in the starter image | Same |
| `c12.p2.starter_scanner_findings_count` | Findings of the pinned scanner (secret scan) on the starter | `trivy image --input --scanners secret` |
| `c12.p2.fixed_secrets_found_count` | Same hunt on `reference/app` (0) | Same |
| `c12.p2.fixed_api_key_at_run_time` | The fixed image gets its key at run time | `node server.mjs --check` with `-e API_KEY` |
| `c12.p2.starter_build_s`, `fixed_build_s` | Build seconds | One run each |

## Part 3: harden and attack

| Fact | Meaning | How it was measured |
|---|---|---|
| `c12.p3.starter_attacks_succeeded_count` | Attacks (of 6) that worked on the starter settings (6) | `docker exec` attack scripts in `attacks.mjs` |
| `c12.p3.starter_capeff`, `hardened_capeff` | Effective capabilities of the attacker's shell | `CapEff` in `/proc/self/status` |
| `c12.p3.hardened_nonewprivs` | no-new-privileges is on | `NoNewPrivs` in `/proc/self/status` |
| `c12.p3.hardened_attacks_succeeded_count` | Attacks that worked on the reference settings (0) | Same |
| `c12.p3.only_user_attack_ids`, `user_nnp_attack_ids` | Which attacks worked with only a non-root user, and with a non-root user plus no-new-privileges | Same |
| `c12.p3.without_<setting>_attack_ids` and `without_<setting>_attacks_succeeded_count` | The same after removing one setting from the reference. Settings: `user`, `cap_drop`, `read_only`, `no_new_privileges`, `pids_limit` | Same |
| `c12.p3.<prefix>service_ok` | `GET /health` answered 200 in that configuration | HTTP request from the host |

## Part 4: SBOM, signature and gate

| Fact | Meaning | How it was measured |
|---|---|---|
| `c12.p4.cosign_image_packed_mb`, `registry_image_packed_mb`, `sbom_generator_packed_mb` | Download sizes of the three tool images | Sum of amd64 layer sizes |
| `c12.p4.cosign_digest` | The digest cosign is pinned to | `docker buildx imagetools inspect` |
| `c12.p4.workflow_unpinned_starter_count`, `workflow_unpinned_reference_count` | Steps not pinned to a full commit in the starter (6) and the reference (0) workflow | `pins.mjs` |
| `c12.p4.index_manifest_count` | Image manifests in the pushed index (2: image and attestation manifest) | `docker buildx imagetools inspect` |
| `c12.p4.build_push_s` | Seconds to build and push with SBOM and provenance | One run |
| `c12.p4.sbom_format`, `sbom_package_count` | SBOM format and number of packages (SPDX-2.3, 17) | `docker buildx imagetools inspect --format '{{ json .SBOM }}'` |
| `c12.p4.provenance_dependency_count`, `provenance_all_digests` | Inputs in the provenance (2) and whether all have digests | `--format '{{ json .Provenance }}'` |
| `c12.p4.keypair_made`, `sign_ok`, `verify_digest_ok`, `attest_ok` | cosign steps succeeded | Exit codes |
| `c12.p4.verify_after_tag_moved_ok` | Verifying the tag after it moved (false) | `cosign verify` |
| `c12.p4.verify_original_digest_after_move_ok` | Verifying the original digest after the move (true) | `cosign verify` |
| `c12.p4.verify_wrong_key_ok` | Verifying with a different key (false) | `cosign verify` |
| `c12.p4.gate_signed_digest_pass`, `gate_moved_tag_pass`, `gate_moved_tag_reason_count`, `gate_nothing_attached_reason_count` | The gate's verdicts on the three images | `gate.mjs` (reference) |
