# Challenge 6 facts

Every number a chapter may quote, with its meaning and how it was measured. Values are in `facts.json` (reference repository). Timings are the median of three runs unless a fact says otherwise. The measuring machine: Windows 11, Docker Desktop, Docker Engine 29.9.2, containerd image store, Node 22.22.2, `registry:3`. The registry runs on this machine, published on `127.0.0.1`, with no login.

## Part 1: run a registry

| Fact | Meaning | How it was measured |
|---|---|---|
| `c6.p1.registry_image_unpacked_mb`, `c6.p1.registry_image_packed_mb` | Unpacked size (bytes of all files in the layers) and packed size (layer sizes) of `registry:3` | `docker save`, then every layer is read (challenge 2 `lib/image.mjs`). `docker image inspect` `Size` is not used: on the containerd image store it is neither of the two |
| `c6.p1.bound_host` | Address the registry port is published on | first line of `docker port`. The starter publishes on `0.0.0.0` |
| `c6.p1.push1_s`, `c6.p1.push2_s` | Time of the first and the second `docker push` | wall clock, one run each (not a median) |
| `c6.p1.blobs_after_push1`, `c6.p1.blobs_after_push2` | Blobs (layers, configs, manifests) in the registry storage | files named `data` under `blobs/` in `/var/lib/registry` |
| `c6.p1.storage_kb_after_push1`, `c6.p1.storage_kb_after_push2` | Registry storage on disk | `du -sk /var/lib/registry` |
| `c6.p1.push2_layers_reused` | Layers the second push did not upload because the registry had them | count of `already exists` lines in the push output |
| `c6.p1.pull_s` | Time to pull the first image back from the local registry | wall clock, median of 3, local copy removed before each pull |
| `c6.p1.survives_recreate` | The image is still in the catalog after the registry container is removed and started again with the same flags | `GET /v2/_catalog` |
| `c6.p1.delete_enabled` | `REGISTRY_STORAGE_DELETE_ENABLED=true` is set | `docker inspect` of the container |

## Part 2: call the API

| Fact | Meaning | How it was measured |
|---|---|---|
| `c6.p2.ping_ok`, `catalog_ok`, `tags_ok`, `digest_ok`, `manifest_ok`, `packed_bytes_ok` | The learner's `client.mjs` function returns what the registry holds | compared with the push output and with the SHA-256 of the raw manifest bytes |
| `c6.p2.oracle_matches_push` | The SHA-256 of the manifest bytes equals the digest `docker push` printed | `node:crypto` |
| `c6.p2.image_packed_mb` | Bytes a pull downloads for the sample image (config plus layers) | from the manifest |
| `c6.p2.docker_pull_requests_layers_present` | HTTP requests the registry logged for a `docker pull` on a machine that already holds every blob of the image | registry log lines `response completed` during the pull |
| `c6.p2.pull_requests_total`, `pull_ping_requests`, `pull_manifest_requests`, `pull_blob_requests` | HTTP requests of a pull by a client that holds nothing: ping, manifest, config blob, each layer | a few lines of Node using the learner's `client.manifest`, counted in the registry log. Docker itself cannot be used here: it keeps blobs by digest and would not ask for them |
| `c6.p2.pull_layers`, `c6.p2.pull_downloaded_mb` | Layers in that image, and bytes the fresh pull downloaded (each blob checked against its digest) | from the manifest and the downloads |
| `c6.p2.delete_status` | HTTP status of the `DELETE` sent by `client.deleteTag` (202 is accepted). `registry:3` also answers 202 to a delete by tag, which removes only the tag | `client.deleteTag` |
| `c6.p2.deleted_tag_gone` | The tag is gone from the tag list and its manifest answers 404 | API |
| `c6.p2.storage_kb_before_delete`, `storage_kb_after_delete`, `storage_kb_after_gc` | Registry storage before the delete, after it, and after garbage collection | `du -sk`, and `registry garbage-collect /etc/distribution/config.yml` |

## Part 3: a tag that moves, deploy by digest

| Fact | Meaning | How it was measured |
|---|---|---|
| `c6.p3.tag_moved` | Tag `1.4` pointed to a different digest after a second push | HEAD on the manifest before and after |
| `c6.p3.a_version`, `c6.p3.b_version` | Version string answered by server A and server B | `GET /` |
| `c6.p3.same_code`, `c6.p3.same_image_id` | Both servers, deployed from release 1.4, run the same version and the same image | `GET /` and `docker inspect --format {{.Image}}` |
| `c6.p3.trace_revision_found` | Both containers carry the label `org.opencontainers.image.revision` | `docker inspect` |
| `c6.p3.deploys_by_digest` | The reference built by `imageRef` contains `@sha256:` | read from the function result |
| `c6.p3.rollback_s` | Time from the decision to a healthy server on the previous release | wall clock of a `docker run --pull always` by digest, median of 3 |
| `c6.p3.rollback_to_previous`, `c6.p3.rollback_healthy`, `c6.p3.rollback_version` | After the rollback the server runs the release before the bad one, and `/health` answers 200 | `GET /` and `GET /health` |

## Part 4: push from Actions (GHCR)

| Fact | Meaning | How it was measured |
|---|---|---|
| `c6.p4.tag_cases_total`, `c6.p4.tag_cases_passed` | Builds in the table of cases, and how many get exactly the expected tags | `tags.mjs` against `cases.json` |
| `c6.p4.registry_tags_match` | The tags in the local registry after the release push equal the tags the rules ask for | `GET /v2/<repo>/tags/list` |
| `c6.p4.one_digest` | Every tag of the release points to the same digest | HEAD on each tag |
| `c6.p4.labels_ok` | Revision, version and source labels are in the image config | config blob from the API |
| `c6.p4.latest_stays_on_release` | A later push to `main` did not move `latest` | HEAD on `latest` before and after |
| `c6.p4.workflow_actions`, `workflow_unpinned`, `workflow_write_all`, `workflow_packages_write`, `workflow_push_guarded`, `workflow_uses_github_token`, `workflow_prints_digest`, `workflow_has_metadata` | Static checks on `workflow/release.yml` | read from the file |

Nothing here was pushed to GHCR. The workflow is the learner's own run on GitHub.
