// Print the facts that start with a prefix.
// Run: node toolkit/show-facts.mjs c0.p1      (or no prefix for all facts)

import { readFileSync, existsSync } from 'node:fs';
import { factsPath } from './facts.js';

const prefix = process.argv[2] ?? '';
const file = factsPath();
const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8') || '{}') : {};
const shown = Object.entries(all).filter(([k]) => k.startsWith(prefix));
if (shown.length === 0) console.log(`No facts start with "${prefix}". Run the part's run.mjs first.`);
for (const [k, v] of shown) console.log(`${k} = ${v}`);
