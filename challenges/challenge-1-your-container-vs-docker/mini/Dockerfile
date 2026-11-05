# daftar-api plus the probe. Same as daftar-api/Dockerfile, with one extra file.
FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs probe.mjs ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
