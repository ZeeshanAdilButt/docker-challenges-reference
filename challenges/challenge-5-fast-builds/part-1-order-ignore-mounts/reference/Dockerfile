# daftar-api with dependencies, in the order that keeps the cache useful.
# 1. Things that change rarely come first. 2. Things that change on every push come last.
FROM node:24-alpine

WORKDIR /app

# Only the two dependency files. They change only when you change a dependency.
COPY package.json package-lock.json ./

# The cache mount keeps npm's download cache between builds. It is NOT part of the image.
# The id gives this challenge its own cache, so it cannot mix with other projects on this machine.
RUN --mount=type=cache,target=/root/.npm,id=dkr-c5-npm npm ci

# The code comes last. A code change only rebuilds from here.
COPY server.mjs ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
