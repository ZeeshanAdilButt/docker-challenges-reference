// Reads RUNBOOK.md. Each entry under "## Entries" starts with "### <title>" and has these fields:
//   - **Symptom:** ...   what a person sees
//   - **Check:** ...     the commands to run, in backticks
//   - **Cause:** ...     what is really wrong
//   - **Fix:** ...       what to do now
//   - **Prevention:** ... what stops it next time
//   - **Measured:** 4.1 s   the number from your own experiment
// There must be one entry for each experiment: kill, starve and misconfigure.

const KINDS = [
  { key: 'kill', re: /kill|crash/i },
  { key: 'starve', re: /starv|memory|oom/i },
  { key: 'misconfig', re: /misconfig|password|config/i },
];
const FIELDS = ['Symptom', 'Check', 'Cause', 'Fix', 'Prevention'];
const words = (s) => (s.match(/[A-Za-z0-9`]+/g) ?? []).length;

function field(block, name) {
  const m = new RegExp(`\\*\\*${name}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*[-*]\\s+\\*\\*[A-Za-z]+:\\*\\*|\\n###|$)`).exec(block);
  return m ? m[1].trim() : '';
}

/** measured: { kill, starve, misconfig } in seconds. Returns { entries, complete, numbersMatch, report }. */
export function parseRunbook(text, measured) {
  const section = text.split(/^## Entries\s*$/m)[1] ?? '';
  const blocks = section.split(/^### /m).slice(1);
  const used = new Set();
  const entries = [];
  for (const block of blocks) {
    const title = block.split('\n')[0].trim();
    const kind = KINDS.find((k) => !used.has(k.key) && k.re.test(title));
    if (!kind) continue;
    used.add(kind.key);
    const values = Object.fromEntries(FIELDS.map((n) => [n, field(block, n)]));
    const missing = FIELDS.filter((n) => words(values[n]) < 4);
    if (!/`[^`]+`/.test(values.Check)) missing.push('Check (needs a command in backticks)');
    const m = /\*\*Measured:\*\*\s*([\d.]+)\s*s\b/.exec(block);
    const number = m ? Number(m[1]) : NaN;
    if (Number.isNaN(number)) missing.push('Measured (needs a number and the unit s)');
    const want = measured[kind.key];
    const matches = !Number.isNaN(number) && typeof want === 'number' && Math.abs(number - want) <= Math.max(2, 0.5 * want);
    entries.push({ kind: kind.key, title, missing, number, want, matches, complete: missing.length === 0 });
  }
  const complete = entries.filter((e) => e.complete).length;
  const numbersMatch = KINDS.every((k) => entries.find((e) => e.kind === k.key)?.matches);
  const report = entries.map((e) => `${e.kind.padEnd(9)} "${e.title.slice(0, 40)}"  ${e.complete ? 'complete' : `missing: ${e.missing.join(', ')}`}   measured ${Number.isNaN(e.number) ? '-' : e.number} s, experiment ${e.want} s${e.matches ? '' : '  (does not match)'}`);
  for (const k of KINDS) if (!used.has(k.key)) report.push(`${k.key.padEnd(9)} no entry found`);
  return { entries, complete, numbersMatch, report };
}
