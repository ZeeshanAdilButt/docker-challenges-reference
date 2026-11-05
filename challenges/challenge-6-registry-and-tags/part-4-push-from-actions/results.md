# Results: Challenge 6, part 4: tags, labels and the GHCR workflow

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
node -e "tagsFor(...)"  for five builds (a push, a branch, a pull request, a release, a pre-release)
```

**Output**

```text
ok   push to main               ["sha-3f2a9c1","main"]
ok   push to a feature branch   ["sha-9a8b7c6","feature-login-page"]
ok   pull request               ["sha-1111111","pr-12"]
ok   release v1.2.3             ["sha-abcdef0","1.2.3","1.2","latest"]
ok   pre-release v2.0.0-rc.1    ["sha-0123456","2.0.0-rc.1"]
```

**Note:** Every build gets the tags it should and none it should not.

## Step 2

**Command**

```sh
grep -E "uses:|permissions|packages:|push:|password:" workflow/release.yml
```

**Output**

```text
push:
permissions: {}
permissions:
packages: write
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
# A pull request does not log in and does not push: its code is not trusted yet.
uses: docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6 # v4.7.0
password: ${{ secrets.GITHUB_TOKEN }}
uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
push: ${{ github.event_name != 'pull_request' }}
```

**Note:** Pinned actions, narrow permissions, no push from a pull request, the built-in token. The GitHub run is your own.

## Step 3

**Command**

```sh
docker push --all-tags 127.0.0.1:57294/dkr-c6/daftar-api   then   GET /v2/dkr-c6/daftar-api/tags/list   and HEAD each tag
```

**Output**

```text
tags pushed: ["sha-abcdef0","1.2.3","1.2","latest"]
tags in the registry: ["1.2","1.2.3","latest","sha-abcdef0"]
1.2            -> 39cd57d759a5
1.2.3          -> 39cd57d759a5
latest         -> 39cd57d759a5
sha-abcdef0    -> 39cd57d759a5
labels: revision abcdef0, version 1.2.3
```

**Note:** Every tag points to one digest. A release is one image with several names.

## Step 4

**Command**

```sh
push a commit to main   (tags: ["sha-3f2a9c1","main"])   then HEAD latest
```

**Output**

```text
latest before: 39cd57d759a5
latest after:  39cd57d759a5
```

**Note:** `latest` still points at the last release. A push to main did not move it.
