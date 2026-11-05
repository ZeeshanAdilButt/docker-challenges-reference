# leaky, fixed. Nothing secret is copied, baked or left in a layer.
FROM node:24-alpine
WORKDIR /app

# Copy only what the app needs. .dockerignore keeps .env and deploy.key out of the build context.
COPY server.mjs package.json ./

# The build token is a BuildKit secret: it is mounted for this one RUN and is never written to a layer.
RUN --mount=type=secret,id=npm_token sh -c 'test -s /run/secrets/npm_token && echo "private registry token present, length $(wc -c < /run/secrets/npm_token)" > /app/build-note.txt'

# The API key is NOT in the image. Pass it when you run the container: docker run -e API_KEY=...
USER node
CMD ["node", "server.mjs"]
