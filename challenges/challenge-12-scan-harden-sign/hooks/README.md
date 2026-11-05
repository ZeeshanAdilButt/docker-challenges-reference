# Pipeline hooks: scan, SBOM and sign

The pipelines of challenge 13 (`runPipeline` in `challenges/challenge-13-ship-it/kit.mjs`) and challenge 14 call three small programs from this folder if they exist. They turn the tools of challenge 12 into pipeline stages. They are part of the repository you copy: **learners use them, they are not an exercise** (the exercises of challenge 12 are in the four part folders).

## The contract

```text
node challenges/challenge-12-scan-harden-sign/hooks/<stage>.mjs <image reference>
```

| Stage | What it gets | What it does | Fails when |
|---|---|---|---|
| `scan` | An image on this machine's Docker, for example `127.0.0.1:5000/app:build-1a2b3c4` | Saves the image into a volume and runs the scanner pinned by digest (`TRIVY` in `lib.mjs`): a secret scan, and a vulnerability scan with the cached database | A secret of HIGH or CRITICAL severity, or more than `DKR_SCAN_MAX_CRITICAL` (default 0) CRITICAL vulnerabilities that have a fix |
| `sbom` | The same kind of reference | Makes an SPDX SBOM with the same pinned scanner. No database needed | No SPDX document with at least one package |
| `sign` | The image that was **pushed**, by digest: `127.0.0.1:5000/app@sha256:<64 hex>` | Makes a throwaway key pair in a labelled volume, signs the digest with cosign (pinned by digest) in a container on the registry's network, and verifies the signature with the public key | The reference is a tag, no registry publishes that port, signing or verifying fails |

Rules for every hook:

- **Exit code:** 0 passes (status `ok` or `partial`), 1 fails.
- **One result line on standard output, nothing else on either stream:** `<stage> <status> key=value key=value ...`, where `status` is `ok`, `failed` or `partial`, and values contain no spaces. Examples:

```text
scan ok scanner=trivy-0.76.1 secrets=0 critical_fixable=0 high_fixable=0 total=0 os=alpine-3.23.7 seconds=6.0
sbom ok format=SPDX-2.3 packages=17 sha256=88dadb701a71 seconds=3.0
sign ok digest=sha256:3d67941fed5a verified=true key=throwaway seconds=4.9
scan failed scanner=trivy-0.76.1 secrets=1 vuln=not-run seconds=3.4
```

  `hooks/common.mjs` has `parseResult` to read such a line back.
- **Safe by design:** no `--privileged`, no Docker socket. Everything created is named `dkr-c12-hook-...` and labelled `dkr.challenge=12`, and is removed before the hook exits. The throwaway signing key never touches your disk, and its password is random, not printed.
- **Memory:** the scanner gets 1 GB (it maps its database) and cosign 256 MB (key generation is killed at 64 MB). Everything else gets 64 MB.

## What the scan costs

The vulnerability database is **139 MB to download and about 1.7 GB on disk**, once. It is kept in the volume `dkr-c12-trivy-cache` (see part 1). The first `scan` run downloads it; later runs reuse it and take a few seconds. If you cannot afford it, set `DKR_SCAN_OFFLINE=1`: the hook then runs the secret scan only and reports `partial` with `vuln=not-run`. That is an honest half-answer. Do not count it as a full scan.

The scan result depends on the date of the database. A `CRITICAL` with a fix that appears tomorrow can turn a passing pipeline into a failing one. That is the point of a gate.

## Tests

`node --test challenges/challenge-12-scan-harden-sign/hooks/test.mjs`. The first five tests need no Docker. The rest run each hook on small images (about a minute). The full vulnerability scan is tested only when the database is cached.
