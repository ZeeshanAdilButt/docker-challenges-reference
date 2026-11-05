# Results: Challenge 12, part 1: scan an old image

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
docker pull aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c
```

**Output**

```text
Digest: sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c
Status: Image is up to date for aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c
docker.io/aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c
```

**Note:** The scanner is named by its digest. It is 63.5 MB to download and 263.2 MB on disk. Why a digest: in March 2026 a Trivy release and its GitHub Action tags were poisoned. A tag can be moved; a digest cannot.

## Step 2

**Command**

```sh
trivy image --download-db-only   (volume dkr-c12-trivy-cache)
```

**Output**

```text
trivy.db on disk: 1692069888 bytes (1692 MB)
metadata.json: {"Version":2,"NextUpdate":"2026-11-06T07:00:54.926777259Z","UpdatedAt":"2026-11-05T07:00:54.926777429Z","DownloadedAt":"2026-11-05T10:09:33.121302074Z"}
```

**Note:** The database was already in the kept volume, so nothing was downloaded now. The first download on the reference machine took 71.4 s. Download 138.7 MB, 1692 MB on disk. The cost is large next to the 63 MB scanner. Every scan result depends on the date of this database.

## Step 3

**Command**

```sh
trivy image --scanners vuln --skip-db-update --severity CRITICAL nginx:1.18-alpine   (inside the pinned scanner container, cache volume mounted)
```

**Output**

```text
│ nginx:1.18-alpine (alpine 3.11.11) │ alpine │ 6 │
nginx:1.18-alpine (alpine 3.11.11)
Total: 6 (CRITICAL: 6)
│ Library │ Vulnerability │ Severity │ Status │ Installed Version │ Fixed Version │ Title │
│ apk-tools │ CVE-2021-36159 │ CRITICAL │ fixed │ 2.10.6-r0 │ 2.10.7-r0 │ libfetch: an out of boundary read while libfetch uses strtol │
│ curl │ CVE-2021-22945 │ │ │ 7.67.0-r3 │ 7.79.0-r0 │ curl: use-after-free and double-free in MQTT sending │
│ libcrypto1.1 │ CVE-2021-3711 │ │ │ 1.1.1k-r0 │ 1.1.1l-r0 │ openssl: SM2 Decryption Buffer Overflow │
│ libcurl │ CVE-2021-22945 │ │ │ 7.67.0-r3 │ 7.79.0-r0 │ curl: use-after-free and double-free in MQTT sending │
│ libssl1.1 │ CVE-2021-3711 │ │ │ 1.1.1k-r0 │ 1.1.1l-r0 │ openssl: SM2 Decryption Buffer Overflow │
│ zlib │ CVE-2022-37434 │ │ │ 1.2.11-r3 │ 1.2.11-r4 │ zlib: heap-based buffer over-read and overflow in inflate() │
```

**Note:** The scanner read the image from the registry itself. No Docker socket is needed. The first lines name the operating system and the number of findings. With the cached database a scan takes a few seconds; the database download is the real cost.

## Step 4

**Command**

```sh
node triage.mjs fixtures/old.json policy.json   (nginx:1.18-alpine)
```

**Output**

```text
alpine 3.11.11: 51 findings (6 critical, 29 high, 12 medium, 4 low, 0 unknown), 51 fixable
fix now 8, plan 39, accept 4
FAIL: 8 findings must be fixed now (allowed: 0)
FAIL: the base OS (alpine 3.11.11) is end of life: it gets no more fixes, and the scanner may know less about it, so a low count means little
FAIL
worst packages:
  libcrypto1.1 1.1.1k-r0 -> 1.1.1l-r0 (2)
  libssl1.1 1.1.1k-r0 -> 1.1.1l-r0 (2)
  apk-tools 2.10.6-r0 -> 2.10.7-r0 (1)
```

**Note:** The old image has FEWER findings than the year-old one, although it is far older. Likely reason: security advisories for its base (Alpine 3.11, end of life since 2021) stopped long ago, so the database knows little about it. A low count here means the scanner is blind, not that the image is safe. A count is not a risk.

## Step 5

**Command**

```sh
node triage.mjs fixtures/year-old.json policy.json   (nginx:1.27-alpine)
```

**Output**

```text
alpine 3.21.3: 216 findings (3 critical, 60 high, 100 medium, 46 low, 7 unknown), 216 fixable
fix now 25, plan 138, accept 53
FAIL: 25 findings must be fixed now (allowed: 0)
FAIL: the base OS (alpine 3.21.3) is end of life: it gets no more fixes, and the scanner may know less about it, so a low count means little
FAIL
worst packages:
  libcrypto3 3.3.3-r0 -> 3.3.7-r0 (9)
  libssl3 3.3.3-r0 -> 3.3.7-r0 (9)
  pcre2 10.43-r0 -> 10.43-r1 (4)
```

**Note:** More findings. Its base (Alpine 3.21) had fixes until very recently, so the database knows a lot, and every finding has a fixed version. Updating the packages is the cure.

## Step 6

**Command**

```sh
node triage.mjs fixtures/current.json policy.json   (alpine:3.23)
```

**Output**

```text
alpine 3.23.7: 0 findings (0 critical, 0 high, 0 medium, 0 low, 0 unknown), 0 fixable
fix now 0, plan 0, accept 0
PASS
```

**Note:** A current base image has no findings in this database. It will not stay that way: a new advisory can appear tomorrow.
