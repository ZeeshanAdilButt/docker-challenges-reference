FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y curl procps
COPY . .
ARG APP_VERSION=1.0.0
ENV APP_VERSION=$APP_VERSION
ENV PYTHONUNBUFFERED=1
CMD python worker.py
