// Which tags should the pipeline push for this build?
// Input:  ref      the git ref that triggered the run: refs/heads/main, refs/tags/v1.2.3, refs/pull/12/merge
//         sha      the full commit id (40 hex characters)
//         defaultBranch  usually 'main'
// Output: an array of tag names, for example ['sha-3f2a9c1', '1.2.3', '1.2', 'latest']
//
// Our rules:
//   every build           sha-<first 7 characters of the commit>   (the tag you trace an incident with)
//   branch push           the branch name, with / turned into -     (moves with every push: for test environments)
//   pull request          pr-<number>   (and never anything that looks like a release)
//   release tag vX.Y.Z    X.Y.Z, X.Y, and latest
//   pre-release vX.Y.Z-rc.1   only X.Y.Z-rc.1 (no X.Y, no latest)
export function tagsFor({ ref, sha, defaultBranch = 'main' }) {
  void defaultBranch; // the default branch is just a branch here; release tags decide `latest`
  const tags = [`sha-${sha.slice(0, 7)}`];
  const branch = /^refs\/heads\/(.+)$/.exec(ref);
  const pull = /^refs\/pull\/(\d+)\//.exec(ref);
  const release = /^refs\/tags\/v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(ref);
  if (branch) tags.push(branch[1].replace(/\//g, '-'));
  if (pull) tags.push(`pr-${pull[1]}`);
  if (release) {
    const [, major, minor, patch, pre] = release;
    tags.push(`${major}.${minor}.${patch}${pre ?? ''}`);
    if (!pre) tags.push(`${major}.${minor}`, 'latest');
  }
  return tags;
}
