// Part 4 test. Run: node --test challenges/challenge-14-capstone/part-4-defend-it/test.mjs
// It reads the numbers run.mjs saved, one test for each rubric line of this part. The first run fails on purpose.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rubricTests } from '../rubric-tests.mjs';

rubricTests(4, dirname(fileURLToPath(import.meta.url)), 'Run: node challenges/challenge-14-capstone/part-4-defend-it/run.mjs');
