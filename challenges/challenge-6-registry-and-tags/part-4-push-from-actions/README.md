# Challenge 6, part 4: push from GitHub Actions to GHCR

**Time:** about 40 minutes. **Download:** `registry:3` and `alpine:3.23` (from part 1). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Your pipeline pushes images for every commit. After a month the registry holds hundreds of tags. Nobody knows which one is "the release". `latest` points to whatever was built last, including a half-finished branch. And the workflow file that does the pushing can write to your whole repository, on code that anyone can send in a pull request. Both problems are cheap to prevent, and expensive to find in an incident.

## The idea

A pipeline that pushes images needs two decisions written down.

**1. Which tags does each build get?** Our rules:

| Build | Tags |
|---|---|
| Any build | `sha-<first 7 characters of the commit>`. This is the tag you trace an incident with |
| Push to a branch | the branch name, with `/` turned into `-` (moves with every push, for test environments) |
| Pull request | `pr-<number>` |
| Release tag `vX.Y.Z` | `X.Y.Z`, `X.Y` and `latest` |
| Pre-release `vX.Y.Z-rc.1` | `X.Y.Z-rc.1` only |

`latest` belongs to releases. If a branch push can move it, it means nothing.

**2. What may the workflow do?** Our rules: every action pinned to a full commit SHA (a tag can be rewritten, and was, in 2026 for a popular security scanner action); the job gets `contents: read` and `packages: write` and nothing else; it logs in with the built-in `GITHUB_TOKEN`, which lasts for one run; a pull request builds but does not log in and does not push; the digest is printed, so a deploy and a rollback can name exact bytes.

GHCR is GitHub's registry. Images go to `ghcr.io/<owner>/<repo>`.

## Your job

Two files in this folder, both with faults: `tags.mjs` (the function behind the tag table) and `workflow/release.yml` (the GitHub Actions workflow). Fix them, not the copies in `reference/`.

**The GitHub run is your own.** This machine cannot run Actions and does not log in to GHCR, so the reference run never pushed to GHCR. Copy `workflow/release.yml` to `.github/workflows/release.yml` in your own repository, push a branch, then push a tag such as `v0.1.0`, and read the job log. The local steps below are the same push with the same tags and labels, made to a registry on your machine, so that you can check the result with the API.

## Steps

Run these in the root folder of your repository.

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-6-registry-and-tags/part-4-push-from-actions/test.mjs` | Fails on purpose. |
| 2 | `node challenges/challenge-6-registry-and-tags/part-4-push-from-actions/run.mjs` | Runs `tagsFor` on five builds, checks the workflow, then builds a release image, pushes every tag to a local registry and checks tags, digests and labels with the API. Then it pushes a commit to `main` and checks that `latest` did not move. About 1 minute. |
| 3 | Fix `tags.mjs` until the five cases say `ok`. | |
| 4 | Fix `workflow/release.yml`: narrow the permissions, use `GITHUB_TOKEN`, do not push from a pull request, print the digest. | |
| 5 | Run step 2 again. | Every line is `ok`, and `latest` stays on the release. |
| 6 | `node toolkit/show-facts.mjs c6.p4` | Shows the saved numbers. |
| 7 | `node --test challenges/challenge-6-registry-and-tags/part-4-push-from-actions/test.mjs` | The test passes. |
| 8 | Your own run on GitHub (see above). | Expect the job to push `sha-...` and branch tags on a branch, `X.Y.Z`, `X.Y` on a tag, and nothing on a pull request. Compare the tags in the job log with `tagsFor`. They can differ in small ways, because the tag action has its own rules. |

## What you should see

From step 2 with the reference files:

```text
ok   push to main               ["sha-3f2a9c1","main"]
ok   release v1.2.3             ["sha-abcdef0","1.2.3","1.2","latest"]
...
tags in the registry: ["1.2","1.2.3","latest","sha-abcdef0"]
every tag -> one digest
latest after a push to main: unchanged
```

The full recorded run is in [results.md](results.md).

![Tags pushed for each kind of build](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c6.p4.tag_cases_passed` | Cases in `cases.json` where `tagsFor` returns exactly the expected set. |
| `c6.p4.registry_tags_match`, `c6.p4.one_digest` | `GET /v2/<repo>/tags/list`, then `HEAD` on each tag: all tags point to one digest. |
| `c6.p4.labels_ok` | The image config blob has the labels `org.opencontainers.image.revision`, `.version` and `.source`. |
| `c6.p4.latest_stays_on_release` | `HEAD` on `latest` before and after a push of a `main` build. |
| `c6.p4.workflow_*` | Text checks on the workflow: unpinned `uses:` lines, `permissions: write-all`, `packages: write`, `push:` guarded by the event name, `secrets.GITHUB_TOKEN`, the `steps.build.outputs.digest` line. |

## What is different on Docker Desktop

Nothing. The local registry is the same container as in parts 1 to 3. In GitHub Actions the runner is a Linux machine, so nothing about Docker Desktop applies there.

## Stuck?

- `FAIL release v1.2.3`: the line below it shows the expected set. Order does not matter.
- `latest moved on a branch push`: only a release tag may add `latest`.
- Pinning an action: `gh api repos/docker/login-action/commits/v4.7.0 -q .sha` prints the full SHA of that tag. Put it after `@`, and the tag in a comment after it.
- Left-over objects after a crash: `node toolkit/cleanup.mjs 6`.

## Next

Challenge 7: networks and volumes, where two containers have to find each other.
