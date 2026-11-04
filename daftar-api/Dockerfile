# daftar-api, the simple form used in challenge 1.
# One stage, one process, and node is PID 1 (exec-form CMD), so SIGTERM reaches it.
FROM node:24-alpine

WORKDIR /app
COPY package.json server.mjs ./

ENV PORT=8080
EXPOSE 8080

# The base image ships a non-root user called "node".
USER node

CMD ["node", "server.mjs"]
