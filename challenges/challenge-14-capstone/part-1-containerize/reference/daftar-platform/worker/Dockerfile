# daftar-worker: Python, standard library only, no packages to install.
#  - exec-form CMD: python is PID 1 and gets SIGTERM itself (worker.py handles it)
#  - runs as an unprivileged user
FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
WORKDIR /app
ARG APP_VERSION=1.0.0
ARG GIT_SHA=unknown
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.version=$APP_VERSION       org.opencontainers.image.revision=$GIT_SHA
RUN useradd --system --uid 10001 --no-create-home worker
COPY worker.py ./
USER worker
CMD ["python", "worker.py"]
