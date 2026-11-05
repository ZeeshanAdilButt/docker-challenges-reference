# wrong-user
FROM node:24-alpine
LABEL dkr.challenge="11"
WORKDIR /app
COPY --chown=node:node server.mjs config.json ./
RUN chmod 600 /app/config.json
USER node
CMD ["node", "server.mjs"]
