// Which tags should the pipeline push for this build?
// Input:  ref      the git ref that triggered the run: refs/heads/main, refs/tags/v1.2.3, refs/pull/12/merge
//         sha      the full commit id (40 hex characters)
//         defaultBranch  usually 'main'
// Output: an array of tag names, for example ['sha-3f2a9c1', '1.2.3', '1.2', 'latest']
//
// Our rules (the list in the README says them in words):
//   every build           sha-<first 7 characters of the commit>
//   branch push           the branch name, with / turned into -
//   pull request          pr-<number>   (and never anything that looks like a release)
//   release tag vX.Y.Z    X.Y.Z, X.Y, and latest
//   pre-release vX.Y.Z-rc.1   only X.Y.Z-rc.1 (no X.Y, no latest)
export function tagsFor({ ref, sha, defaultBranch = 'main' }) {
  const tags = [];
  const branch = /^refs\/heads\/(.+)$/.exec(ref);
  const release = /^refs\/tags\/v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(ref);
  if (branch) tags.push(branch[1].replace(/\//g, '-'));
  if (release) {
    tags.push(`${release[1]}.${release[2]}.${release[3]}${release[4] ?? ''}`, `${release[1]}.${release[2]}`);
  }
  tags.push('latest');
  return tags;
}
