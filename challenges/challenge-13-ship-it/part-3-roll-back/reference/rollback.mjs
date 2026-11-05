// Rolling back means going to the release before the current one, by DIGEST.
// A tag can be moved after you deployed (a re-push, a hot fix, a mistake). A digest cannot.
// history is the list of deployments on the host, oldest first:
//   { version, tag, digest, deployedAt }
// The previous release is the latest entry whose digest is not the one that runs now, so a rollback that was
// itself rolled back does not send you to the same image twice.
export function rollbackTarget(history) {
  if (history.length < 2) throw new Error('there is no earlier release to go back to');
  const current = history[history.length - 1];
  const previous = [...history].reverse().find((h) => h.digest !== current.digest);
  if (!previous) throw new Error('every deployment in the history is the same image');
  return { digest: previous.digest };
}
