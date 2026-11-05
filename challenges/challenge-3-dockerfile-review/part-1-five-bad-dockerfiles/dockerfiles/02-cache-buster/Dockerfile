# Review this Dockerfile. It builds daftar-api.
FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
