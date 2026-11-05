# daftar-api: dependencies, tests, then a small runtime image.
#  - base images are pinned by digest (the tag is kept for people to read; the digest is what counts)
#  - the dependency layer comes before the source, so editing server.mjs does not reinstall packages
#  - the test stage runs the unit tests; the pipeline builds it (docker build --target test)
#  - the runtime stage holds only what runs, as the unprivileged user "node"
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM deps AS test
COPY server.mjs test.mjs ./
RUN node --test test.mjs

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS runtime
WORKDIR /app
ARG APP_VERSION=1.0.0
ARG GIT_SHA=unknown
ENV NODE_ENV=production PORT=8080 APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.version=$APP_VERSION       org.opencontainers.image.revision=$GIT_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.mjs ./
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
