# Runbook: services that run but cannot be used

One entry per service. Three lines each, plain words. Say what a person sees, what is wrong, and the one change that fixes it. Name the command that proved it.

## 05-port-clash

Symptom: `docker compose up` ends with "Bind for 127.0.0.1:18105 failed: port is already allocated"; the web container runs and the admin container stays in Created.
Cause: Both services publish host port 18105, and only one container can own a host port (proved with `docker inspect` on the admin container, field State.Error, and `docker port` on the web container).
Fix: Give admin its own host port in compose.yaml, for example "127.0.0.1:18115:8080", and run `docker compose up -d`.

## 06-bad-healthcheck

Symptom: `docker ps` shows "Up (unhealthy)" while the service answers requests on its published port, so the deploy tool refuses to continue.
Cause: The health check calls http://127.0.0.1:3000/health but the app listens on 8080 (proved with the Health.Log from `docker inspect` and by running `wget` on port 8080 inside the container).
Fix: Change the port in the health check test to 8080 and run `docker compose up -d`; keep the check, do not remove it.

## 07-dns-typo

Symptom: Both containers are running and /health answers, but /orders returns 502 after about three seconds with "backend unreachable".
Cause: BACKEND_URL points at the host name "backnd", a typo for "backend", so the name does not resolve on the Compose network (proved with `docker exec <gateway> nslookup backnd`, which says NXDOMAIN, and `nslookup backend`, which works).
Fix: Set BACKEND_URL to http://backend:8080 in compose.yaml and run `docker compose up -d`.
