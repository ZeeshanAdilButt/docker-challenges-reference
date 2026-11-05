# daftar-api as a service you restart under load. Edit this file.
# The build context is the daftar-api folder, so COPY lines name files inside it.
FROM node:24-alpine

WORKDIR /app
COPY package.json server.mjs ./

ENV PORT=8080
EXPOSE 8080

USER node

CMD node server.mjs; echo "server stopped"
