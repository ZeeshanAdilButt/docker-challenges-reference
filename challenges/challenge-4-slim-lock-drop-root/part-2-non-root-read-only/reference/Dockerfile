# daftar-api, reviewed. Numeric non-root user, port above 1024, one writable folder.
FROM node:24-alpine

WORKDIR /app
# The code stays owned by root and is not writable by the app user.
COPY package.json server.mjs probe.mjs ./

# The one folder the app may write to, owned by the app user.
# A new named volume copies this owner the first time it is mounted.
RUN mkdir /app/data && chown 10001:10001 /app/data

ENV PORT=8080
EXPOSE 8080

# A number, not a name: Kubernetes can check "runAsNonRoot" only against a number.
USER 10001:10001

CMD ["node", "server.mjs"]
