// Start a new challenge from the challenge 0 pattern.
// Run: node tools/new_challenge.mjs <number> <name> <part-dir> [<part-dir> ...]
// Example:
//   node tools/new_challenge.mjs 3 dockerfile-review part-1-find-the-pid1-problem part-2-fix-the-signals
//
// For each part it writes README.md, run.mjs and test.mjs from tools/templates/.
// It never overwrites an existing part.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [numberArg, name, ...parts] = process.argv.slice(2);

const usage = 'Usage: node tools/new_challenge.mjs <number> <name> <part-dir> [<part-dir> ...]\nExample: node tools/new_challenge.mjs 3 dockerfile-review part-1-find-the-pid1-problem';
const number = Number(numberArg);
if (!Number.isInteger(number) || number < 0 || !name || parts.length === 0) {
  console.error(usage);
  process.exit(2);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error(`The challenge name must be lower case words joined by hyphens, got "${name}".`);
  process.exit(2);
}
const partPattern = /^part-(\d+)-[a-z0-9]+(-[a-z0-9]+)*$/;
for (const p of parts) {
  if (!partPattern.test(p)) {
    console.error(`Part folder "${p}" must look like part-1-short-name.`);
    process.exit(2);
  }
}

const challengeDir = `challenge-${number}-${name}`;
const templates = ['README.md', 'run.mjs', 'test.mjs'].map((f) => [f, readFileSync(join(root, 'tools', 'templates', `${f}.tpl`), 'utf8')]);
const titleOf = (partDir) => partDir.replace(/^part-\d+-/, '').replace(/-/g, ' ');

for (const partDir of parts) {
  const dir = join(root, 'challenges', challengeDir, partDir);
  if (existsSync(dir)) {
    console.error(`Already exists, not touching it: ${dir}`);
    process.exit(1);
  }
}

for (const partDir of parts) {
  const m = partDir.match(partPattern)[1];
  const dir = join(root, 'challenges', challengeDir, partDir);
  mkdirSync(dir, { recursive: true });
  const values = { N: String(number), M: m, CHALLENGE_DIR: challengeDir, PART_DIR: partDir, TITLE: titleOf(partDir) };
  for (const [file, text] of templates) {
    const out = text.replace(/@@([A-Z_]+)@@/g, (_, key) => values[key] ?? `@@${key}@@`);
    writeFileSync(join(dir, file), out);
  }
  console.log(`Created challenges/${challengeDir}/${partDir}/ (README.md, run.mjs, test.mjs)`);
}
console.log(`\nNext: edit run.mjs, then run it with --record. Rules: tools/NEW_CHALLENGE.md`);
