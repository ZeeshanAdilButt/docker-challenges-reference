// Part 1 test. Run: node --test challenges/challenge-14-capstone/part-1-containerize/test.mjs
// It reads the numbers run.mjs saved from your Dockerfiles and compose.yaml, one test for each rubric line of this part.
// The first run fails on purpose. Each message says what is wrong and how to fix it.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rubricTests } from '../rubric-tests.mjs';

rubricTests(1, dirname(fileURLToPath(import.meta.url)), 'Run: node challenges/challenge-14-capstone/part-1-containerize/run.mjs');
