# Results: Challenge 12, part 3: harden and attack

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker run -d --memory 64m --pids-limit 200 dkr-c12-target:1
```

**Output**

```text
uid=0 CapEff: 00000000a80425fb NoNewPrivs=0
SUCCEEDED  write-rootfs  write a new program into /usr/local/bin
SUCCEEDED  read-secret   read the root-only secret file
SUCCEEDED  setuid-climb  climb to root with the setuid program doas and read the secret
SUCCEEDED  chown-file    give a file to another user (needs the CHOWN capability)
SUCCEEDED  make-device   create a device file (needs the MKNOD capability)
SUCCEEDED  fork-flood    start 150 processes at once
```

**Note:** Starter settings (the container as it ships): 6 of 6 attacks succeeded.

## Step 2

**Command**

```sh
docker run -d --memory 64m --pids-limit 200 --user 10001:10001 dkr-c12-target:1
```

**Output**

```text
uid=10001 CapEff: 0000000000000000 NoNewPrivs=0
blocked    write-rootfs  write a new program into /usr/local/bin
blocked    read-secret   read the root-only secret file
SUCCEEDED  setuid-climb  climb to root with the setuid program doas and read the secret
blocked    chown-file    give a file to another user (needs the CHOWN capability)
blocked    make-device   create a device file (needs the MKNOD capability)
SUCCEEDED  fork-flood    start 150 processes at once
```

**Note:** ONLY a non-root user added to the starter: 2 of 6 attacks succeeded.

## Step 3

**Command**

```sh
docker run -d --memory 64m --pids-limit 200 --user 10001:10001 --security-opt no-new-privileges dkr-c12-target:1
```

**Output**

```text
uid=10001 CapEff: 0000000000000000 NoNewPrivs=1
blocked    write-rootfs  write a new program into /usr/local/bin
blocked    read-secret   read the root-only secret file
blocked    setuid-climb  climb to root with the setuid program doas and read the secret
blocked    chown-file    give a file to another user (needs the CHOWN capability)
blocked    make-device   create a device file (needs the MKNOD capability)
SUCCEEDED  fork-flood    start 150 processes at once
```

**Note:** Non-root user plus no_new_privileges: 1 of 6 attacks succeeded.

## Step 4

**Command**

```sh
docker run -d --memory 64m --pids-limit 32 --user 10001:10001 --cap-drop ALL --read-only --security-opt no-new-privileges --tmpfs /tmp:rw,size=8m,noexec,nosuid,nodev dkr-c12-target:1
```

**Output**

```text
uid=10001 CapEff: 0000000000000000 NoNewPrivs=1
blocked    write-rootfs  write a new program into /usr/local/bin
blocked    read-secret   read the root-only secret file
blocked    setuid-climb  climb to root with the setuid program doas and read the secret
blocked    chown-file    give a file to another user (needs the CHOWN capability)
blocked    make-device   create a device file (needs the MKNOD capability)
blocked    fork-flood    start 150 processes at once
```

**Note:** Reference settings: 0 of 6 attacks succeeded.

## Step 5

**Command**

```sh
docker run -d --memory 64m --pids-limit 32 --cap-drop ALL --read-only --security-opt no-new-privileges --tmpfs /tmp:rw,size=8m,noexec,nosuid,nodev dkr-c12-target:1
```

**Output**

```text
uid=0 CapEff: 0000000000000000 NoNewPrivs=1
blocked    write-rootfs  write a new program into /usr/local/bin
SUCCEEDED  read-secret   read the root-only secret file
blocked    setuid-climb  climb to root with the setuid program doas and read the secret
blocked    chown-file    give a file to another user (needs the CHOWN capability)
blocked    make-device   create a device file (needs the MKNOD capability)
blocked    fork-flood    start 150 processes at once
```

**Note:** Reference settings WITHOUT user: 1 of 6 attacks succeeded.

## Step 6

**Command**

```sh
docker run -d --memory 64m --pids-limit 32 --user 10001:10001 --read-only --security-opt no-new-privileges --tmpfs /tmp:rw,size=8m,noexec,nosuid,nodev dkr-c12-target:1
```

**Output**

```text
uid=10001 CapEff: 0000000000000000 NoNewPrivs=1
blocked    write-rootfs  write a new program into /usr/local/bin
blocked    read-secret   read the root-only secret file
blocked    setuid-climb  climb to root with the setuid program doas and read the secret
blocked    chown-file    give a file to another user (needs the CHOWN capability)
blocked    make-device   create a device file (needs the MKNOD capability)
blocked    fork-flood    start 150 processes at once
```

**Note:** Reference settings WITHOUT cap_drop: 0 of 6 attacks succeeded.

## Step 7

**Command**

```sh
docker run -d --memory 64m --pids-limit 32 --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,size=8m,noexec,nosuid,nodev dkr-c12-target:1
```

**Output**

```text
uid=10001 CapEff: 0000000000000000 NoNewPrivs=1
blocked    write-rootfs  write a new program into /usr/local/bin
blocked    read-secret   read the root-only secret file
blocked    setuid-climb  climb to root with the setuid program doas and read the secret
blocked    chown-file    give a file to another user (needs the CHOWN capability)
blocked    make-device   create a device file (needs the MKNOD capability)
blocked    fork-flood    start 150 processes at once
```

**Note:** Reference settings WITHOUT read_only: 0 of 6 attacks succeeded.

## Step 8

**Command**

```sh
docker run -d --memory 64m --pids-limit 32 --user 10001:10001 --cap-drop ALL --read-only --tmpfs /tmp:rw,size=8m,noexec,nosuid,nodev dkr-c12-target:1
```

**Output**

```text
uid=10001 CapEff: 0000000000000000 NoNewPrivs=0
blocked    write-rootfs  write a new program into /usr/local/bin
blocked    read-secret   read the root-only secret file
blocked    setuid-climb  climb to root with the setuid program doas and read the secret
blocked    chown-file    give a file to another user (needs the CHOWN capability)
blocked    make-device   create a device file (needs the MKNOD capability)
blocked    fork-flood    start 150 processes at once
```

**Note:** Reference settings WITHOUT no_new_privileges: 0 of 6 attacks succeeded.

## Step 9

**Command**

```sh
docker run -d --memory 64m --pids-limit 200 --user 10001:10001 --cap-drop ALL --read-only --security-opt no-new-privileges --tmpfs /tmp:rw,size=8m,noexec,nosuid,nodev dkr-c12-target:1
```

**Output**

```text
uid=10001 CapEff: 0000000000000000 NoNewPrivs=1
blocked    write-rootfs  write a new program into /usr/local/bin
blocked    read-secret   read the root-only secret file
blocked    setuid-climb  climb to root with the setuid program doas and read the secret
blocked    chown-file    give a file to another user (needs the CHOWN capability)
blocked    make-device   create a device file (needs the MKNOD capability)
SUCCEEDED  fork-flood    start 150 processes at once
```

**Note:** Reference settings WITHOUT pids_limit: 1 of 6 attacks succeeded.

## Step 10

**Command**

```sh
summary: which attack gets through when ONE control is removed
```

**Output**

```text
without user               read-secret
without cap_drop           nothing gets through
without read_only          nothing gets through
without no_new_privileges  nothing gets through
without pids_limit         fork-flood
```

**Note:** Each control stops a different attack, and some overlap on purpose: when one is missing or wrong, another still holds. That is defence in depth.
