// Checks of DEFENCE.md and PROBES.md. Plain text rules, no AI: a mentor still reads the words.
// What these rules can tell: the shape is right, the length is right, the numbers are your own, and each answer touches
// the ideas the question is about. They cannot tell whether the answer is good. That is the mentor's job.

import { getFact } from '../../../toolkit/facts.js';

export const SECTIONS = ['Before and after', 'The pipeline', 'The deploy', 'One failure', 'At ten times the team'];

// Lines that only hold a template prompt, such as "(sizes, build times ...)", are not words of the learner.
const stripPrompts = (s) => s.split(/\r?\n/).filter((l) => !/^\s*\(.*\)\s*$/.test(l)).join('\n');
const words = (s) => (s.match(/[A-Za-z0-9][A-Za-z0-9'.-]*/g) ?? []).length;

/** The facts a defence can quote, with the unit that follows the number in the text. */
export const QUOTABLE = [
  ['c14.p1.api_size_mb', /MB/i], ['c14.p1.worker_size_mb', /MB/i], ['c14.p1.web_size_mb', /MB/i],
  ['c14.p1.api_build_cold_s', /s(ec(onds?)?)?\b/i], ['c14.p1.api_edit_rebuild_s', /s(ec(onds?)?)?\b/i], ['c14.p1.compose_up_s', /s(ec(onds?)?)?\b/i],
  ['c14.p2.first_deploy_s', /s(ec(onds?)?)?\b/i], ['c14.p2.rollout_s', /s(ec(onds?)?)?\b/i], ['c14.p2.rollback_s', /s(ec(onds?)?)?\b/i],
  ['c14.p3.kill_recovery_s', /s(ec(onds?)?)?\b/i], ['c14.p3.starve_recovery_s', /s(ec(onds?)?)?\b/i], ['c14.p3.misconfig_detect_s', /s(ec(onds?)?)?\b/i],
];

export function checkDefence(text) {
  const sections = SECTIONS.filter((name) => new RegExp(`^##\\s+${name}\\s*$`, 'im').test(text));
  const body = stripPrompts(text.replace(/^#{1,6}\s.*$/gm, ''));
  const wordCount = words(body);
  // numbers followed by a unit
  const spoken = [...body.matchAll(/(\d+(?:\.\d+)?)\s*(MB|seconds?|secs?|s|ms)\b/gi)].map((m) => ({ n: Number(m[1]), unit: m[2] }));
  const matched = [];
  for (const [name, unitRe] of QUOTABLE) {
    const v = getFact(name);
    if (typeof v !== 'number') continue;
    const tol = Math.max(0.6, 0.25 * v);
    if (spoken.some((s) => unitRe.test(s.unit) && Math.abs(s.n - v) <= tol)) matched.push(name);
  }
  return { sections: sections.length, words: wordCount, matched, possible: QUOTABLE.filter(([n]) => typeof getFact(n) === 'number').length };
}

export const PROBES = [
  { heading: 'Probe 1', question: 'Why do you deploy by digest and not by tag?', need: [/digest/i, /\btags?\b/i, /(move|moved|mutable|changes?|re-?push)/i], needText: 'digest, tag, and why a tag is not safe' },
  { heading: 'Probe 2', question: 'Your rollback is quick. What does it not undo?', need: [/(schema|database|data|migration)/i, /(expand|contract|two steps|two-step|backward|old code|older)/i], needText: 'the database or schema, and how a change is made safe for the old version' },
  { heading: 'Probe 3', question: 'How do you know the image that runs in production is the one your CI built?', need: [/(digest|sign|signature|provenance|sbom|attest)/i, /(registry|pipeline|CI|build)/i], needText: 'the digest or a signature, and the pipeline or registry' },
  { heading: 'Troubleshooting', question: 'The api container restarts every 20 seconds. What do you do, in order?', need: [/docker (logs|inspect|ps|events|compose logs)/i, /(exit code|\b137\b|oom|restart ?count|health ?check|\/ready)/i], needText: 'a docker command, and what you look for (exit code, OOM, health check)' },
];

export function checkProbes(text) {
  const chunks = text.split(/^##\s+/m).slice(1);
  return PROBES.map((p) => {
    const chunk = chunks.find((c) => c.toLowerCase().startsWith(p.heading.toLowerCase())) ?? '';
    const answer = stripPrompts(chunk.split('\n').slice(1).join('\n'));
    const count = words(answer);
    const missing = p.need.filter((re) => !re.test(answer));
    const problems = [];
    if (count < 60) problems.push(`${count} words, at least 60 needed`);
    if (count > 200) problems.push(`${count} words, at most 200`);
    if (missing.length) problems.push(`does not mention: ${p.needText}`);
    return { heading: p.heading, question: p.question, words: count, ok: problems.length === 0, problems };
  });
}
