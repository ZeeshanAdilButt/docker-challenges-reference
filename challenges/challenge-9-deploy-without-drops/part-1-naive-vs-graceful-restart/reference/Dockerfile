# daftar-api as a service you restart under load, fixed.
# Exec form: node is PID 1, so "docker stop" delivers SIGTERM straight to it.
FROM node:24-alpine

WORKDIR /app
COPY package.json server.mjs ./

ENV PORT=8080
EXPOSE 8080

USER node

CMD ["node", "server.mjs"]
