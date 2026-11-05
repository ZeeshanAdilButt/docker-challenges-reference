// Challenge 11, part 2: services that run but cannot be used.
// Run:  node challenges/challenge-11-broken-containers/part-2-runs-but-unreachable/run.mjs
// Options: --answer-key  also run the diagnosis ladder on what you have (spoilers)
//          --reference   run the fixed services from reference/
//          --record      starter symptoms, ladder and reference together; writes results.md and chart.svg
//
// Every service is a small compose project named dkr-c11-... and labelled dkr.challenge=11, with a
// memory, process and log cap. Host ports are bound to 127.0.0.1 only. It all comes down again at the end.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPart } from '../part.mjs';

await runPart({ here: dirname(fileURLToPath(import.meta.url)), part: 2, ids: ['05-port-clash', '06-bad-healthcheck', '07-dns-typo'], title: 'services that run but cannot be used' });
