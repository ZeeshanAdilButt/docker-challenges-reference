# volume-permission
FROM node:24-alpine
LABEL dkr.challenge="11"
WORKDIR /app
COPY server.mjs ./
RUN mkdir -p /var/lib/shop && chown node:node /var/lib/shop
USER node
CMD ["node", "server.mjs"]
