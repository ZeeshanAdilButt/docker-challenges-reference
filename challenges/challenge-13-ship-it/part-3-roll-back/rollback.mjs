// Rolling back means going to the release before the current one.
//
// history is the list of deployments on the host, oldest first. Each entry:
//   { version: "2.0.0", tag: "2.0.0", digest: "sha256:...", deployedAt: "2026-11-05T10:00:00Z" }
//
// Return what to deploy to go back one release:  { digest }  or  { tag }.
// STARTER: it goes back by tag. Is that safe?
export function rollbackTarget(history) {
  if (history.length < 2) throw new Error('there is no earlier release to go back to');
  const previous = history[history.length - 2];
  return { tag: previous.tag };
}
