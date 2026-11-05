# Review this Dockerfile. It builds daftar-api.
FROM node:24-alpine
WORKDIR /app
ADD package.json package-lock.json server.mjs ./
RUN npm ci --omit=dev
USER node
ENV PORT=8080
EXPOSE 8080
CMD npm start
