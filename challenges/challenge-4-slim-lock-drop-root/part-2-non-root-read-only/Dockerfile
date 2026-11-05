# daftar-api, first version. It works. It is also the kind of image that gets a bad review.
# Your job: make it run as a numeric non-root user, listen on a port above 1024,
# and keep a folder the app can write to. The test and run.mjs tell you what is wrong.
FROM node:24-alpine

WORKDIR /app
COPY package.json server.mjs probe.mjs ./

ENV PORT=80
EXPOSE 80

CMD ["node", "server.mjs"]
