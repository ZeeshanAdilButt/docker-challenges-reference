# Challenge 12, part 1: scan an old image and read the result

**Time:** about 40 minutes offline, about 60 with the live scan. **Download:** none for the offline path. The live path costs **about 63 MB for the scanner and 139 MB for its vulnerability database, and the database takes 1.7 GB on disk** (details below). **Safety rules:** [SAFETY.md](../../../SAFETY.md)

## The problem

A scanner prints "214 findings" and the room goes quiet. Is the image safe to ship? Is it a disaster? Does anyone know? A count is easy to read and hard to use. Two images with the same count can differ a hundred times in risk. Two images with very different counts can be the other way round. You need to sort the findings by what you can do about them, and you need to know what the scanner could and could not see.

There is a second problem, from March 2026. A popular scanner, its GitHub Action and its setup action were poisoned: for about 12 hours they stole the secrets of the pipelines that ran them. So before you scan anything, decide how you trust the scanner itself. Here the scanner is named by its **digest**, not by a tag.

## The idea

A vulnerability scanner does three things. It lists what is in the image (operating system packages and language packages). It downloads a **database** of known flaws (CVEs) and the versions that fix them. It matches the two. So a scan result is only as good as two things: how well the scanner can read the image, and how complete the database is for that operating system on that day.

Read every finding with four questions.

| Question | Why it matters |
|---|---|
| Is there a fix? (`FixedVersion`) | A finding with no fix is something to watch, not to fix. A finding with a fix is a job. |
| How severe is it? | CRITICAL and HIGH first. But severity is the score of the flaw in general, not in your use of it. |
| Where is it? A package your service uses at run time, or one that only sits in the image? | A flaw in the web server's TLS library matters more than one in a tool nobody runs. |
| Is the scanner blind here? | An end-of-life base gets fewer advisories. A low count there means "no data", not "safe". |

You will do this with three real images: an old one (`nginx:1.18-alpine`, built in 2021), a year-old one (`nginx:1.27-alpine`) and a current base (`alpine:3.23`). In `fixtures/` you have a real scan of each. You write the triage code in `triage.mjs`: count, classify each finding as **fix now**, **plan** or **accept**, and give a verdict against `policy.json`.

## What the live scan costs, plainly

| What | Download | On disk | Needed for |
|---|---|---|---|
| Scanner image `aquasec/trivy`, pinned by digest | 63.5 MB | 263 MB | `--live` |
| Vulnerability database | **138.7 MB** | **about 1.7 GB** | `--live`, once |
| `nginx:1.18-alpine` and `nginx:1.27-alpine` | read by the scanner from the registry, about 10 and 20 MB | in the scanner's cache | `--live` |

If your data is weak or your disk is small, **skip the live scan**. The default path works with the saved scans in `fixtures/` and downloads nothing. The recorded output of a live scan is in [results.md](results.md), so you lose nothing you need to read.

If you do run it: the database is downloaded **once** into a Docker volume called `dkr-c12-trivy-cache`. That volume is kept between runs (its label is `dkr.challenge=12-cache`, so `node toolkit/cleanup.mjs 12` does **not** remove it). Every later run uses it with `--skip-db-update`, so no download happens. When you are finished with the whole challenge, free the 1.7 GB with `docker volume rm dkr-c12-trivy-cache`. The scanner container is the only container in this course allowed 1 GB of memory instead of 64 MB, because it maps the database into memory.

## Steps

| # | Command | What happens |
|---|---|---|
| 1 | `node --test challenges/challenge-12-scan-harden-sign/part-1-scan-an-old-image/test.mjs` | Eleven tests **fail** on purpose: `triage.mjs` has three empty functions. No Docker needed. |
| 2 | Read [fixtures/old.json](fixtures/old.json) and `policy.json`. | A trimmed Trivy report: each finding has a package, an installed version, a fixed version and a severity. |
| 3 | Write `summarize`, `classify` and `verdict` in `triage.mjs`. The rules are in the comments above each function. | Start with `summarize`. |
| 4 | `node challenges/challenge-12-scan-harden-sign/part-1-scan-an-old-image/run.mjs` | Runs your triage on the three saved scans and prints the numbers. Offline. |
| 5 | `node toolkit/show-facts.mjs c12.p1` | Shows the saved numbers. |
| 6 | `node --test challenges/challenge-12-scan-harden-sign/part-1-scan-an-old-image/test.mjs` | All tests pass. |
| 7 | Optional: `node challenges/challenge-12-scan-harden-sign/part-1-scan-an-old-image/run.mjs --live` | Pulls the pinned scanner, downloads the database once, scans the three images for real, and times each scan (median of 3). Add `--update-fixtures` to replace the saved scans with yours. |

