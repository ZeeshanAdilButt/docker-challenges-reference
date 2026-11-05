# Challenge 2, part 3: a tag that moves, and a digest that does not

**Time:** about 40 minutes. **Download:** `node:24-alpine` (about 62 MB packed) and `registry:3` (about 21 MB packed). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

Monday: you deploy `myapp:stable` to two servers. Both run version 1. Thursday: a release goes out under the same tag. A third server joins and pulls `myapp:stable`. Now two servers run version 1 and one runs version 2, all from the same line in the same config. A bug report arrives, and the first question is "which version is that server running?" Nobody can answer from the config file.

A tag looks like a version. It is not one.

## The idea

A registry keeps two things. **Blobs and manifests**, stored by digest: a digest is the hash of the content, so it can never point to something else. And a **table of tags**: each tag is a name that points at a digest, and whoever has push rights can point it somewhere new, any time.

- `latest` is not "the newest". It is the tag you get when you do not name one. It moves only when somebody pushes it.
- `stable`, `1`, `1.2` are all just names in that table.
- `repo@sha256:...` names the content itself. It cannot move.
- Pulling is the only time a tag is looked up. A server that already has an image, or a container that is already running, does not look again.

A second thing to see: a new release usually changes one or two layers. The registry already has the rest, so `docker push` skips them ("already exists"), and `docker pull` on a server that has version 1 downloads only the new layers.

In this part you ask the registry yourself, over HTTP, as Docker does. The registry runs in a container on your machine. Your task: write three small functions in `resolve.mjs` that call its API.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-2-take-an-image-apart/part-3-a-tag-that-moves/test.mjs` | Fails on purpose: the functions throw `not written yet`. |
| 2 | Open `resolve.mjs`, write `digestOf`, `listTags`, `layersOf` | The comments list the two routes you need and the header to read. |
| 3 | `node --test challenges/challenge-2-take-an-image-apart/part-3-a-tag-that-moves/test.mjs` | Your functions run against a tiny fake registry inside the test. The facts test still fails. |
| 4 | `node challenges/challenge-2-take-an-image-apart/part-3-a-tag-that-moves/run.mjs` | Starts a real registry, pushes version 1, starts server A, releases version 2 under the same tag, starts server B and server C. About 40 seconds. |
| 5 | `node toolkit/show-facts.mjs c2.p3` | Shows the saved facts. |
| 6 | `node --test challenges/challenge-2-take-an-image-apart/part-3-a-tag-that-moves/test.mjs` | All tests pass. |

What step 4 does, in order:

1. Starts `registry:3` on `127.0.0.1` with a labelled volume, and checks that it is empty.
2. Builds daftar-api as version 1.0.0, pushes it as `:stable` and `:1.0.0`, and uses your functions to read both tags.
3. **Server A** runs `:stable` (it pulls version 1).
4. Builds version 2.0.0 and pushes it as `:stable` and `:2.0.0`. It reads the tags again and counts the layers that were shared.
5. **Server B** runs `:stable` (it pulls version 2). Server A is restarted.
6. **Server C** runs the version 1 **digest**.
7. Cleans up: the registry, its volume, the three servers and the image tags.

## What you should see

```text
stable  -> 96c7924bd2f1b29e   (was e3e13ab2a2be50ac)
1.0.0   -> e3e13ab2a2be50ac   (did not move)
layers:    7, of which 6 are the same as version 1
new layers: 1, 147 bytes packed (a full pull is 62495630)

server A: ...:stable  ->  version 1.0.0 ... after a restart
server B: ...:stable  ->  version 2.0.0
server C: version 1.0.0 ... even though stable now means 2.0.0
```

Read it as: the tag moved, the version tag and the digest did not, an update downloaded 147 bytes instead of 62 MB, and two servers with the same tag in their config ran different programs.

The full recorded run is in [results.md](results.md).

![Download for version 2 when version 1 is already there](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c2.p3.digest_v1`, `c2.p3.digest_v2` | Your `digestOf` for `stable`, before and after the release. |
| `c2.p3.tag_moved` | The two digests differ. |
| `c2.p3.version_tag_stayed` | Your `digestOf` for `1.0.0` is the same before and after. |
| `c2.p3.tags_count` | Tags your `listTags` found after the release (3). |
| `c2.p3.shared_layers_count`, `c2.p3.new_layers_count` | Your `layersOf` for version 1 and version 2, compared by digest. |
| `c2.p3.push2_already_exists_count` | Lines saying `already exists` in the output of the two pushes of version 2. |
| `c2.p3.update_download_bytes` | Sum of the sizes of the new layers. |
| `c2.p3.full_pull_bytes` | Sum of the sizes of all layers of version 2. |
| `c2.p3.server_a_version`, `c2.p3.server_a_after_restart_version` | `version` from `GET /` of server A, and again after `docker restart`. |
| `c2.p3.server_b_version`, `c2.p3.server_c_by_digest_version` | The same for servers B and C. |
| `c2.p3.same_tag_two_versions` | Server A (after restart) and server B run different versions. |

## What is different on Docker Desktop

- The Docker daemon runs in a virtual machine. It can push to `127.0.0.1:<port>` only when the port is fixed in `-p 127.0.0.1:<port>:5000`. When Docker picks the port (`-p 127.0.0.1::5000`) the push fails with `connection refused`. The script picks a free port itself.
- Docker treats `127.0.0.0/8` registries as insecure (plain HTTP) by default. A registry on any other address needs a TLS certificate or an `insecure-registries` entry in the daemon settings.
- Your computer is one "server" here. Servers A and B are two containers on it. A real fleet is several machines, each with its own local image cache, which behaves the same way.

## Stuck?

- `digestOf is not written yet`: that is the starter. Open `resolve.mjs`.
- `registry answered 404`: you did not send the `Accept` header. A registry answers only for the types you list.
- `dial tcp ... connection refused` on push: the port was not fixed. Run `run.mjs` as it is, it picks one.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 2`. Image tags that start with `127.0.0.1:` and contain `dkr-c2-app` are yours: remove them by full name with `docker image rm`.
