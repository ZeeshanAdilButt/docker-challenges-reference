# Challenge 12, part 4: SBOM, provenance, a signature and a gate

**Time:** about 60 minutes. **Download:** `ghcr.io/sigstore/cosign/cosign` (about 67 MB packed), `registry:3` (about 21 MB packed) and the SBOM generator image `docker/buildkit-syft-scanner` (about 50 MB packed), each named by digest. `alpine:3.23` is already here. About 138 MB in total. **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

You deploy an image. Two questions follow, and "I built it" is not an answer to either. **What is inside it?** When a flaw in a library is announced on a Tuesday, you must know in minutes whether you ship that library. **Is this really the image my pipeline built?** A tag can be moved to other code, a registry can be tampered with, and a build can be run on a machine you do not control. In March 2026 a trusted scanner was replaced by a poisoned copy under the same version names. Nobody who only trusted the name noticed.

Three pieces of evidence help. An **SBOM** says what is inside. **Provenance** says how and from what it was built. A **signature** says who vouches for exactly these bytes. A **gate** at the end of the pipeline reads all three and says yes or no.

## The idea

- **SBOM (software bill of materials):** a list of the packages in an image, here in the SPDX format. It does not say which are vulnerable; you give it to a scanner for that. Its value: "do we ship package X?" becomes a search, not a hunt.
- **Provenance:** a record of how the image was built. With BuildKit you get it with `--provenance=mode=max`. It lists the build's inputs, including the base image **by digest**.
- **Both are attestations:** extra objects stored in the registry next to the image, inside the same image index. You do not need a separate service.
- **A signature** is made with a private key over a **digest**. Anyone with the matching public key can check it. It proves that the holder of the key vouched for these exact bytes. It says nothing about whether the bytes are safe.
- **Verify what you pull, by digest.** A tag is a pointer that can move. If you verify a tag, you verify whatever it points to at that moment. A digest is the bytes.
- **Signing keys.** The big public setup (keyless signing, with a public transparency log) is a lesson for production. In this challenge you sign with a **throwaway local key pair** made inside the run, in a Docker volume that is deleted at the end. It is never saved in the repository. A real signing key is a secret like any other: never commit it.

Two small things about trust. The tool that makes the SBOM is itself an image. If you do not name it, BuildKit pulls it by a moving tag. Here it is named by digest. And the GitHub workflow that does all this must not use tags either: you pin every step to a full commit hash, as in part 1's lesson.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-12-scan-harden-sign/part-4-sbom-and-sign/test.mjs` | Eight tests **fail** on purpose. No Docker needed. |
| 2 | Read `workflow/release.yml`. Pin every `uses:` to a full commit hash and replace the poisoned scanner action with a `docker run` of the scanner image by digest. | Look a hash up with `gh api repos/<owner>/<repo>/commits/<tag> -q .sha` (you need the GitHub CLI and a network). Keep the tag in a comment. |
| 3 | Write `summarizeSbom` and `evaluate` in `gate.mjs`. The four rules are in the comment. | Start with `summarizeSbom`. |
| 4 | `node challenges/challenge-12-scan-harden-sign/part-4-sbom-and-sign/run.mjs` | Starts a local registry, builds and pushes `app/` with an SBOM and provenance, makes a throwaway key pair, signs and verifies the digest, moves the tag to other code and verifies again, and runs your gate on three images. |
| 5 | `node toolkit/show-facts.mjs c12.p4` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-12-scan-harden-sign/part-4-sbom-and-sign/test.mjs` | All tests pass. |

The GitHub run of `workflow/release.yml` is **your own**, in your own repository. This challenge does not push anything to GitHub and cannot run Actions. The local run in step 4 does the same work with the same tools. On GitHub you should expect: the build pushes to GHCR with an SBOM and provenance, the scanner step runs from its image, and the signature step is keyless (it uses the workflow's identity token, which is why `id-token: write` is in the file). The check in the tests only reads the file for unpinned steps.

## What you should see

The workflow check: 6 steps not pinned in the starter, 0 in the reference.

```text
format: SPDX-2.3
packages: 17
first ones: alpine-baselayout, alpine-baselayout-data, alpine-keys, alpine-release, apk-tools, busybox
```

The provenance lists two inputs, both by digest: the base image `alpine:3.23` and the SBOM generator.

```text
verify exit 0                          the signed digest
Error: no signatures found             the tag, after it was moved to other code (exit 10)
verify exit 0                          the ORIGINAL digest again: the old bytes still verify
Error: ... accepted signatures do not match threshold    a different public key (exit 1)
```

And the gate:

```text
signed digest:    PASS
moved tag:        FAIL  - image is named by tag, not by digest
                        - no valid signature for this image
