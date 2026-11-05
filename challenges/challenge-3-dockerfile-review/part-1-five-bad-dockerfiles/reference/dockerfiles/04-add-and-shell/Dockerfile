# Fixed: COPY for local files, and exec form for CMD so node is PID 1 and gets the signals.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json server.mjs ./
RUN npm ci --omit=dev
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
