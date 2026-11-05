// The capstone rubric, as code. A mentor reads the same list in chapter 15.1.
//
// Six areas: images, build and cache, run and recover, security, evidence, communication.
// Every criterion has a number of points, the part that measures it, and a hint that says what to do when it fails.
// A criterion that needs a tool from challenge 12 (scan, SBOM, signature) is "pending" until that tool is wired in:
// it is listed, it earns nothing and it does not count against you yet.
//
// Each part's test.mjs runs the criteria of that part. Part 4's test.mjs runs the communication criteria and prints the score.

import { getFact } from '../../toolkit/facts.js';

export const TARGETS = {
  api_size_mb: 300,
  worker_size_mb: 220,
  web_size_mb: 100,
  stop_s: 3,
  compose_up_s: 60,
  rollback_s: 120,
  kill_recovery_s: 20,
  misconfig_detect_s: 30,
};

export const AREAS = ['images', 'build and cache', 'run and recover', 'security', 'evidence', 'communication'];
const SERVICES = ['api', 'worker', 'web'];

const fact = (part, name) => getFact(`c14.p${part}.${name}`);
const all = (part, names, test) => SERVICES.every((s) => test(fact(part, `${s}_${names}`)));
const have = (part, name) => fact(part, name) !== undefined;
const missing = (part, ...names) => names.filter((n) => !have(part, n));

/**
 * check() returns true when the criterion is met, or a string that says what is wrong.
 * "needs" lists the facts it reads: if one is missing, the part has not been run yet.
 */
