# Challenge 6 notes (maintainers)

## What each part proves

1. **Run a registry.** `registry:3` is one container that answers HTTP on `/v2/`. Pushing a second image that shares a base layer uploads only the new layer, config and manifest (4 blobs after the first push, 7 after the second, one layer reused). Three first-registry mistakes are planted and measured: published on every interface (no password), no volume (the catalog is empty after the container is recreated), deletes not enabled.
2. **Call the API.** `GET /v2/`, `_catalog`, `tags/list`, `HEAD` and `GET` on manifests, `DELETE` on a manifest. A digest is the SHA-256 of the manifest bytes (checked with `node:crypto`). A pull on a machine that already holds the blobs is one `HEAD`. A pull by a machine that holds nothing is 1 ping, 1 manifest and one blob request per config and layer. A delete frees nothing until garbage collection runs; after the delete and `registry garbage-collect`, 5048 KB remain from 7044 KB.
3. **A tag that moves.** A hotfix pushed under `1.4` moves the tag; a server deployed from "release 1.4" by tag runs `1.4.0-hotfix` while server A runs `1.4.0`. Deployed by digest, both run `1.4.0`. A rollback by digest to the release before takes about 2 seconds here and needs no build.
4. **Push from Actions.** `tags.mjs` implements five tag rules and is checked against `cases.json`. The workflow is checked as text (pinned actions, narrow permissions, built-in token, no push from a pull request, digest printed). The local equivalent builds a release image, pushes four tags to a local registry, and checks tags, digests and labels with the API. A push to `main` must not move `latest`.

## How starter and reference are checked

Every `run.mjs` accepts `--reference` (or `DKR_USE_REFERENCE=1`) and then uses the file in `reference/` instead of the learner's file. Tests read facts. To check by hand: run the starter with `DKR_FACTS_PATH` pointing to a scratch file, run the test with the same variable (fails), run `run.mjs --reference --record` on the real facts, run the test (passes).

Test counts, failing on the starter / total (reference passes all): part 1 3 of 8, part 2 3 of 13, part 3 3 of 9, part 4 4 of 10.

## Deviations and problems

- **`docker push` to a port Docker chose.** On this Docker Desktop, a registry published with `-p 127.0.0.1::5000` (Docker picks the port) answers HTTP from Windows, but the engine cannot push to it: `dial tcp 127.0.0.1:<port>: connect: connection refused`. A port chosen by us (`-p 127.0.0.1:54999:5000`) works. So `run.mjs` picks a free port (`freePort()`) and the part 1 flags file has a `{PORT}` placeholder. The README has a Docker Desktop box. On Linux both ways should work (not tested here).
- **Pull anatomy.** On this machine `docker pull` of an image whose blobs are already in the local content store (it built them) is one `HEAD`. The containerd image store keeps blobs by digest after a tag is removed, and the build cache holds them, so there was no way to make Docker download a layer again without touching shared state. So the "full pull" is made by a few lines of Node using the learner's `client.manifest` (blobs are checked against their digests), and counted in the registry log. Both are recorded.
- **Delete by tag.** `registry:3` answers 202 to a `DELETE` on a tag and the tag disappears from the list, but garbage collection then frees nothing (the manifest is still stored). The fix is to delete by digest. I expected 405 or 400; the measurement says otherwise.
- **Garbage collection** is run with the registry still up (`registry garbage-collect /etc/distribution/config.yml`). This is fine for a demo with no pushes in flight, and it is not safe on a busy registry.
- **No GHCR run.** Nothing was pushed to `ghcr.io` and no workflow was run. The workflow ships with every action pinned to a verified full SHA (checkout v7.0.1, setup-buildx v4.4.1, login v4.7.0, metadata v6.2.0, build-push v7.4.0; see challenge 5 notes for the SHAs). That `GITHUB_TOKEN` with `packages: write` can push to GHCR is standard GitHub behaviour, not in the research dossier. The dossier says to log in with a classic personal access token from outside Actions.
- **Tags in the job log can differ** from `tagsFor`, because `docker/metadata-action` has its own rules. The README says so.
- **Image size.** `docker image inspect` `Size` is not used. Registry image: 64.6 MB unpacked, 20.5 MB packed (matches the dossier).
- **Timings** are tiny here (the registry is on the same machine). `pull_s` and `rollback_s` show the steps, not the internet.
- **Windows path conversion in Git Bash.** `docker exec ... du -sk /var/lib/registry` run by hand from Git Bash needs `MSYS_NO_PATHCONV=1`. The scripts spawn Docker from Node, so they are not affected.

## What the Docker Desktop learner sees differently

- The published-port behaviour above.
- Both servers in part 3 run on the same engine; on real servers the effect is the same.

## Not done

- No push to GHCR and no Actions run.
- No authenticated registry, token flow, rate limit or pull-through cache. The registry has no password, so it must stay on `127.0.0.1`.
- Retention and promotion across registries (chapter 7.5).
