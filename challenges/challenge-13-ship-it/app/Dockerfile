# The service the pipeline ships. Three stages:
#   base     the runtime and the package file
#   test     runs the unit tests; the pipeline builds this target before it pushes anything
#   release  the image that gets pushed; it carries the version and the git commit as labels
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json ./

FROM base AS test
COPY server.mjs test.mjs ./
RUN node --test test.mjs

FROM base AS release
ARG APP_VERSION=1.0.0
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION PORT=8080
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$GIT_SHA
COPY server.mjs ./
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
