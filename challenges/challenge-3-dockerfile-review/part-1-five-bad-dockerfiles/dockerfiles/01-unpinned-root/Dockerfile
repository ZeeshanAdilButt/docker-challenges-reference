# Review this Dockerfile. It builds daftar-api.
FROM node:latest
WORKDIR /app
COPY package.json package-lock.json server.mjs ./
RUN npm ci --omit=dev
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
