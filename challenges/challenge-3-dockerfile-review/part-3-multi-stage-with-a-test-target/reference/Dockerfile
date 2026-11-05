# Reference: three stages. The tests and the toolchain live in "test"; the last stage is what ships.
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS test
COPY toolchain /opt/toolchain
COPY server.mjs test.mjs ./
RUN test -s /opt/toolchain/compiler.bin
RUN node --test test.mjs

FROM base AS runtime
COPY server.mjs ./
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