export const CRITERIA = [
  // ---- part 1: containerize ----
  { id: 'p1.size', part: 1, area: 'images', points: 9, title: 'images are small: api, worker and web within their size targets', hint: 'Use a small base (alpine or slim), copy only what runs, and build in stages.',
    needs: SERVICES.map((s) => `${s}_size_mb`),
    check: () => SERVICES.map((s) => (fact(1, `${s}_size_mb`) <= TARGETS[`${s}_size_mb`] ? '' : `${s} is ${fact(1, `${s}_size_mb`)} MB, the target is ${TARGETS[`${s}_size_mb`]} MB`)).filter(Boolean).join('; ') || true },
  { id: 'p1.user', part: 1, area: 'images', points: 4, title: 'every image runs as an unprivileged user', hint: 'Add USER (the node and nginx images have users; for Python create one with useradd).',
    needs: SERVICES.map((s) => `${s}_user_root`),
    check: () => (all(1, 'user_root', (v) => v === false) ? true : `still root: ${SERVICES.filter((s) => fact(1, `${s}_user_root`) !== false).join(', ')}`) },
  { id: 'p1.pinned', part: 1, area: 'images', points: 4, title: 'every base image is pinned by digest', hint: 'FROM image:tag@sha256:... . Get the digest with: docker buildx imagetools inspect <image:tag>',
    needs: SERVICES.map((s) => `${s}_pinned`),
    check: () => (all(1, 'pinned', (v) => v === true) ? true : `not pinned: ${SERVICES.filter((s) => fact(1, `${s}_pinned`) !== true).join(', ')}`) },
  { id: 'p1.check', part: 1, area: 'images', points: 3, title: 'docker build --check finds nothing in the three Dockerfiles', hint: 'Run docker build --check <service> and fix each rule it names.',
    needs: SERVICES.map((s) => `${s}_check_warnings_count`),
    check: () => (all(1, 'check_warnings_count', (v) => v === 0) ? true : SERVICES.map((s) => `${s}: ${fact(1, `${s}_check_warnings_count`)} warning(s)`).join(', ')) },
  { id: 'p1.ignore', part: 1, area: 'build and cache', points: 3, title: 'every build context has a .dockerignore', hint: 'List .env files, node_modules, the Dockerfile itself and caches.',
    needs: SERVICES.map((s) => `${s}_dockerignore`),
    check: () => (all(1, 'dockerignore', (v) => v === true) ? true : `missing for: ${SERVICES.filter((s) => fact(1, `${s}_dockerignore`) !== true).join(', ')}`) },
  { id: 'p1.multistage', part: 1, area: 'build and cache', points: 3, title: 'the api builds in stages and has a test stage', hint: 'Stages: deps, test, runtime. The pipeline builds the test stage with --target test.',
    needs: ['api_multistage', 'api_test_stage'],
    check: () => (fact(1, 'api_multistage') && fact(1, 'api_test_stage') ? true : 'the api Dockerfile needs two or more stages, one named test') },
  { id: 'p1.cache', part: 1, area: 'build and cache', points: 4, title: 'editing the source does not reinstall the packages', hint: 'COPY package.json and the lock file, RUN npm ci, and only then COPY the source.',
    needs: ['api_deps_cached_on_edit'],
    check: () => (fact(1, 'api_deps_cached_on_edit') ? true : 'the npm step runs again after a source edit') },
  { id: 'p1.stop', part: 1, area: 'run and recover', points: 6, title: 'each service stops within 3 seconds and exits 0', hint: 'Exec-form CMD (no shell in front) and a SIGTERM handler. Exit 137 means the process was killed.',
    needs: SERVICES.flatMap((s) => [`${s}_stop_s`, `${s}_stop_exit_code`]),
    check: () => SERVICES.map((s) => (fact(1, `${s}_stop_s`) <= TARGETS.stop_s && fact(1, `${s}_stop_exit_code`) === 0 ? '' : `${s}: ${fact(1, `${s}_stop_s`)} s, exit ${fact(1, `${s}_stop_exit_code`)}`)).filter(Boolean).join('; ') || true },
  { id: 'p1.healthy', part: 1, area: 'run and recover', points: 4, title: 'the stack is healthy in under 60 seconds, every container with a health check', hint: 'A healthcheck on db, api, worker and web, and depends_on with condition: service_healthy.',
    needs: ['compose_up_ok', 'compose_up_s', 'compose_healthy_count', 'compose_containers_count', 'compose_healthchecks_count', 'compose_wait_for_healthy'],
    check: () => (fact(1, 'compose_up_ok') && fact(1, 'compose_up_s') <= TARGETS.compose_up_s && fact(1, 'compose_healthy_count') === 4 && fact(1, 'compose_containers_count') === 4 && fact(1, 'compose_healthchecks_count') === 4 && fact(1, 'compose_wait_for_healthy')
      ? true
      : `up ok ${fact(1, 'compose_up_ok')} in ${fact(1, 'compose_up_s')} s, ${fact(1, 'compose_healthy_count')} of ${fact(1, 'compose_containers_count')} healthy, ${fact(1, 'compose_healthchecks_count')} of 4 health checks, dependants wait for healthy: ${fact(1, 'compose_wait_for_healthy')}`) },
  { id: 'p1.e2e', part: 1, area: 'run and recover', points: 4, title: 'the system works end to end: a job goes through web, api, database and worker', hint: 'Start the stack by hand and read docker compose logs.',
    needs: ['compose_e2e_ok'],
    check: () => (fact(1, 'compose_e2e_ok') ? true : 'jobs queued through the web page did not all finish') },
  { id: 'p1.dev', part: 1, area: 'run and recover', points: 2, title: 'the dev stack has a profile for tools and watch on the api', hint: 'profiles: [tools] on a psql service, and develop: watch: on the api.',
    needs: ['compose_has_profile', 'compose_has_watch'],
    check: () => (fact(1, 'compose_has_profile') && fact(1, 'compose_has_watch') ? true : `profile ${fact(1, 'compose_has_profile')}, watch ${fact(1, 'compose_has_watch')}`) },
  { id: 'p1.secrets', part: 1, area: 'security', points: 4, title: 'no secret in any image (history, environment or files)', hint: 'No ENV with a password, no COPY . . that takes a .env file. Pass secrets at run time.',
    needs: SERVICES.map((s) => `${s}_secret_leaks_count`),
    check: () => (all(1, 'secret_leaks_count', (v) => v === 0) ? true : SERVICES.map((s) => `${s}: ${fact(1, `${s}_secret_leaks_count`)} leak(s)`).join(', ')) },
  { id: 'p1.compose-secrets', part: 1, area: 'security', points: 2, title: 'compose.yaml writes no secret and has no obsolete "version:" key', hint: 'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?...} and a .env file that is not committed.',
    needs: ['compose_literal_secret', 'compose_version_key'],
    check: () => (!fact(1, 'compose_literal_secret') && !fact(1, 'compose_version_key') ? true : `secret in file: ${fact(1, 'compose_literal_secret')}, version key: ${fact(1, 'compose_version_key')}`) },
  { id: 'p1.db-private', part: 1, area: 'security', points: 2, title: 'the database publishes no port to the host', hint: 'Delete ports: from the db service. The other services reach it by name.',
    needs: ['compose_db_published'],
    check: () => (fact(1, 'compose_db_published') === false ? true : 'the db service has ports:') },
  { id: 'p1.hardening', part: 1, area: 'security', points: 3, title: 'api, worker and web: read-only root, all capabilities dropped, no-new-privileges, limits and restart policy', hint: 'read_only: true, tmpfs: [/tmp], cap_drop: [ALL], security_opt: [no-new-privileges:true], mem_limit, restart: unless-stopped.',
    needs: ['compose_hardened_count', 'compose_limits_count', 'compose_restart_count'],
    check: () => (fact(1, 'compose_hardened_count') === 3 && fact(1, 'compose_limits_count') === 4 && fact(1, 'compose_restart_count') === 4 ? true : `hardened ${fact(1, 'compose_hardened_count')} of 3, limits ${fact(1, 'compose_limits_count')} of 4, restart ${fact(1, 'compose_restart_count')} of 4`) },
  { id: 'p1.db-pinned', part: 1, area: 'images', points: 1, title: 'the database image is pinned by digest too', hint: 'image: postgres:18-alpine@sha256:...',
    needs: ['compose_db_pinned'],
    check: () => (fact(1, 'compose_db_pinned') ? true : 'the db image has a tag only') },
  { id: 'p1.readme', part: 1, area: 'communication', points: 4, title: 'the README is current: how to run it, no stale instructions', hint: 'Remove MySQL, Node 16, docker-compose, pm2. Say: cp .env.example .env, docker compose up --wait.',
    needs: ['readme_stale_count', 'readme_missing_count'],
    check: () => (fact(1, 'readme_stale_count') === 0 && fact(1, 'readme_missing_count') === 0 ? true : `${fact(1, 'readme_stale_count')} stale word(s), ${fact(1, 'readme_missing_count')} required word(s) missing`) },

  // ---- part 2: pipeline and ship ----
  { id: 'p2.pins', part: 2, area: 'security', points: 4, title: 'the workflow pins every action to a full commit', hint: 'uses: owner/repo@<40 hex> # version. Find it with gh api repos/<owner>/<repo>/commits/<tag> -q .sha',
    needs: ['workflow_unpinned_count', 'workflow_actions_count'],
    check: () => (fact(2, 'workflow_actions_count') > 0 && fact(2, 'workflow_unpinned_count') === 0 ? true : `${fact(2, 'workflow_unpinned_count')} of ${fact(2, 'workflow_actions_count')} actions are not pinned`) },
  { id: 'p2.permissions', part: 2, area: 'security', points: 3, title: 'least privilege: no write-all, no pull_request_target, narrow permissions per job', hint: 'permissions: {} at the top; contents: read and packages: write only on the job that pushes.',
    needs: ['workflow_write_all', 'workflow_pull_request_target', 'workflow_least_privilege_jobs'],
    check: () => (!fact(2, 'workflow_write_all') && !fact(2, 'workflow_pull_request_target') && fact(2, 'workflow_least_privilege_jobs') ? true : 'permissions are too wide or the trigger gives fork code your secrets') },
  { id: 'p2.push-guard', part: 2, area: 'security', points: 2, title: 'a pull request never pushes, and the login uses the built-in token', hint: "push: ${{ github.event_name != 'pull_request' }} and secrets.GITHUB_TOKEN.",
    needs: ['workflow_push_guarded', 'workflow_push_always', 'workflow_hardcoded_secret', 'workflow_uses_github_token'],
    check: () => (fact(2, 'workflow_push_guarded') && !fact(2, 'workflow_push_always') && !fact(2, 'workflow_hardcoded_secret') && fact(2, 'workflow_uses_github_token') ? true : 'guard the push, use secrets.GITHUB_TOKEN, write no password') },
  { id: 'p2.workflow-cache', part: 2, area: 'build and cache', points: 3, title: 'the workflow builds with a cache and tests before it pushes', hint: 'cache-from: type=gha and cache-to: type=gha,mode=max; a build with target: test first.',
    needs: ['workflow_cache_gha', 'workflow_has_test_step'],
    check: () => (fact(2, 'workflow_cache_gha') && fact(2, 'workflow_has_test_step') ? true : `cache ${fact(2, 'workflow_cache_gha')}, test step ${fact(2, 'workflow_has_test_step')}`) },
  { id: 'p2.workflow-all', part: 2, area: 'build and cache', points: 2, title: 'the workflow builds all three images and hands the digests to the deploy job', hint: 'A matrix over api, worker and web, and a job output with each digest.',
    needs: ['workflow_builds_all', 'workflow_prints_digest', 'workflow_deploy_needs_build'],
    check: () => (fact(2, 'workflow_builds_all') && fact(2, 'workflow_prints_digest') && fact(2, 'workflow_deploy_needs_build') ? true : 'cover api, worker and web; export the digest; make deploy need build') },
  { id: 'p2.stages', part: 2, area: 'build and cache', points: 4, title: 'the local pipeline passes for all three images, with tests and scan before the push and sign after it', hint: 'pipeline.json: lint, build, test, scan, sbom, push, sign.',
    needs: ['pipeline_api_ok', 'pipeline_worker_ok', 'pipeline_web_ok', 'pipeline_order_ok'],
    check: () => (fact(2, 'pipeline_api_ok') && fact(2, 'pipeline_worker_ok') && fact(2, 'pipeline_web_ok') && fact(2, 'pipeline_order_ok') ? true : `ok: api ${fact(2, 'pipeline_api_ok')}, worker ${fact(2, 'pipeline_worker_ok')}, web ${fact(2, 'pipeline_web_ok')}; order ${fact(2, 'pipeline_order_ok')}`) },
  { id: 'p2.tags', part: 2, area: 'build and cache', points: 1, title: 'images are tagged with the commit', hint: 'tags: ["sha", "version"] in pipeline.json.',
    needs: ['tags_include_sha'],
    check: () => (fact(2, 'tags_include_sha') ? true : 'no sha tag') },
  { id: 'p2.digest', part: 2, area: 'run and recover', points: 4, title: 'the host runs exactly the digests the pipeline pushed', hint: 'image: ...@${DIGEST_API} in compose.prod.yaml, never a tag.',
    needs: ['deploy_digests_match', 'deploy_ok'],
    check: () => (fact(2, 'deploy_ok') && fact(2, 'deploy_digests_match') ? true : 'the running images are not the pushed digests') },
  { id: 'p2.rollout', part: 2, area: 'run and recover', points: 4, title: 'a rollout under load drops no request and both versions answer', hint: 'A health check on every service so "up --wait" waits for ready.',
    needs: ['rollout_failed_count', 'rollout_total_count', 'rollout_both_versions'],
    check: () => (fact(2, 'rollout_failed_count') === 0 && fact(2, 'rollout_total_count') > 300 && fact(2, 'rollout_both_versions') ? true : `${fact(2, 'rollout_failed_count')} of ${fact(2, 'rollout_total_count')} requests failed, both versions answered: ${fact(2, 'rollout_both_versions')}`) },
  { id: 'p2.rollback', part: 2, area: 'run and recover', points: 4, title: 'a rollback by digest takes under two minutes and lands on the previous digests', hint: 'Keep a history of digests; roll back to the digests of the previous entry.',
    needs: ['rollback_s', 'rollback_digests_match'],
    check: () => (fact(2, 'rollback_digests_match') && fact(2, 'rollback_s') < TARGETS.rollback_s ? true : `rollback ${fact(2, 'rollback_s')} s, digests match ${fact(2, 'rollback_digests_match')}`) },
  { id: 'p2.prod-file', part: 2, area: 'security', points: 3, title: 'compose.prod.yaml: no literal secret, health checks, limits and restart on every service', hint: 'See challenge 13, parts 2 and 4.',
    needs: ['prod_secret_literal', 'prod_health_count', 'prod_limits_count', 'prod_restart_count'],
    check: () => (!fact(2, 'prod_secret_literal') && fact(2, 'prod_health_count') === 3 && fact(2, 'prod_limits_count') === 3 && fact(2, 'prod_restart_count') === 3 ? true : `secret literal ${fact(2, 'prod_secret_literal')}, health ${fact(2, 'prod_health_count')} of 3, limits ${fact(2, 'prod_limits_count')} of 3, restart ${fact(2, 'prod_restart_count')} of 3`) },
  { id: 'p2.scan', part: 2, area: 'security', points: 3, title: 'every image is scanned before the push, with a before and after report', hint: 'Wired in with challenge 12 (hooks/scan.mjs).', pending: () => fact(2, 'scan_status') === 'skipped',
    needs: ['scan_status'], check: () => (fact(2, 'scan_status') === 'ok' ? true : `scan status: ${fact(2, 'scan_status')}`) },
  { id: 'p2.sbom', part: 2, area: 'security', points: 3, title: 'every image has an SBOM', hint: 'Wired in with challenge 12 (hooks/sbom.mjs).', pending: () => fact(2, 'sbom_status') === 'skipped',
    needs: ['sbom_status'], check: () => (fact(2, 'sbom_status') === 'ok' ? true : `sbom status: ${fact(2, 'sbom_status')}`) },
  { id: 'p2.sign', part: 2, area: 'security', points: 3, title: 'every pushed digest is signed', hint: 'Wired in with challenge 12 (hooks/sign.mjs).', pending: () => fact(2, 'sign_status') === 'skipped',
    needs: ['sign_status'], check: () => (fact(2, 'sign_status') === 'ok' ? true : `sign status: ${fact(2, 'sign_status')}`) },

  // ---- part 3: break it ----
  { id: 'p3.kill', part: 3, area: 'run and recover', points: 5, title: 'kill: the crashed api comes back within 20 seconds and no job is lost', hint: 'restart: unless-stopped, and the API puts a claimed job back in the queue when its worker disappears.',
    needs: ['kill_recovered', 'kill_recovery_s', 'kill_jobs_lost_count'],
    check: () => (fact(3, 'kill_recovered') && fact(3, 'kill_recovery_s') <= TARGETS.kill_recovery_s && fact(3, 'kill_jobs_lost_count') === 0 ? true : `recovered ${fact(3, 'kill_recovered')} in ${fact(3, 'kill_recovery_s')} s, ${fact(3, 'kill_jobs_lost_count')} job(s) lost`) },
  { id: 'p3.starve', part: 3, area: 'run and recover', points: 5, title: 'starve: a memory hog is stopped by its limit, restarted, and the worker keeps working', hint: 'mem_limit on the api, restart: unless-stopped, and read docker inspect for OOMKilled.',
    needs: ['starve_oom_killed', 'starve_recovered', 'starve_worker_unaffected'],
    check: () => (fact(3, 'starve_oom_killed') && fact(3, 'starve_recovered') && fact(3, 'starve_worker_unaffected') ? true : `oom killed ${fact(3, 'starve_oom_killed')}, recovered ${fact(3, 'starve_recovered')}, worker unaffected ${fact(3, 'starve_worker_unaffected')}`) },
  { id: 'p3.misconfig', part: 3, area: 'run and recover', points: 5, title: 'misconfigure: a wrong database password is caught by the health gate within 30 seconds', hint: 'A /ready check that touches the database, a healthcheck on it, and up --wait.',
    needs: ['misconfig_detected', 'misconfig_detect_s'],
    check: () => (fact(3, 'misconfig_detected') && fact(3, 'misconfig_detect_s') <= TARGETS.misconfig_detect_s ? true : `detected ${fact(3, 'misconfig_detected')} after ${fact(3, 'misconfig_detect_s')} s`) },
  { id: 'p3.runbook', part: 3, area: 'communication', points: 5, title: 'RUNBOOK.md has an entry for kill, starve and misconfigure with symptom, check, cause, fix and prevention', hint: 'Use the template in RUNBOOK.md. Each field needs words, each Check needs a command in backticks.',
    needs: ['runbook_entries_count', 'runbook_complete_count'],
    check: () => (fact(3, 'runbook_entries_count') === 3 && fact(3, 'runbook_complete_count') === 3 ? true : `${fact(3, 'runbook_complete_count')} of 3 entries are complete (${fact(3, 'runbook_entries_count')} found)`) },
  { id: 'p3.evidence', part: 3, area: 'evidence', points: 5, title: 'the runbook quotes the numbers your own run measured', hint: 'Each entry has a "Measured:" line with the number from results or facts.',
    needs: ['runbook_numbers_match'],
    check: () => (fact(3, 'runbook_numbers_match') ? true : 'a Measured: number does not match what your experiment printed') },

  // ---- part 4: defend it ----
  { id: 'p4.defence', part: 4, area: 'communication', points: 5, title: 'DEFENCE.md is a five-minute walkthrough with all five sections and between 300 and 800 words', hint: 'Sections: Before and after, The pipeline, The deploy, One failure, At ten times the team.',
    needs: ['defence_words_count', 'defence_sections_count'],
    check: () => (fact(4, 'defence_sections_count') === 5 && fact(4, 'defence_words_count') >= 300 && fact(4, 'defence_words_count') <= 800 ? true : `${fact(4, 'defence_sections_count')} of 5 sections, ${fact(4, 'defence_words_count')} words`) },
  { id: 'p4.numbers', part: 4, area: 'evidence', points: 6, title: 'the defence quotes at least six numbers from your own facts', hint: 'Sizes, build times, rollout failures, rollback time, recovery time. They must match what you measured.',
    needs: ['defence_numbers_matched_count'],
    check: () => (fact(4, 'defence_numbers_matched_count') >= 6 ? true : `${fact(4, 'defence_numbers_matched_count')} of the numbers in your facts appear in the defence`) },
  { id: 'p4.probes', part: 4, area: 'communication', points: 8, title: 'PROBES.md answers three probes and one troubleshooting question, each in 60 to 200 words and on the point', hint: 'Answer what was asked, name the command or the file, say what you would change.',
    needs: ['probes_ok_count', 'probes_total_count'],
    check: () => (fact(4, 'probes_ok_count') === fact(4, 'probes_total_count') && fact(4, 'probes_total_count') === 4 ? true : `${fact(4, 'probes_ok_count')} of ${fact(4, 'probes_total_count')} answers are good enough`) },
];

