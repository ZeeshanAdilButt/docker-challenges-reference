// A tiny Dockerfile reviewer. It reads a Dockerfile and lists the problems it can see without building.
// Run: node challenges/challenge-3-dockerfile-review/part-1-five-bad-dockerfiles/review.mjs <path to a Dockerfile>
// Provided. Nothing to edit. A real project would use a linter such as hadolint or `docker build --check`.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDockerfile, isExecForm } from '../lib/common.mjs';

/** Returns [{ rule, line, message }]. */
export function review(dockerfilePath) {
  const { instructions, stages } = parseDockerfile(readFileSync(dockerfilePath, 'utf8'));
  const found = [];
  const add = (rule, ins, message) => found.push({ rule, line: ins?.line ?? 0, message });

  for (const st of stages) {
    const from = st.instructions[0];
    const image = st.from;
    const isStage = stages.some((s) => s.name && s.name.toLowerCase() === image.toLowerCase());
    if (!isStage && image.toLowerCase() !== 'scratch' && !image.includes('@sha256:')) {
      const tag = image.includes(':') ? image.split(':').pop() : '';
      if (!tag || tag === 'latest') add('base-not-pinned', from, `${image}: use a tag that names a version, for example node:24-alpine`);
    }
  }

  const last = stages.at(-1);
  if (last) {
    const users = last.instructions.filter((i) => i.cmd === 'USER');
    const user = users.at(-1)?.args.trim();
    if (!user || user === 'root' || user === '0') add('runs-as-root', users.at(-1) ?? last.instructions[0], 'the container runs as root: add USER with a non-root user');
  }

  for (const ins of instructions) {
    if ((ins.cmd === 'ENV' || ins.cmd === 'ARG') && /^[A-Za-z0-9_]*(SECRET|TOKEN|PASSWORD|API_?KEY)[A-Za-z0-9_]*\s*=\s*\S+/i.test(ins.args)) {
      add('secret-in-env', ins, `${ins.cmd} ${ins.args.split('=')[0]}: a secret in ENV or ARG stays in the image config and history`);
    }
    if (ins.cmd === 'ADD' && !/https?:\/\//.test(ins.args) && !/\.(tar|tgz|tar\.gz|tar\.xz)\b/.test(ins.args)) {
      add('add-for-local-files', ins, 'ADD does more than COPY (URLs, archives). Use COPY for local files');
    }
    if ((ins.cmd === 'CMD' || ins.cmd === 'ENTRYPOINT') && !isExecForm(ins.args)) {
      add('shell-form', ins, `${ins.cmd} in shell form runs under /bin/sh -c: the shell, not your program, is PID 1. Use ["node", "server.mjs"]`);
    }
  }

  for (const st of stages) {
    const list = st.instructions;
    const copyAll = list.findIndex((i) => i.cmd === 'COPY' && /^(--\S+\s+)*\.\s+\S+\s*$/.test(i.args));
    const install = list.findIndex((i) => i.cmd === 'RUN' && /\b(npm (ci|install)|pip install|yarn|pnpm install)\b/.test(i.args));
    if (copyAll >= 0 && install > copyAll) add('copy-all-before-install', list[copyAll], 'COPY . before the install step: any code change reruns the install. Copy package files first');
  }
  const copiesAll = instructions.some((i) => i.cmd === 'COPY' && /^(--\S+\s+)*\.\s+\S+\s*$/.test(i.args));
  if (copiesAll && !existsSync(`${resolve(dockerfilePath)}.dockerignore`)) {
    add('no-dockerignore', instructions.find((i) => i.cmd === 'COPY' && /^(--\S+\s+)*\.\s+\S+\s*$/.test(i.args)), 'COPY . with no ignore file sends everything in the folder, including env files and notes. Add Dockerfile.dockerignore next to this file');
  }
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node review.mjs <path to a Dockerfile>');
    process.exit(2);
  }
  const findings = review(file);
  if (!findings.length) console.log('no problems found');
  for (const f of findings) console.log(`line ${f.line}: ${f.rule}: ${f.message}`);
  process.exit(findings.length ? 1 : 0);
}

