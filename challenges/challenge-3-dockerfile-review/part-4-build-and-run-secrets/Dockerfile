# Your Dockerfile for part 4. Right now it is a copy of Dockerfile.leaky.
#
# Goal: the token must be usable while the dependencies are installed (build-proof.txt must still get the
# fingerprint of the token), but it must not be in docker history, in the image config, or in any layer.
# The build is run with BOTH  --build-arg NPM_TOKEN=...  and  --secret id=npm_token,src=<file>.
# Hint: RUN --mount=type=secret,id=npm_token  puts the secret in a file under /run/secrets for that one step.
# A private package registry needs a token while the dependencies are installed.
FROM node:24-alpine
WORKDIR /app
ARG NPM_TOKEN
COPY package.json package-lock.json server.mjs check-secret.mjs ./
RUN echo "//registry.example.invalid/:_authToken=${NPM_TOKEN}" > .npmrc \
 && npm ci --omit=dev \
 && printf %s "$NPM_TOKEN" | sha256sum | cut -c1-8 > /app/build-proof.txt \
 && rm .npmrc
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
