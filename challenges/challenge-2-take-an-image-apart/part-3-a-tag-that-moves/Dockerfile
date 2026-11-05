# daftar-api with a version baked in. Built twice: once as 1.0.0, once as 2.0.0, under the same tag.
FROM node:24-alpine
ARG APP_VERSION=1.0.0
WORKDIR /app
COPY package.json server.mjs ./
ENV PORT=8080
ENV APP_VERSION=$APP_VERSION
RUN echo "release $APP_VERSION" > /app/RELEASE
USER node
CMD ["node", "server.mjs"]
