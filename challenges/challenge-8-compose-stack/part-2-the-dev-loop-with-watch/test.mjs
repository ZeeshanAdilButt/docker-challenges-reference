// Challenge 8, part 2 test.
// Run: node --test challenges/challenge-8-compose-stack/part-2-the-dev-loop-with-watch/test.mjs
// It fails until compose.yaml has a fast watch setup and run.mjs has been run. That is on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { leftovers, run } from '../../../toolkit/docker.js';
import { getFact } from '../../../toolkit/facts.js';
import { filesDir } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hint = 'Run: node challenges/challenge-8-compose-stack/part-2-the-dev-loop-with-watch/run.mjs';
const dockerDown = run(['version']).code !== 0 && 'Docker is not running';

function watchRules() {
  const r = run(['compose', '-f', join(filesDir(here), 'compose.yaml'), 'config', '--format', 'json'], { env: { API_PORT: '41001' } });
  assert.equal(r.code, 0, `compose.yaml is not valid: ${r.stderr}`);
  const svc = JSON.parse(r.stdout).services.api;
  return { rules: svc.develop?.watch ?? [], command: svc.command };
}

test('static check: source changes are copied in (sync), not rebuilt; package.json still rebuilds', { skip: dockerDown }, () => {
  const { rules } = watchRules();
  const src = rules.find((w) => /app[\\/]src[\\/]?$/.test(w.path));
  assert.ok(src, 'No watch rule for app/src');
  assert.ok(['sync', 'sync+restart'].includes(src.action), `app/src uses action "${src.action}". Copying the file into the running container is much faster than building a new image: use sync (or sync+restart).`);
  assert.equal(src.target, '/app/src', 'A sync rule needs target: /app/src, the folder the image copied the source to.');
  const pkg = rules.find((w) => /package\.json$/.test(w.path));
  assert.ok(pkg && pkg.action === 'rebuild', 'package.json changes need a rebuild: new dependencies are installed at build time.');
});

test('static check: with plain "sync", something inside the container must restart the server', { skip: dockerDown }, () => {
  const { rules, command } = watchRules();
  const src = rules.find((w) => /app[\\/]src[\\/]?$/.test(w.path));
  if (src?.action === 'sync') {
    assert.ok(Array.isArray(command) && command.some((c) => c.startsWith('--watch')), 'action: sync only copies the file. Run the server with node --watch-path=src (command: ["node", "--watch-path=src", "src/server.mjs"]) so it reloads, or use sync+restart.');
  }
});

test('your edit shows up fast, and the comparison ran (facts from run.mjs)', () => {
  assert.equal(getFact('c8.p2.your_edit_reloaded'), true, `The change never showed up. ${hint}`);
  assert.ok(getFact('c8.p2.your_edit_to_reload_ms') < 0.5 * getFact('c8.p2.rebuild_edit_to_reload_ms'), `Your loop is not at least twice as fast as a rebuild (${getFact('c8.p2.your_edit_to_reload_ms')} ms against ${getFact('c8.p2.rebuild_edit_to_reload_ms')} ms). ${hint}`);
  assert.equal(getFact('c8.p2.package_json_triggers_rebuild'), true, `A package.json change did not rebuild the image. ${hint}`);
  assert.equal(getFact('c8.p2.sync_only_reloaded'), false, 'sync alone should not reload the server');
});

test('nothing with the challenge label is left in Docker', () => {
  assert.deepEqual(leftovers(8), { containers: 0, networks: 0, volumes: 0 });
});

test('the README links the safety rules', () => {
  assert.match(readFileSync(join(here, 'README.md'), 'utf8'), /\(\.\.\/\.\.\/\.\.\/SAFETY\.md\)/);
});

test('results.md and chart.svg exist after a recorded run', () => {
  assert.ok(existsSync(join(here, 'results.md')), 'Run run.mjs with --record to write results.md');
  assert.ok(existsSync(join(here, 'chart.svg')), 'Run run.mjs with --record to write chart.svg');
});
