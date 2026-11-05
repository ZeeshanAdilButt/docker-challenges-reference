# daftar-api with dependencies. It builds. It is also slow on every push.
# Your job: change the order of the steps and add a cache mount, so a code change
# does not install the packages again. Then fix .dockerignore.
FROM node:24-alpine

WORKDIR /app
COPY . .
RUN npm ci

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
