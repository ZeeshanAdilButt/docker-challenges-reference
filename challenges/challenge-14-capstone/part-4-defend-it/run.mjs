// Challenge 14, part 4: defend it. Check your defence and your answers, then score the whole capstone.
// Run: node challenges/challenge-14-capstone/part-4-defend-it/run.mjs
// Add --record to also write results.md and chart.svg next to this file.
// Add --reference to run against the reference DEFENCE.md and PROBES.md (for maintainers).
//
// No Docker needed: it reads DEFENCE.md and PROBES.md, compares your numbers with facts.json
// (the numbers parts 1 to 3 measured on your machine), and prints the rubric table.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Recorder } from '../../../toolkit/record.js';
import { barsSvg } from '../../../toolkit/bars.js';
import { AREAS, score } from '../rubric.mjs';
import { clearFacts, clip, saveFacts, sysText } from '../lib.mjs';
import { checkDefence, checkProbes } from './check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const record = process.argv.includes('--record');
const rec = new Recorder('Challenge 14, part 4: defend it');
const facts = {};
const f = (name, v) => (facts[`c14.p4.${name}`] = v);
const pad = (s, n) => String(s).padEnd(n);

try {
  clearFacts('c14.p4.');
  // Step 1: the walkthrough.
  const d = checkDefence(sysText('DEFENCE.md'));
  f('defence_words_count', d.words);
  f('defence_sections_count', d.sections);
  f('defence_numbers_matched_count', d.matched.length);
  f('defence_numbers_possible_count', d.possible);
  rec.step(
    'read DEFENCE.md: the five sections, the words, and the numbers followed by a unit that match facts.json',
    [
      `sections found: ${d.sections} of 5   words: ${d.words} (about ${Math.round(d.words / 150 * 10) / 10} minutes at 150 words a minute; the range is 300 to 800)`,
      `numbers quoted from your own facts: ${d.matched.length} of ${d.possible} that could be quoted`,
      ...d.matched.map((m) => `  ${m}`),
    ].join('\n'),
    d.sections === 5 && d.words >= 300 && d.words <= 800 && d.matched.length >= 6 ? 'The shape is right and the numbers are yours. A mentor will check that the words are true.' : 'Not finished: five sections, 300 to 800 words, at least six numbers from your own run, each with its unit.',
  );

  // Step 2: the probes.
  const probes = checkProbes(sysText('PROBES.md'));
  f('probes_total_count', probes.length);
  f('probes_ok_count', probes.filter((p) => p.ok).length);
  rec.step(
    'read PROBES.md: three probes and one troubleshooting question, 60 to 200 words each, each on the point',
    probes.map((p) => `${pad(p.heading, 16)} ${String(p.words).padStart(3)} words  ${p.ok ? 'ok' : `NOT YET: ${p.problems.join('; ')}`}`).join('\n'),
    facts['c14.p4.probes_ok_count'] === probes.length ? 'Each answer is the right length and names the ideas the question is about. The mentor decides whether it is good.' : 'Read the question again, and answer what it asks. Name the command or the setting.',
  );

  saveFacts(facts);

  // Step 3: the whole rubric.
  const s = score();
  const lines = s.rows.map((r) => `${pad(r.status, 8)} ${String(r.points).padStart(2)}  ${pad(r.area, 15)} ${r.title.slice(0, 78)}${r.status === 'fail' || r.status === 'not run' ? `\n           -> ${r.detail}` : ''}`);
  rec.step(
    'score the rubric from facts.json:  six areas, one line for each criterion',
    clip(lines.join('\n'), 25),
    `Score: ${s.earned} of ${s.available} points available, ${s.percent} %.${s.pending.length ? ` ${s.pending.length} criteria are pending until challenge 12 gives you scan, SBOM and signing tools; they are not counted.` : ''} The pass mark is 80 %.`,
  );
  rec.step(
    'the score for each area',
    AREAS.map((a) => `${pad(a, 16)} ${String(s.byArea[a].earned).padStart(3)} of ${String(s.byArea[a].available).padStart(3)}`).join('\n'),
    'A mentor reads the same six areas in under 45 minutes, then asks one to three follow-up probes.',
  );
  f('rubric_percent', s.percent);
  f('rubric_points_earned', s.earned);
  f('rubric_points_available', s.available);
  f('rubric_pending_count', s.pending.length);
  saveFacts(facts);

  if (record) {
    rec.write(join(here, 'results.md'), `${process.platform}, Node ${process.versions.node}`);
    writeFileSync(
      join(here, 'chart.svg'),
      barsSvg({
        title: 'Rubric points earned by area (of the points available)',
        unit: 'points',
        bars: AREAS.map((a) => ({ label: `${a} (of ${s.byArea[a].available})`, value: s.byArea[a].earned })),
      }),
    );
    console.log('\nWrote results.md and chart.svg');
  }
  console.log(`\nRubric: ${s.earned} of ${s.available} points, ${s.percent} %. Pass mark 80 %.`);
  console.log('See your numbers with: node toolkit/show-facts.mjs c14.p4');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  process.exitCode = 1;
}
