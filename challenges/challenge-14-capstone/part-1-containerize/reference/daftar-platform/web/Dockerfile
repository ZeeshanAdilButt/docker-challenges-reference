# daftar-web: static files behind nginx, listening on 8080 as the unprivileged user "nginx".
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
ARG APP_VERSION=1.0.0
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.version=$APP_VERSION       org.opencontainers.image.revision=$GIT_SHA
COPY nginx.conf /etc/nginx/nginx.conf
COPY index.html app.js style.css /usr/share/nginx/html/
EXPOSE 8080
USER nginx
