# Runbook: services that will not start

One entry per service. Three lines each, plain words. Say what a person sees, what is wrong, and the one change that fixes it. Name the command that proved it.

## 01-wrong-entrypoint

Symptom: `docker compose up` fails with "exec: /app/start: stat /app/start: no such file or directory" and the container stays in the Created state with exit code 127.
Cause: The image ENTRYPOINT names /app/start, but the file copied into the image is /app/start.sh (proved with `docker run --rm --entrypoint ls <image> -l /app`).
Fix: Set ENTRYPOINT ["/app/start.sh"] in the Dockerfile and rebuild with `docker compose up -d --build`.

## 02-missing-env

Symptom: The container starts and exits one second later with exit code 1, and `docker logs` says "FATAL: DATABASE_URL is not set".
Cause: compose.yaml sets the variable under the name DB_URL, but the app reads DATABASE_URL (proved with `docker inspect --format '{{json .Config.Env}}'`).
Fix: Rename the variable to DATABASE_URL in the environment block of compose.yaml and run `docker compose up -d`.

## 03-volume-permission

Symptom: The container exits at once with exit code 1 and `docker logs` shows "EACCES: permission denied, mkdir '/var/lib/shop/db'".
Cause: The named volume was created owned by root because the image has no /var/lib/shop folder, and the app runs as user node (uid 1000), which cannot write there (proved with `ls -ldn` on the volume and `id` in the image).
Fix: In the Dockerfile create the folder and give it to node before `USER node` (`RUN mkdir -p /var/lib/shop && chown node:node /var/lib/shop`), then remove the old volume with `docker compose down -v` and start again.

## 04-exit-137

Symptom: The container runs for under a second and then shows "Exited (137)" with OOMKilled true, and the port never answers.
Cause: The memory limit is 32 MB and the app loads a 48 MB cache at start-up, so the kernel kills the process (proved with `docker inspect` showing OOMKilled, `Memory` 33554432 and PRELOAD_MB=48).
Fix: Raise mem_limit and memswap_limit together to 64m and cut PRELOAD_MB to 16, so the app plus the cache fit under the limit with room to spare.
