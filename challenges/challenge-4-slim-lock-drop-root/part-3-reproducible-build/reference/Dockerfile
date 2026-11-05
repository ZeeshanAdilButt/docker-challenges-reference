# daftar-api, reproducible. The same files give the same image digest, on any day.
# The base is pinned by digest: the tag node:24-alpine can move, this digest cannot.
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85

WORKDIR /app
COPY package.json server.mjs ./

# No build date inside the image. If you need to know when it was built,
# read it from the registry or from a label that your pipeline sets from the commit time.

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