nothing attached: FAIL  (four reasons)
```

The full recorded run is in [results.md](results.md). `fixtures/sbom.json` and `fixtures/provenance.json` are the SBOM and provenance of that run, trimmed. Your tests use them.

![Image downloads for this part](chart.svg)

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c12.p4.cosign_image_packed_mb`, `registry_image_packed_mb`, `sbom_generator_packed_mb` | Sum of the layer sizes of the amd64 manifest of each image. |
| `c12.p4.cosign_digest` | The digest in `lib.mjs`. |
| `c12.p4.workflow_unpinned_starter_count`, `workflow_unpinned_reference_count` | `findUnpinned` in `pins.mjs` on the starter and reference workflow. `workflow_unpinned_count` is the same for your own file. |
| `c12.p4.index_manifest_count` | Image manifests in the pushed index: the image and one attestation manifest (SBOM and provenance together). |
| `c12.p4.build_push_s` | Seconds for the build and push, one run. |
| `c12.p4.sbom_format`, `sbom_package_count` | `summarizeSbom` on the SBOM read back with `docker buildx imagetools inspect --format '{{ json .SBOM }}'`. |
| `c12.p4.provenance_dependency_count`, `provenance_all_digests` | Inputs listed in the provenance, and whether every one has a sha256 digest. |
| `c12.p4.sign_ok`, `verify_digest_ok`, `attest_ok` | Exit codes of `cosign sign`, `cosign verify` and `cosign attest` plus `verify-attestation`. |
| `c12.p4.verify_after_tag_moved_ok` | `cosign verify` of the tag after it points to other code. Must be false. |
| `c12.p4.verify_original_digest_after_move_ok` | `cosign verify` of the original digest after the tag moved. Must be true. |
| `c12.p4.verify_wrong_key_ok` | `cosign verify` with a different public key. Must be false. |
| `c12.p4.gate_*` | Your gate's verdicts on the three images. |

## What is different on Docker Desktop

- Attestations need an image store that can hold them. Docker Engine 29 uses the containerd image store by default on new installs and `docker buildx build --push` works. If your engine uses the older store, push to the registry (as this script does) rather than loading the image locally.
- The registry is reached two ways: from your computer as `127.0.0.1:15012` and from the signing container as `registry:5000` on a private Docker network. The digest is the same, which is the point.
- The registry speaks plain HTTP on your own computer, so cosign gets `--allow-http-registry`. Never use that flag for a registry on a network.
- `cosign generate-key-pair` needs more than 64 MB of memory (the key is encrypted with a memory-hungry function). It is killed at 64 MB, so the signing container gets 256 MB. This is the only reason a cap above 64 MB is used here, besides the scanner in part 1.

## Stuck?

- `Docker is not ready`: start Docker and wait until it says running.
- Port 15012 is in use: stop the program that uses it, or run `node toolkit/cleanup.mjs 12` if it is an old run of this part.
- `cosign verify` says "no signatures found" for the right digest: you verified a different digest, or the key volume was removed between steps. Run the script from the start.
- The test says a step is unpinned: the message gives the line. A hash has exactly 40 hexadecimal characters.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 12`. That removes the registry, the network and the throwaway keys. It does not remove the scanner cache from part 1.

## Next

Challenge 12 is done. Module 14 ships an image through a pipeline.