/** Evaluate one criterion: { status: 'pass' | 'fail' | 'pending' | 'not run', detail }. */
export function evaluate(c) {
  const absent = missing(c.part, ...c.needs);
  if (absent.length) return { status: 'not run', detail: `c14.p${c.part}.${absent[0]} is missing: run the part first` };
  if (c.pending?.()) return { status: 'pending', detail: 'filled in after challenge 12' };
  const r = c.check();
  return r === true ? { status: 'pass', detail: '' } : { status: 'fail', detail: String(r) };
}

/** Score the whole rubric from the saved facts. Pending criteria are left out of the total. */
export function score(parts = [1, 2, 3, 4]) {
  const rows = CRITERIA.filter((c) => parts.includes(c.part)).map((c) => ({ ...c, ...evaluate(c) }));
  const counted = rows.filter((r) => r.status !== 'pending');
  const available = counted.reduce((a, r) => a + r.points, 0);
  const earned = counted.filter((r) => r.status === 'pass').reduce((a, r) => a + r.points, 0);
  const byArea = Object.fromEntries(AREAS.map((a) => {
    const rs = counted.filter((r) => r.area === a);
    return [a, { earned: rs.filter((r) => r.status === 'pass').reduce((x, r) => x + r.points, 0), available: rs.reduce((x, r) => x + r.points, 0) }];
  }));
  return { rows, earned, available, percent: available ? Math.round((earned / available) * 100) : 0, pending: rows.filter((r) => r.status === 'pending'), byArea };
}
