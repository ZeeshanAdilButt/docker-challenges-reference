FROM node:24 as build
MAINTAINER devteam@daftar.example
WORKDIR /app
COPY . .
RUN npm install
ARG APP_VERSION=1.0.0
ENV APP_VERSION $APP_VERSION
ENV DB_PASSWORD supersecret-db-pass-2026
EXPOSE 8080
CMD npm start
