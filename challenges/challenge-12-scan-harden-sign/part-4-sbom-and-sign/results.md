# Results: Challenge 12, part 4: SBOM, signature and gate

Recorded run. Machine: win32, Docker Engine 29.9.2, Node 22.22.2. Date: 2026-11-05.

## Step 1

**Command**

```sh
check workflow/release.yml for steps not pinned to a full commit hash
```

**Output**

```text
starter:   6 steps not pinned to a commit
reference: 0 steps not pinned to a commit, scanner pinned by digest
```

**Note:** A tag can be moved. In March 2026, 75 of 76 tags of a scanner action were moved to code that stole secrets. A 40 character commit hash cannot be moved. The GitHub run of this workflow is your own: this check only reads the file.

## Step 2

**Command**

```sh
docker pull ghcr.io/sigstore/cosign/cosign:v3.1.4@sha256:0f06154836d2de34f887a5c273506d52ca43edaa1d9e53e6510fa78a48f69c2d
```

**Output**

```text
cosign:   67.1 MB packed, named by digest
registry: 20.5 MB packed (registry:3)
SBOM generator: 49.6 MB packed, docker/buildkit-syft-scanner@sha256:873a7458c3c8ac8e32c...
```

**Note:** Three small tools. The SBOM generator is itself an image that BuildKit pulls by tag if you do not name it. Here it is named by digest too.

## Step 3

**Command**

```sh
docker run -d --network dkr-c12-net --network-alias registry -p 127.0.0.1:15012:5000 registry:3
```

**Output**

```text
registry listening on 127.0.0.1:15012
```

**Note:** A registry of your own. It only listens on your computer.

## Step 4

**Command**

```sh
docker buildx build --push --attest type=sbom,generator=<digest> --attest type=provenance,mode=max -t 127.0.0.1:15012/dkr-c12/app:1 app
```

**Output**

```text
Name:      127.0.0.1:15012/dkr-c12/app:1
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:3e7b2e59930d...
  Name:        127.0.0.1:15012/dkr-c12/app:1@sha256:0e73fa6643ac...
  MediaType:   application/vnd.oci.image.manifest.v1+json
  Platform:    linux/amd64
  Name:        127.0.0.1:15012/dkr-c12/app:1@sha256:b1810d042834...
  MediaType:   application/vnd.oci.image.manifest.v1+json
  Platform:    unknown/unknown
    vnd.docker.reference.type:   attestation-manifest
```

**Note:** One push, two manifests in the index: the image, and an attestation manifest that holds the SBOM and the provenance. Build and push took 6.6 s.

## Step 5

**Command**

```sh
docker buildx imagetools inspect <ref> --format "{{ json .SBOM }}"   (then summarizeSbom)
```

**Output**

```text
format: SPDX-2.3
packages: 17
first ones: alpine-baselayout, alpine-baselayout-data, alpine-keys, alpine-release, apk-tools, busybox
```

**Note:** An SBOM is a list of what is inside. It does not say whether any of it is vulnerable: you feed it to a scanner for that. Its value is that you can answer "do we ship package X?" in seconds.

## Step 6

**Command**

```sh
docker buildx imagetools inspect <ref> --format "{{ json .Provenance }}"
```

**Output**

```text
pkg:docker/docker/buildkit-syft-scanner?digest=sha256:873a7458c3c8ac8e32c7b796c10e1600b07b963d2aa000a72a2d97aaaa2d6315&platform=linux/amd64
  sha256:873a7458c3c8ac8e...
pkg:docker/alpine@3.23?platform=linux/amd64
  sha256:ff7f0c727dd796aa...
```

**Note:** Provenance says how the image was built and from what: the base image (by digest, as BuildKit saw it) and the SBOM generator.

## Step 7

**Command**

```sh
cosign generate-key-pair   (in a labelled volume, password made fresh for this run)
```

**Output**

```text
Private key written to cosign.key
Public key written to cosign.pub
```

**Note:** The key lives in a Docker volume that cleanup removes. It is never written into this repository, and the password is random and not printed. Never commit a real signing key.

## Step 8

**Command**

```sh
cosign sign --key /keys/cosign.key ... registry:5000/dkr-c12/app@sha256:3e7b2e59930d...
```

**Output**

```text
Signing artifact...
Pushing signature to: registry:5000/dkr-c12/app
```

**Note:** The signature is a small extra object in the registry, next to the image. It signs the digest, not the tag.

## Step 9

**Command**

```sh
cosign verify --key /keys/cosign.pub ... registry:5000/dkr-c12/app@sha256:3e7b2e59930d...
```

**Output**

```text
Verification for registry:5000/dkr-c12/app@sha256:3e7b2e59930df13cb2867a2f17e3602367f05a8af7c274c2081b66fcbdd5db90 --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - Existence of the claims in the transparency log was verified offline
  - The signatures were verified against the specified public key
```

**Note:** Verification checks the signature against the public key you trust. It needs no network access to any outside service here, because we skip the public transparency log on purpose (a local key is not in it).

## Step 10

**Command**

```sh
cosign attest --type spdxjson --predicate sbom.json ...  then  cosign verify-attestation --type spdxjson ...
```

**Output**

```text
attest exit 0
verify-attestation exit 0
Verification for registry:5000/dkr-c12/app@sha256:3e7b2e59930df13cb2867a2f17e3602367f05a8af7c274c2081b66fcbdd5db90 --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - Existence of the claims in the transparency log was verified offline
  - The signatures were verified against the specified public key
```

**Note:** Now the SBOM itself is signed. Someone who changes the SBOM after the build cannot make it verify.

## Step 11

**Command**

```sh
push OTHER code under the same tag 127.0.0.1:15012/dkr-c12/app:1  then  cosign verify ... registry:5000/dkr-c12/app:1
```

**Output**

```text
tag 1 now points at sha256:b26d0a26187c... (was sha256:3e7b2e59930d...)
Error: no signatures found
error during command execution: no signatures found
verify exit 10
```

**Note:** The tag moved to other code. The new image has no signature, so verification fails. This is why you deploy by digest, and why you verify what you pull.

## Step 12

**Command**

```sh
cosign verify ... registry:5000/dkr-c12/app@sha256:3e7b2e59930d...   (the ORIGINAL digest)
```

**Output**

```text
verify exit 0
```

**Note:** The original digest still verifies: its bytes did not change. The registry holds both images; only the tag moved.

## Step 13

**Command**

```sh
cosign verify --key <a DIFFERENT public key> ...@<the signed digest>
```

**Output**

```text
Error: no matching attestations: failed to verify signature: could not verify envelope: accepted signatures do not match threshold, Found: 0, Expected 1
error during command execution: no matching attestations: failed to verify signature: could not verify envelope: accepted signatures do not match threshold, Found: 0, Expected 1
verify exit 1
```

**Note:** The signature is valid, but not for this key. Verification answers "was this signed by the key I trust", not just "is there a signature". (second key made: true)

## Step 14

**Command**

```sh
gate.evaluate(evidence)   three images
```

**Output**

```text
signed digest:        PASS
moved tag:            FAIL
  - image is named by tag, not by digest
  - no valid signature for this image
nothing attached:     FAIL
  - image is named by tag, not by digest
  - no valid signature for this image
  - no usable SBOM
  - provenance is missing or a base image is not pinned by digest
```

**Note:** Your gate lets the signed, attested digest through and stops the other two, with a reason each.
