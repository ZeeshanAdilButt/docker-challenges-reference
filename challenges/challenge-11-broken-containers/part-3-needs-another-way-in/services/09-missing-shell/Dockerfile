# missing-shell
FROM node:24-alpine
LABEL dkr.challenge="11"
WORKDIR /app
COPY server.mjs start.sh ./
RUN chmod +x /app/start.sh
# Hardening step: remove the shell so an attacker cannot use it. Nothing is installed after this line.
RUN rm -f /bin/sh /bin/ash /bin/busybox
USER node
ENTRYPOINT ["/app/start.sh"]
