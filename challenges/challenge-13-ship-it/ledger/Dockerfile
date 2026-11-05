# The ledger service. VARIANT picks the release: v1, v2-expand or v2-rename.
FROM node:24-alpine
WORKDIR /app
ARG VARIANT=v1
ARG APP_VERSION=1.0.0
ENV APP_VERSION=$APP_VERSION PORT=8080 DB_PATH=/data/ledger.db
COPY package.json base.mjs ./
COPY ${VARIANT}.mjs ./server.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "--no-warnings", "server.mjs"]
