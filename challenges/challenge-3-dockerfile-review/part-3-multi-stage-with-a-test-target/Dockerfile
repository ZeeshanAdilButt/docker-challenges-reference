# Your Dockerfile for part 3. Right now it is a copy of Dockerfile.single: one stage, and everything ships.
#
# Goal: split it into stages.
#   - a stage named "test" that has what the tests need (the toolchain, test.mjs) and RUNS the tests.
#       docker build --target test .   must fail when a test fails.
#   - the LAST stage, the default one, is the runtime image. It has only what the service needs to run:
#       no tests, no toolchain, and it runs as a non-root user.
# Stages can share a first stage (for example one that installs the dependencies).
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY toolchain /opt/toolchain
COPY server.mjs test.mjs ./
RUN test -s /opt/toolchain/compiler.bin
RUN node --test test.mjs
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
