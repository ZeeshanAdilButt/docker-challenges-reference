# Results: Challenge 3, part 4: build secrets and run secrets

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build --build-arg NPM_TOKEN=<token> --secret id=npm_token,src=<file> -f <Dockerfile> .   (both Dockerfiles, same flags)
```

**Output**

```text
original (Dockerfile.leaky)
   build-proof.txt = c5effe7f  (fingerprint of the token: matches, so the token WAS available to the build)
yours (Dockerfile)
   build-proof.txt = c5effe7f  (fingerprint of the token: matches, so the token WAS available to the build)
```

**Note:** Both builds could use the token: build-proof.txt holds its fingerprint, not the token.

## Step 2

**Command**

```sh
docker history --no-trunc <image> | grep <token>   and   look in the saved image: config and every file of every layer
```

**Output**

```text
                              history   config   layers
original (Dockerfile.leaky)   YES       YES      no
yours (Dockerfile)            no        no       no
```

**Note:** An ARG used in RUN is written into the history and the config of the image, in plain text, even though the .npmrc file was deleted. A build secret is a file that exists for one step and leaves no trace.

## Step 3

**Command**

```sh
docker run -d <flags from secret-run.mjs> <image> sleep 60   then   docker inspect and docker exec node check-secret.mjs
```

**Output**

```text
original (-e API_KEY=...)  source env   key in docker inspect: YES  key in the flags: YES  read-only mount: no
yours (secret-run.mjs)     source file  key in docker inspect: no   key in the flags: no   read-only mount: YES
fingerprint read by the app matches: original YES, yours YES
```

**Note:** An environment variable is stored in the container config: anyone who can run docker inspect reads it. A file mounted read-only is not in the config. The app reads it either way.

## Step 4

**Command**

```sh
node toolkit/cleanup.mjs 3  and  docker image rm <the images this part built>
```

**Output**

```text
Still labelled dkr.challenge=3: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone, including the image tags and the temporary secret files.
