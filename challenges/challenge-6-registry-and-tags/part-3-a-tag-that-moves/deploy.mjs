// How a server decides what to run, and what to run after a bad release.
// run.mjs calls these two functions. Read it, then fix them. Do not edit run.mjs.
//
// A release is a plain object:
//   { registry: '127.0.0.1:50321', repo: 'dkr-c6/daftar-api', tag: '1.4', digest: 'sha256:...', version: '1.4.0' }
// `releases` is the history, oldest first. The last one is the release that is running now.

/** The image reference a server passes to `docker run`. */
export function imageRef(release) {
  return `${release.registry}/${release.repo}:${release.tag}`;
}

/** The release to go back to when the newest release is bad. */
export function rollbackTarget(releases) {
  return releases[releases.length - 1];
}
