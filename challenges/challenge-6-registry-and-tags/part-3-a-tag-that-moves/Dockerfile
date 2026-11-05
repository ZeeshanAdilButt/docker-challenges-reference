# daftar-api with a version and the labels that let you trace a running container to a build.
# Used by run.mjs. Do not edit.
FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs ./
ARG APP_VERSION=1.0.0
ARG REVISION=unknown
ENV PORT=8080 APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${REVISION} \
      org.opencontainers.image.source=https://example.invalid/daftar-api
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
