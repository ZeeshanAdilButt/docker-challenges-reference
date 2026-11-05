# Facts of challenge 2

Every fact is saved by `run.mjs` through `toolkit/facts.js` into `facts.json`. Names are `c2.p<part>.<what>_<unit>`. Values come from the reference run on Windows 11, Docker Desktop 29.9.2 (containerd image store), Node 22.22.2, 2026-11-05. "Packed" is the sum of the layer sizes in the manifest (a pull downloads this). "Unpacked" is `docker image inspect` field `Size` (what lands on disk).

Parts 1 to 3 are recorded. Part 4 is written but was not run yet (see NOTES.md); its facts are listed at the end.

## Part 1: read the manifest

| Fact | Meaning | How it was measured |
|---|---|---|
| `c2.p1.layer_count` | Layers of the demo image | Length of `layers` from the learner's `readImage` |
| `c2.p1.history_count`, `c2.p1.history_empty_count` | Dockerfile steps in the config, and how many made no layer | `history` and `emptyLayer` from `readImage` |
| `c2.p1.layers_under_1kb_count` | Layers with a packed size under 1024 bytes | Manifest layer sizes |
| `c2.p1.manifest_bytes`, `c2.p1.config_bytes` | Size of those two blobs | Blob sizes in the saved tar |
| `c2.p1.packed_mb`, `c2.p1.unpacked_mb` | Packed and unpacked size of the demo image | Sum of manifest layer sizes; `docker image inspect` |
| `c2.p1.base_layer_packed_mb` | Packed size of the alpine base layer | Manifest |
| `c2.p1.bad_digests_count`, `c2.p1.bad_diffids_count` | Blobs whose hash does not match their name, layers whose uncompressed hash does not match the diffId, on the good image | `findBadDigests`, `findBadDiffIds`. Must be 0 |
| `c2.p1.tampered_detected_count` | Bad digests found after one bit of layer 0 was flipped | `findBadDigests` on a modified copy. Must be 1 |
| `c2.p1.diffids_match_inspect` | The learner's diffIds equal `RootFS.Layers` | `docker image inspect` |
| `c2.p1.image_id_is_manifest_digest` | `docker image inspect` `Id` equals the manifest digest (true with the containerd image store) | Comparison |
| `c2.p1.leftover_count` | Objects with the label after cleanup | `leftovers(2)` |

## Part 2: the deleted secret

| Fact | Meaning | How it was measured |
|---|---|---|
| `c2.p2.leaky_layer_count` | Layers of the leaky image | Saved tar |
| `c2.p2.secret_layer_index`, `c2.p2.secret_found_layers_count` | Layer that holds the made-up secret, and in how many layers it is found | `findInLayers` |
| `c2.p2.whiteout_layer_index`, `c2.p2.whiteout_count` | Layer with the whiteout for `app/prod.env`, and the number of whiteouts | `whiteouts` |
| `c2.p2.secret_recovered` | `recoverFile` returned a file with the secret | Comparison |
| `c2.p2.deleted_file_visible_in_container` | `cat /app/prod.env` succeeded in a container (must be false) | `docker run` exit code |
| `c2.p2.seed_layer_packed_mb`, `c2.p2.seed_file_bytes`, `c2.p2.seed_deleted_still_shipped_bytes` | The 3 MB deleted file: packed layer size, file size, unpacked bytes still shipped | Saved tar |
| `c2.p2.leaky_packed_mb`, `c2.p2.leaky_unpacked_mb` | Sizes of the leaky image | Manifest sum; `docker image inspect` |
| `c2.p2.fixed_packed_mb`, `c2.p2.fixed_unpacked_mb` | Sizes of the learner's fixed image | Same |
| `c2.p2.fixed_secret_hits_count`, `c2.p2.fixed_whiteout_count` | Secret hits and whiteouts in the fixed image (must be 0) | Same functions on the fixed image |
| `c2.p2.fixed_runs_same` | The fixed image prints the same lines | `docker run` output |
| `c2.p2.leftover_count` | Objects with the label after cleanup | `leftovers(2)` |

## Part 3: a tag that moves

| Fact | Meaning | How it was measured |
|---|---|---|
| `c2.p3.digest_v1`, `c2.p3.digest_v2` | Digest `stable` pointed to before and after the release | Learner's `digestOf` against `registry:3` |
| `c2.p3.tag_moved` | The two differ | Comparison |
| `c2.p3.version_tag_stayed` | `1.0.0` kept its digest | `digestOf` before and after |
| `c2.p3.tags_count` | Tags in the repository after the release | `listTags` |
| `c2.p3.shared_layers_count`, `c2.p3.new_layers_count` | Layers version 2 shares with version 1, and layers that are new | `layersOf` |
| `c2.p3.push2_already_exists_count` | "already exists" lines in the output of the two pushes of version 2 | Output of `docker push` |
| `c2.p3.update_download_bytes`, `c2.p3.full_pull_bytes` | Packed bytes of the new layers, and of all layers of version 2 | `layersOf` sizes |
| `c2.p3.server_a_version`, `c2.p3.server_a_after_restart_version` | Version server A reported, and after `docker restart` | `GET /` inside the container |
| `c2.p3.server_b_version`, `c2.p3.server_c_by_digest_version` | Versions of B (pulled `:stable` after the release) and C (pulled by digest) | Same |
| `c2.p3.same_tag_two_versions` | A (after restart) and B run different versions from the same tag | Comparison |
| `c2.p3.leftover_count` | Objects with the label after cleanup | `leftovers(2)` |

## Part 4: size forensics (written, not yet run)

`c2.p4.fat_layer_count`, `c2.p4.fat_packed_mb`, `c2.p4.fat_unpacked_mb`, `c2.p4.fat_biggest_layer_mb`, `c2.p4.fat_chown_layer_mb`, `c2.p4.fat_wasted_mb`, `c2.p4.fat_wasted_replaced_mb`, `c2.p4.fat_wasted_deleted_mb`, `c2.p4.fat_wasted_percent`, `c2.p4.slim_packed_mb`, `c2.p4.slim_unpacked_mb`, `c2.p4.slim_wasted_mb`, `c2.p4.slim_saved_percent`, `c2.p4.slim_runs_same`, `c2.p4.slim_user_id`, `c2.p4.slim_has_git`, `c2.p4.leftover_count`. Definitions are in the README table of part 4.
