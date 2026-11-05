# missing-shell
FROM node:24-alpine
LABEL dkr.challenge="11"
WORKDIR /app
COPY server.mjs ./
# Hardening step: remove the shell so an attacker cannot use it. Nothing is installed after this line.
RUN rm -f /bin/sh /bin/ash /bin/busybox
USER node
ENTRYPOINT ["node", "/app/server.mjs"]
