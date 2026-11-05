# Reference: the token comes in as a build secret. It is a file that exists only while that one RUN step runs.
# It is never in an ARG, an ENV, a layer or the history.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json server.mjs check-secret.mjs ./
RUN --mount=type=secret,id=npm_token \
    echo "//registry.example.invalid/:_authToken=$(cat /run/secrets/npm_token)" > .npmrc \
 && npm ci --omit=dev \
 && sha256sum /run/secrets/npm_token | cut -c1-8 > /app/build-proof.txt \
 && rm .npmrc
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
