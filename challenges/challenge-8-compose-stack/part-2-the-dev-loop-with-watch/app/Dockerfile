# The development image. The source is copied in, so a rebuild picks up changes.
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
