# wrong-entrypoint
FROM node:24-alpine
LABEL dkr.challenge="11"
WORKDIR /app
COPY server.mjs start.sh ./
RUN chmod +x /app/start.sh
USER node
ENTRYPOINT ["/app/start.sh"]
