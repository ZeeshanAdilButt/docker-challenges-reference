# One image for the api and the worker. They differ only in the command.
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/api.mjs"]
