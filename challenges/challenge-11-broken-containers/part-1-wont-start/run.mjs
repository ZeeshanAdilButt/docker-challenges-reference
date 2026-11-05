// Challenge 11, part 1: services that will not start.
// Run:  node challenges/challenge-11-broken-containers/part-1-wont-start/run.mjs
// Options: --answer-key  also run the diagnosis ladder on what you have (spoilers)
//          --reference   run the fixed services from reference/
//          --record      starter symptoms, ladder and reference together; writes results.md and chart.svg
//
// Every service is a small compose project named dkr-c11-... and labelled dkr.challenge=11, with a
// memory, process and log cap. Host ports are bound to 127.0.0.1 only. It all comes down again at the end.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPart } from '../part.mjs';

await runPart({ here: dirname(fileURLToPath(import.meta.url)), part: 1, ids: ['01-wrong-entrypoint', '02-missing-env', '03-volume-permission', '04-exit-137'], title: 'services that will not start' });
