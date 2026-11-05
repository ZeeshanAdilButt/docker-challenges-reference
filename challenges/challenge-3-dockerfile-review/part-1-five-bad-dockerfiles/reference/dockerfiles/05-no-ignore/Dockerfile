# Fixed: Dockerfile.dockerignore (next to this file) keeps local env files, notes and tests out of the build.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
