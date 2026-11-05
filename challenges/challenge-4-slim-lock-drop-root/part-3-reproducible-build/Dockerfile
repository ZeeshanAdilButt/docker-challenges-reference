# daftar-api, built twice. Today the two builds do not give the same image.
# Your job: find out why (run.mjs shows which layers differ) and fix it.
FROM node:24-alpine

WORKDIR /app
COPY package.json server.mjs ./

# Handy for support: when was this built?
RUN date -u > /app/BUILT_AT

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
