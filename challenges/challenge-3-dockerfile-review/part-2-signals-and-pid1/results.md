# Results: Challenge 3, part 2: who gets SIGTERM?

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker run -d <image>   then   docker stop <container>   # no -t, median of 3, for each way to start daftar-api
```

**Output**

```text
way to start               PID 1 is                                stop   exit  graceful
CMD node ...; echo         /bin/sh -c node server.mjs; echo "     4.4 s   exit 137  killed, no shutdown line
CMD node server.mjs        node server.mjs                        1.1 s   exit 0    shutdown logged
CMD npm start              npm start                              0.6 s   exit 0    shutdown logged
CMD ["npm","start"]        npm start                              1.5 s   exit 0    shutdown logged
entrypoint.sh, no exec     /bin/sh /entrypoint.sh                 3.8 s   exit 137  killed, no shutdown line
entrypoint.sh, with exec   node server.mjs                        0.9 s   exit 0    shutdown logged
CMD ["node", ...]          node server.mjs                        0.5 s   exit 0    shutdown logged
CMD node ...; echo +init   /sbin/docker-init -- docker-entryp     0.5 s   exit 143  killed, no shutdown line
CMD ["node", ...] +init    /sbin/docker-init -- docker-entryp     1.7 s   exit 0    shutdown logged
```

**Note:** Read the PID 1 column against the stop column. A container that does not get SIGTERM (or whose PID 1 ignores it) waits for the grace period and is killed: exit 137, no shutdown line. One that does stops in about a second with exit 0.

## Step 2

**Command**

```sh
docker run -d alpine:3.23 sh -c "sleep 1000; echo x"   then   docker stop [-t N]   # PID 1 ignores SIGTERM, median of 3
```

**Output**

```text
docker stop           3.5 s
docker stop -t 1     1.7 s
docker stop -t 3     3.8 s
docker stop -t 10    10.8 s
the default is closest to -t 3
```

**Note:** The Docker documentation says the default wait is 10 seconds. Here the default behaves like a short wait, not like -t 10 (the command itself adds a second or two on Docker Desktop). Measure it where you run your containers.

## Step 3

**Command**

```sh
docker build -f Dockerfile.signals (your entrypoint.sh)   then   docker stop
```

**Output**

```text
your Dockerfile.signals    node server.mjs                        0.8 s   exit 0    shutdown logged
entrypoint printed "preparing": true
```

**Note:** Your entrypoint hands over to node with exec: node is PID 1, gets SIGTERM, drains and exits 0.

## Step 4

**Command**

```sh
node toolkit/cleanup.mjs 3  and  docker image rm <the images this part built>
```

**Output**

```text
Still labelled dkr.challenge=3: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone, including the image tags.
