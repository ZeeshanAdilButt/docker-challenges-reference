# Fixed: no secret in the image. The service gets SESSION_SECRET when it starts: docker run -e SESSION_SECRET ...
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json server.mjs ./
RUN npm ci --omit=dev
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
