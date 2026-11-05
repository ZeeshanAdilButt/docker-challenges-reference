# Notes for challenge 12: scan, harden, sign

## What each part proves

1. **Scan an old image.** A scan count is not a risk. `nginx:1.18-alpine` (2021) shows 51 findings, `nginx:1.27-alpine` shows 216, `alpine:3.23` shows 0. The old image looks better only because its base (Alpine 3.11) has little advisory data left. The learner writes `summarize`, `classify` and `verdict` over saved real scans (offline), against a policy. A live scan with the pinned scanner is optional.
2. **Hunt the secret.** Four fake secrets leak four ways: a copied `.env`, a build argument, an `ENV` line and a key that a later `rm` "deleted". A zero-dependency tool (`layers.mjs`) reads every layer and the configuration of `docker save`. It finds 4 of 4. The pinned scanner's secret scan finds 1 of 4 (the PEM key). The learner fixes `app/Dockerfile` and `app/.dockerignore`.
3. **Harden and attack.** Six `docker exec` attack scripts against the learner's own container (`dkr-c12-target`). Starter: 6 of 6 succeed. A non-root user alone leaves 2 (`setuid-climb` through `doas`, and `fork-flood`). The reference stops all 6. A table that removes one setting at a time shows which control stops which attack and which ones overlap.
4. **SBOM, provenance, signature, gate.** Local registry, build and push with an SBOM and provenance, a throwaway cosign key pair made inside the run, sign and verify by digest, SBOM attestation, a moved tag that fails verification, a wrong key that fails verification. The learner writes the gate (`summarizeSbom`, `evaluate`) and pins a GitHub workflow to full commit hashes.

Tests:

| Part | Starter | Reference |
|---|---|---|
| 1 | 11 fail, 1 pass | 12 pass |
| 2 | 5 fail, 4 pass | 9 pass |
| 3 | 7 fail, 4 pass | 11 pass |
| 4 | 8 fail, 4 pass | 12 pass |

The tests that pass on every starter are structure checks (the README links the safety rules, nothing is left in Docker, the image builds).

## How the pins were chosen, and why they must be checked again

- **Scanner:** `aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c`. On 2026-11-05 the Docker Hub `latest` tag and `0.76.1` were the same image, pushed on 2026-10-21, seven months after the March 2026 compromise. Public write-ups name v0.69.4 as the poisoned binary (Barracuda's advisory also lists images up to v0.69.6) and name 0.69.2 and 0.69.3 as safe; `trivy-action` 0.0.1 to 0.34.2 and `setup-trivy` 0.2.0 to 0.2.6 are listed as affected. The digest is the multi-platform index digest printed by `docker buildx imagetools inspect aquasec/trivy:0.76.1`. Aqua's own advisory (GHSA-69fq-xp46-6x23) was **not** read. The Trivy signature on the image was **not** verified with cosign (it was not attempted). Both are left for the human gate. **Re-check the pin before publishing the chapter.**
- **cosign:** `ghcr.io/sigstore/cosign/cosign:v3.1.4@sha256:0f06154836d2de34f887a5c273506d52ca43edaa1d9e53e6510fa78a48f69c2d`. The index digest is the same on `gcr.io/projectsigstore/cosign:v3.1.4` and `ghcr.io/sigstore/cosign/cosign:v3.1.4`, which is a useful check in itself. The image has no shell.
- **SBOM generator:** `docker/buildkit-syft-scanner@sha256:873a7458...`. BuildKit pulls this by the moving tag `stable-1` if you do not name it. The part names it by digest with `--attest type=sbom,generator=...`.
- **Registry:** `registry:3` by tag only (about 21 MB). A digest pin would add nothing for a registry that only listens on the learner's own computer, but it is easy to add.
- **GitHub Actions:** the reference workflow pins five actions to commit hashes read with `gh api repos/<owner>/<repo>/commits/<tag> -q .sha` on 2026-11-05 (checkout v7.0.1, setup-buildx-action v4.4.1, login-action v4.7.0, build-push-action v7.4.0, cosign-installer v4.1.3). The workflow was not run. `aquasecurity/trivy-action` is removed; the scanner runs from its image by digest.

## Differences from the roadmap and the dossier

- **Download size.** The roadmap says about 130 MB plus the old image. The measured total is about 63.5 MB (scanner) + 67.1 MB (cosign) + 20.5 MB (registry) + 49.6 MB (SBOM generator) = about 200 MB of tools, plus the **vulnerability database: 138.7 MB to download and 1.69 GB on disk**. The database is the cost the dossier did not mention. Part 1 therefore works offline from saved real scans, says the cost in plain words, and makes the live scan optional (see the README).
- **The old image is never pulled into Docker.** The scanner reads `nginx:1.18-alpine` from the registry itself (about 10 MB). This also means no Docker socket is mounted anywhere in this challenge.
- **Old image choice.** `nginx:1.18-alpine` has fewer findings than `nginx:1.27-alpine` because Alpine 3.11 has little advisory data. Alpine 3.21.3 was reported end of life by the scanner on the day of the run (2026-11-05). Both facts are in the data, and the lesson uses them.
- **Memory caps above 64 MB.** The scanner has 1 GB (it maps the database). cosign has 256 MB because `generate-key-pair` is OOM-killed at 64 MB (exit 137). Everything else in the challenge has 64 MB or less.
- **`--tlog-upload=false`** needs `--use-signing-config=false` in cosign 3.1.4, and `verify` has no `--use-signing-config` flag. `--allow-http-registry` is needed for the local registry. All of this is in `run.mjs`.
- **Toolbox facts about the target.** busybox drops its setuid privileges for applets, so a setuid copy of busybox does not climb to root. The target uses `doas` instead. `busybox httpd` is in the `busybox-extras` package, not in the base busybox.

## Problems met

- The first trivy cache volume was labelled `dkr.challenge=12`, so `cleanup(12)` deleted it and the 139 MB database had to be downloaded again. The part now creates the cache with the label value `12-cache`, which `cleanup(12)` leaves alone. Remove it by hand when the challenge is finished: `docker volume rm dkr-c12-trivy-cache`.
- The database download needs about 300 MB of temporary space. A 256 MB tmpfs was too small; the script sends `TMPDIR` to the cache volume.
- A scan of a locally built image needs a tar file: the secret hunt in part 2 pipes `docker save` into a labelled volume (cleanup removes it) and the scanner reads it with `--input`.
- Docker Desktop crashed once during this work (not caused by the challenges). It came back later, after being restarted outside this work.

## Docker Desktop learner

See the box in each part README. The signing keys, the registry, the keys volume and the scan-in volume all live inside the Docker Desktop virtual machine. The cache volume counts about 1.7 GB there.

## Not done

- **Keyless signing and the public transparency log** (Sigstore) are not run here: they need a public identity provider. The local key pair shows the mechanism. The README says what to expect from a GitHub run.
- **The GitHub workflow was never run** (no pushes, no repository created). It is only checked for pins.
- **Docker Scout** and other scanners are not compared.
- **Reachability** of a finding is not computed. The policy approximates "runs at run time" with a list of package names.
- **A scan of the language packages** (for example Node dependencies) is not in the saved scans: the three images have only operating system packages.

## State when the work stopped

The scanner cache volume `dkr-c12-trivy-cache` (1.7 GB) was removed at the end to give the disk back. The saved scans in `part-1-scan-an-old-image/fixtures/` and the recorded `results.md` do not need it. To run the live scan again, use `run.mjs --live`: the database downloads again (71 s on the reference connection). The pulled tool images stay on the machine: the scanner, cosign, `registry:3` and the SBOM generator.
