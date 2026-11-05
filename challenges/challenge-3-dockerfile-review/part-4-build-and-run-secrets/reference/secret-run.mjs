// Part 4 reference: give the key to the container as a read-only file, and tell the app where it is.

export function runArgs(secretFile) {
  return ['--mount', `type=bind,src=${secretFile},dst=/run/secrets/api_key,readonly`, '-e', 'API_KEY_FILE=/run/secrets/api_key'];
}