## What you should see

Offline, with a correct `triage.mjs`:

| Image | Findings | Critical | High | Fix now | Verdict |
|---|---|---|---|---|---|
| `nginx:1.18-alpine` (2021) | 51 | 6 | 29 | 8 | FAIL (and its OS is end of life) |
| `nginx:1.27-alpine` | 216 | 3 | 60 | 25 | FAIL |
| `alpine:3.23` | 0 | 0 | 0 | 0 | PASS |

The old image has **fewer** findings than the year-old one. That is the point of the part. Its base, Alpine 3.11, stopped getting security advisories long ago, so the database has little to say about it. The scanner is partly blind. Do not read 51 as "better". The saved scans are from one day's database (see `db_updated_at` in the facts). On another day the numbers differ.

Your verdict also names the worst packages, for example `libcrypto3 3.3.3-r0 -> 3.3.7-r0` in the year-old image: one package update clears many findings at once. That is the usual shape of the work: most of a long list is a few packages.

The full recorded run, including the real scanner table, is in [results.md](results.md).

![Findings per image: a count is not a risk](chart.svg)

## How the scanner was chosen (and why you must check again)

`aquasec/trivy:0.76.1@sha256:790fd66d...` is in `lib.mjs` as `TRIVY`. How it was chosen: on 2026-11-05 it was the `latest` tag on Docker Hub, pushed on 2026-10-21, seven months after the poisoned releases of March 2026 (the affected versions named in public reports are v0.69.4, and per one report images up to v0.69.6). The digest is the one `docker buildx imagetools inspect aquasec/trivy:0.76.1` prints for the multi-platform index. The vendor's own advisory was not read for this challenge, so **treat the pin as something to re-check**: read the vendor's current advisory, compare the digest again, and update the pin on purpose, never by moving a tag.

## Where each number comes from

| Fact | Where it comes from |
|---|---|
| `c12.p1.scanner_image_packed_mb` | Sum of the layer sizes of the amd64 manifest of the pinned scanner image. |
| `c12.p1.scanner_image_disk_mb` | `docker image inspect` field `Size`, divided by one million. |
| `c12.p1.scanner_digest` | The digest in `lib.mjs`. |
| `c12.p1.db_download_mb` | Layer size of `mirror.gcr.io/aquasec/trivy-db:2`. |
| `c12.p1.db_disk_mb` | Size of `trivy.db` in the cache volume. |
| `c12.p1.db_download_s` | Time of `trivy image --download-db-only` on the reference machine (first run only). |
| `c12.p1.db_updated_at` | `UpdatedAt` in the database's `metadata.json`. |
| `c12.p1.<image>_total`, `_critical`, `_high`, `_fixable` | From `triage.summarize` on the saved scan. Images: `old`, `year_old`, `current`. |
| `c12.p1.<image>_fix_now`, `_pass`, `_end_of_life` | From `triage.verdict` and `summarize`. |
| `c12.p1.<image>_scan_s` | Median of three live scans with the cached database, in seconds. Only written by `--live`. |

## What is different on Docker Desktop

- The cache volume and the scanner live inside Docker Desktop's Linux virtual machine. The 1.7 GB counts against the virtual machine's disk, not your computer's free space directly. If Docker Desktop's disk is nearly full, free some first.
- The scanner reads images from the registry itself, so it needs no access to the Docker socket. We do not mount the socket.
- Scan times depend on your connection for the first image pull into the scanner's cache and on your CPU after that.

## Stuck?

- `Docker is not ready` (only with `--live`): start Docker and wait until it says running.
- The database download fails with "no space left on device": the script uses the volume for temporary files. Check that the Docker disk has 2 GB free.
- A test says a number is wrong: the message shows the field. `fixable` counts findings with a non-empty `FixedVersion`.
- Something is left over from a crashed run: `node toolkit/cleanup.mjs 12`.

## Next

Part 2 hunts secrets that scanners do not catch.
