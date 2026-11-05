// Turns the criteria of one part into node:test tests, so the rubric is a test suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { leftovers, run } from '../../toolkit/docker.js';
import { CRITERIA, evaluate, score } from './rubric.mjs';

export function rubricTests(part, partDir, runHint) {
  for (const c of CRITERIA.filter((x) => x.part === part)) {
    test(`${c.area}: ${c.title} (${c.points} points)`, (t) => {
      const r = evaluate(c);
      if (r.status === 'pending') return t.skip(`pending: ${r.detail}`);
      if (r.status === 'not run') assert.fail(`${r.detail}. ${runHint}`);
      assert.equal(r.status, 'pass', `${r.detail}. How: ${c.hint}`);
    });
  }

  if (part === 4) {
    test('the whole rubric: 80 percent or more of the points that can be earned today', () => {
      const s = score();
      const failing = s.rows.filter((r) => r.status === 'fail' || r.status === 'not run').map((r) => '  - ' + r.id + ': ' + r.detail);
      console.log('Rubric score: ' + s.earned + ' of ' + s.available + ' points, ' + s.percent + ' percent' + (s.pending.length ? ' (' + s.pending.length + ' pending until challenge 12)' : ''));
      assert.ok(s.percent >= 80, `Score ${s.percent} percent. Still failing:\n${failing.join('\n')}`);
    });
  }

  test('chart.svg is an accessible chart and the README links the safety rules', () => {
    const svg = readFileSync(join(partDir, 'chart.svg'), 'utf8');
    assert.match(svg, /role="img"/);
    assert.match(svg, /<desc id="d">/);
    const readme = readFileSync(join(partDir, 'README.md'), 'utf8');
    assert.match(readme, /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
  });

  test('live: the run cleaned up after itself', { skip: run(['version']).code !== 0 && 'Docker is not running' }, () => {
    assert.deepEqual(leftovers(14), { containers: 0, networks: 0, volumes: 0 }, 'Something labelled dkr.challenge=14 is still there. Run: node toolkit/cleanup.mjs 14');
    assert.notEqual(run(['context', 'inspect', 'dkr-c14-prod']).code, 0, 'The Docker context dkr-c14-prod is still there. Run: docker context rm -f dkr-c14-prod');
  });
}
