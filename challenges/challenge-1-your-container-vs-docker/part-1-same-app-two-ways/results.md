# Results: Challenge 1, part 1: the same app in your container and in Docker

Recorded run. Machine: win32, Docker Desktop, Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker build -t dkr-c1-daftar:1 .   # daftar-api plus probe.mjs on node:24-alpine
```

**Output**

```text
dkr-c1-daftar:1: Size field 243638979 bytes
layers unpacked: 172 MB
layers packed (as saved): 62.5 MB
```

**Note:** One image, 172 MB of files in its layers. docker reports a Size of 243.6 MB, which is not the size of the files. Both containers use exactly these files.

## Step 2

**Command**

```sh
docker export <image copy> | docker exec -i dkr-c1-host tar -x -C /rootfs
```

**Output**

```text
/rootfs holds 173 MB
```

**Note:** The image's files are now a plain folder inside the host. That folder is the root file system of your container. This took 17 s.

## Step 3

**Command**

```sh
docker exec dkr-c1-host mini-container.sh run daftar-mini /rootfs 134217728 64 1 sh -c "cd /app && exec node server.mjs"
```

**Output**

```text
container daftar-mini answers /health
```

**Note:** Your container: ready in 0.61 s (median of 3, including the wait for /health).

## Step 4

**Command**

```sh
docker run -d --name dkr-c1-app --label dkr.challenge=1 --memory 128m --memory-swap 128m --pids-limit 64 --tmpfs /tmp:rw,size=16m --log-opt max-size=1m --log-opt max-file=2 --security-opt no-new-privileges -p 127.0.0.1::8080 dkr-c1-daftar:1
```

**Output**

```text
container dkr-c1-app answers /health on 127.0.0.1:51946
```

**Note:** Docker: ready in 0.88 s (median of 3). Docker adds a bridge network, a published port, DNS files and a writable layer.

## Step 5

**Command**

```sh
GET /  and  GET /pid  on both
```

**Output**

```text
your container: {"app":"daftar-api","version":"1.0.0","hostname":"daftar-mini","requests":2} {"pid":1,"ppid":0}
docker:         {"app":"daftar-api","version":"1.0.0","hostname":"09adac509b46","requests":2} {"pid":1,"ppid":0}
```

**Note:** Same service, same answers. In both, node is PID 1 and its parent is 0: the process is the first one in its own PID namespace.

## Step 6

**Command**

```sh
node /app/probe.mjs   # run inside each container (docker exec, and mini-container.sh exec)
```

**Output**

```text
what the process sees       your container            docker
hostname                    daftar-mini               09adac509b46
PID 1 is                    node server.mjs           node server.mjs
user id of the app          0                         1000
namespaces it made          ipc mnt net pid uts       cgroup ipc mnt net pid time uts
capabilities allowed        16                        14
mounts it sees              12                        25
root file system            ext4                      overlay
cgroup path                 0::/mini-daftar-mini      0::/
memory.max                  134217728                 134217728
node reads its limit (MB)   0                         128
/proc/sys writable          true                      false
DNS servers in resolv.conf  0                         1
eth0 address                10.77.1.2                 172.17.0.4
environment variables       2                         6
```

**Note:** The probe reads /proc and /sys from the inside. Rows that differ are what Docker adds or decides for you.

## Step 7

**Command**

```sh
compare answers.json with the measurement
```

**Output**

```text
ok   docker_makes_namespaces: you said ["cgroup","ipc","mnt","net","pid","time","uts"], measured ["cgroup","ipc","mnt","net","pid","time","uts"]
ok   your_script_makes_namespaces: you said ["ipc","mnt","net","pid","uts"], measured ["ipc","mnt","net","pid","uts"]
ok   who_runs_the_image_user: you said "docker", measured "docker"
ok   docker_proc_sys_writable: you said false, measured false
ok   more_mounts: you said "docker", measured "docker"
ok   node_sees_its_limit_in_your_container: you said false, measured false
```

**Note:** Your guesses are checked against the probe output above, not against a fixed list.

## Step 8

**Command**

```sh
node toolkit/cleanup.mjs 1
```

**Output**

```text
Still labelled dkr.challenge=1: 0 containers, 0 networks, 0 volumes.
```

**Note:** Everything this part made is gone: the host, the volume with your root folder, the Docker container and the image tag.
