// Facts are the numbers a challenge measured. They live in facts.json at the repo root.
// Names look like c<N>.p<M>.<what>_<unit>, for example c3.p2.image_mb.
// Writes are atomic: we write a temp file, then rename it over facts.json.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where facts.json lives. Set DKR_FACTS_PATH to use another file (tests do this). */
export function factsPath() {
  return process.env.DKR_FACTS_PATH || join(root, 'facts.json');
}

const NAME = /^c\d+\.p\d+\.[a-z0-9_]+$/;

function readAll() {
  const file = factsPath();
  if (!existsSync(file)) return {};
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

/** Save one fact. The value must be a number, a string or a boolean. */
export function setFact(factName, value) {
  if (!NAME.test(factName)) {
    throw new Error(`Bad fact name "${factName}". Use c<N>.p<M>.<what>_<unit>, for example c0.p2.image_mb.`);
  }
  if (!['number', 'string', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(`Fact "${factName}" needs a number, a string or a boolean.`);
  }
  const all = readAll();
  all[factName] = value;
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  const file = factsPath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Read one fact. Returns undefined if it was never written. */
export function getFact(factName) {
  return readAll()[factName];
}
