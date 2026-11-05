# Runbook: services that need another way in

One entry per service. Three lines each, plain words. Say what a person sees, what is wrong, and the one change that fixes it. Name the command that proved it.

## 08-read-only-root

Symptom: The container exits with code 1 right after start and `docker logs` shows "ENOENT: no such file or directory, mkdir '/app/cache'" although the image has /app.
Cause: compose.yaml sets read_only: true and gives the app no writable place, so the start-up code cannot create /app/cache (proved with `docker inspect` showing ReadonlyRootfs true and Tmpfs null, and the same image failing with `--read-only` and working without it).
Fix: Keep read_only: true and mount a small tmpfs for the cache folder, for example `tmpfs: - /app/cache:size=8m,mode=1777`.

## 09-missing-shell

Symptom: The container exits at once with exit code 255 and `docker logs` shows "exec /app/start.sh: no such file or directory", although the file is in the image.
Cause: start.sh begins with #!/bin/sh, but the hardening step removed /bin/sh, so the kernel cannot find the interpreter of the script (proved by reading the first line of start.sh with node and checking that /bin/sh does not exist).
Fix: Start node directly in exec form, ENTRYPOINT ["node", "/app/server.mjs"], and drop the shell script; the image stays without a shell.

## 10-wrong-user

Symptom: The container exits with code 1 and `docker logs` shows "EACCES: permission denied, open '/app/config.json'".
Cause: config.json was copied as root and set to mode 600, and the container runs as user node (uid 1000), so the app cannot read its own config (proved with `ls -ln /app` run as user 0 and `id` in the image).
Fix: Copy the files with `COPY --chown=node:node` so the file belongs to the user that runs the app, keep `USER node`, and rebuild.
