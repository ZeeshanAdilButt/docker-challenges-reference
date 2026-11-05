// The diagnosis ladder for each service: the commands that find the cause, in order.
// This is the ANSWER KEY. It lives in the harness, and run.mjs prints it only with --answer-key
// (or --record). Work down the ladder yourself first.
//
// Each rung is { cmd: [docker arguments], note, cause?: true }.
// `cause: true` marks the rung whose output shows the cause. Rungs 1 to 3 are the same for every service.

import { SERVICES, ladderCage } from './harness.mjs';

const fmtPs = 'table {{.Names}}\t{{.Status}}\t{{.Ports}}';

/** The rungs for one service. */
export function ladder(id) {
  const svc = SERVICES[id];
  const c = svc.focus ?? svc.containers[0];
  const img = `dkr-c11/${svc.slug}:1`;
  const cage = (what) => ladderCage(what);
  const base = [
    { cmd: ['ps', '-a', '--filter', 'label=dkr.challenge=11', '--filter', `name=dkr-c11-${svc.slug}`, '--format', fmtPs], note: 'Rung 1. Is it running? The status column says what state it is in.' },
    { cmd: ['logs', '--tail', '15', c], note: 'Rung 2. What did it say before it stopped? Read the last lines of its output (the error is usually in the first few lines of a stack trace).' },
    { cmd: ['inspect', c, '--format', 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restarts={{.RestartCount}}'], note: 'Rung 3. Why did it stop? Exit code, OOM flag and the engine error. (For a container that is still running these are all zero or empty.)' },
  ];
  const more = {
    '01-wrong-entrypoint': [
      { cmd: ['image', 'inspect', img, '--format', 'entrypoint={{json .Config.Entrypoint}} user={{.Config.User}}'], note: 'Rung 4. What does the image try to run?' },
      { cmd: ['run', '--rm', ...cage('ladder'), '--entrypoint', 'ls', img, '-l', '/app'], note: 'Rung 5. Does that file exist? The entrypoint says /app/start, the folder has start.sh.', cause: true },
    ],
    '02-missing-env': [
      { cmd: ['inspect', c, '--format', '{{json .Config.Env}}'], note: 'Rung 4. Which variables did the container really get? The name is DB_URL, the app wants DATABASE_URL.', cause: true },
    ],
    '03-volume-permission': [
      { cmd: ['run', '--rm', ...cage('ladder'), '-v', 'dkr-c11-volume-permission_shop-data:/v', '--entrypoint', 'ls', img, '-ldn', '/v'], note: 'Rung 4. Who owns the volume? User 0 (root) owns it.', cause: true },
      { cmd: ['run', '--rm', ...cage('ladder'), '--entrypoint', 'id', img], note: 'Rung 5. Who is the app? User 1000 cannot write into a folder owned by root.' },
    ],
    '04-exit-137': [
      { cmd: ['inspect', c, '--format', 'memory_bytes={{.HostConfig.Memory}} env={{json .Config.Env}}'], note: 'Rung 4. The limit is 33554432 bytes (32 MB) and the cache is 48 MB.', cause: true },
    ],
    '05-port-clash': [
      { cmd: ['inspect', c, '--format', 'error={{.State.Error}}'], note: 'Rung 4. The admin container never started. The engine says why: the port is already allocated.', cause: true },
      { cmd: ['port', 'dkr-c11-port-clash-web'], note: 'Rung 5. The web container holds the same host port.' },
    ],
    '06-bad-healthcheck': [
      { cmd: ['inspect', c, '--format', '{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}'], note: 'Rung 4. What did the health check print? Nothing answered on port 3000.', cause: true },
      { cmd: ['exec', c, 'wget', '-q', '-O', '-', 'http://127.0.0.1:8080/health'], note: 'Rung 5. Run the real check by hand on the right port. The service is fine.' },
    ],
    '07-dns-typo': [
      { cmd: ['exec', c, 'nslookup', 'backnd'], note: 'Rung 4. Can the gateway find the name it calls? No: NXDOMAIN.', cause: true },
      { cmd: ['exec', c, 'nslookup', 'backend'], note: 'Rung 5. The real service name resolves to an address on the network.' },
    ],
    '08-read-only-root': [
      { cmd: ['inspect', c, '--format', 'readonly_root={{.HostConfig.ReadonlyRootfs}} tmpfs={{json .HostConfig.Tmpfs}}'], note: 'Rung 4. The root is read-only and nothing writable is mounted.', cause: true },
      { cmd: ['run', '--rm', ...cage('ladder'), '--read-only', '--entrypoint', 'mkdir', img, '/app/cache'], note: 'Rung 5. Prove it: the same image, read-only, cannot create the folder.' },
    ],
    '09-missing-shell': [
      { cmd: ['run', '--rm', ...cage('ladder'), '--entrypoint', 'sh', img], note: 'Rung 4. Can you get a shell in this image? No shell exists.' },
      { cmd: ['run', '--rm', ...cage('ladder'), '--entrypoint', 'node', img, '-e', "console.log(require('fs').readFileSync('/app/start.sh','utf8').split('\\n')[0], 'shell exists:', require('fs').existsSync('/bin/sh'))"], note: 'Rung 5. Use the one tool that is there (node) to read the first line of the script. It asks for /bin/sh, which was removed.', cause: true },
    ],
    '10-wrong-user': [
      { cmd: ['run', '--rm', ...cage('ladder'), '--user', '0', '--entrypoint', 'ls', img, '-ln', '/app'], note: 'Rung 4. Look as root. config.json belongs to user 0 and has mode 600.', cause: true },
      { cmd: ['run', '--rm', ...cage('ladder'), '--entrypoint', 'id', img], note: 'Rung 5. The app runs as user 1000. It cannot read a file that only root may read.' },
    ],
  };
  return [...base, ...(more[id] ?? [])];
}
