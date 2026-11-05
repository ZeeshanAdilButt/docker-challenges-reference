// The original way, kept for the "before" numbers: the key goes in an environment variable. Do not edit.
//
// check-secret.mjs (inside the image) looks for the key in two places:
//   API_KEY_FILE   the path of a file that holds the key        (source "file")
//   API_KEY        the key itself, as an environment variable    (source "env")
//
// Write runArgs(secretFile). `secretFile` is the path of a file on your computer that holds the key.
// Return the list of docker run flags that give the key to the container.
// The test starts the container with your flags and checks `docker inspect`: the key must not be in the
// container's environment or in the flags themselves, and the file must be mounted read-only.
//
// Hint: --mount type=bind,src=<file>,dst=<path in the container>,readonly   and   -e NAME=value

import { readFileSync } from 'node:fs';

export function runArgs(secretFile) {
  // The starter passes the key as an environment variable. docker inspect shows every environment variable.
  return ['-e', `API_KEY=${readFileSync(secretFile, 'utf8').trim()}`];
}
