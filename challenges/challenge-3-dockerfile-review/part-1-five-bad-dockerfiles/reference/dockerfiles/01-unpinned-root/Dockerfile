# Fixed: pinned base (a tag that names a version), and a non-root user.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json server.mjs ./
RUN npm ci --omit=dev
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
