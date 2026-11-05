# Results: Challenge 12, part 2: hunt the secret

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build --build-arg NPM_TOKEN=... --secret id=npm_token,src=secrets/npm_token (starter app/)
```

**Output**

```text
built dkr-c12-leaky:starter in 5.1 s
```

**Note:** The build gets the token two ways on purpose: as a build argument (the old, leaky way) and as a BuildKit secret (the safe way). Which one the Dockerfile uses is your choice.

## Step 2

**Command**

```sh
docker history --no-trunc dkr-c12-leaky:starter
```

**Output**

```text
RUN |1 NPM_TOKEN=dkrcanary-build-arg-1b8e4d7a9c3f5026 /bin/sh -c rm /app/deploy.key # buildkit
ENV API_KEY=dkrcanary-env-var-5c2a8e1f7d9b3064
RUN |1 NPM_TOKEN=dkrcanary-build-arg-1b8e4d7a9c3f5026 /bin/sh -c echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /app/.npmrc && node --version > /app/build-note.tx
ARG NPM_TOKEN=dkrcanary-build-arg-1b8e4d7a9c3f5026
```

**Note:** Anyone who can pull the image can run this. Build arguments and ENV lines are printed in full, token included.

## Step 3

**Command**

```sh
docker run --rm --entrypoint ls dkr-c12-leaky:starter -A /app
```

**Output**

```text
.dockerignore
.env
Dockerfile
build-note.txt
package.json
server.mjs
```

**Note:** This is the image as a container sees it. A deleted file is not here. That does NOT mean it is gone from the image: see the next step.

## Step 4

**Command**

```sh
look in all 8 layers and 8 JSON files of docker save dkr-c12-leaky:starter
```

**Output**

```text
FOUND   env_file     layer d858cf109f40
FOUND   build_arg    config 372174561aec
FOUND   env_var      config 372174561aec, layer d858cf109f40
FOUND   deleted_key  layer d858cf109f40
```

**Note:** 4 of 4 secrets are in the image. A "layer" hit means the file content sits in a layer; a "config" hit means it is in the image configuration (environment, history, build arguments). Deleting a file in a later layer does not remove it from the earlier layer.

## Step 5

**Command**

```sh
trivy image --input img.tar --scanners secret   (pinned scanner, no database needed)
```

**Output**

```text
private-key (HIGH) in /app/deploy.key
```

**Note:** The scanner found 1 of the 4. It only knows secrets with a known shape (a PEM private key). A token with no pattern, a variable, a build argument: it sees none of them. A scanner is one tool, not the answer.

## Step 6

**Command**

```sh
docker run --rm -e API_KEY=<key> dkr-c12-leaky:starter node server.mjs --check
```

**Output**

```text
{"api_key_configured":true,"api_key_length":34,"env_file_in_image":true,"deploy_key_in_image":false}
```

**Note:** The key arrives at run time, so the app works without the key being in the image.

## Step 7

**Command**

```sh
docker build --build-arg NPM_TOKEN=... --secret id=npm_token,src=secrets/npm_token (reference/app/)
```

**Output**

```text
built dkr-c12-leaky:fixed in 8.3 s
```

**Note:** The build gets the token two ways on purpose: as a build argument (the old, leaky way) and as a BuildKit secret (the safe way). Which one the Dockerfile uses is your choice.

## Step 8

**Command**

```sh
docker history --no-trunc dkr-c12-leaky:fixed
```

**Output**

```text
(no line mentions a secret)
```

**Note:** The history shows no secret. It would be enough to say "done" if the layers were clean too, so look at them next.

## Step 9

**Command**

```sh
docker run --rm --entrypoint ls dkr-c12-leaky:fixed -A /app
```

**Output**

```text
build-note.txt
package.json
server.mjs
```

**Note:** This is the image as a container sees it. A deleted file is not here. That does NOT mean it is gone from the image: see the next step.

## Step 10

**Command**

```sh
look in all 7 layers and 8 JSON files of docker save dkr-c12-leaky:fixed
```

**Output**

```text
clean   env_file     -
clean   build_arg    -
clean   env_var      -
clean   deleted_key  -
```

**Note:** 0 of 4 secrets are in the image. A "layer" hit means the file content sits in a layer; a "config" hit means it is in the image configuration (environment, history, build arguments). Deleting a file in a later layer does not remove it from the earlier layer.

## Step 11

**Command**

```sh
trivy image --input img.tar --scanners secret   (pinned scanner, no database needed)
```

**Output**

```text
(no findings)
```

**Note:** The scanner found nothing.

## Step 12

**Command**

```sh
docker run --rm -e API_KEY=<key> dkr-c12-leaky:fixed node server.mjs --check
```

**Output**

```text
{"api_key_configured":true,"api_key_length":34,"env_file_in_image":false,"deploy_key_in_image":false}
```

**Note:** The key arrives at run time, so the app works without the key being in the image.
