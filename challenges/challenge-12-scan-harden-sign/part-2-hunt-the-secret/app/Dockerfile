# leaky: this Dockerfile leaks four secrets. Find them, then fix them.
FROM node:24-alpine
WORKDIR /app

# A token for a private registry, passed as a build argument.
ARG NPM_TOKEN
# Copies everything in this folder into the image.
COPY . /app
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /app/.npmrc && node --version > /app/build-note.txt && rm /app/.npmrc

# The key of an external service, written into the image for convenience.
ENV API_KEY=dkrcanary-env-var-5c2a8e1f7d9b3064

# A deploy key, removed again after use.
RUN rm /app/deploy.key

USER node
CMD ["node", "server.mjs"]
