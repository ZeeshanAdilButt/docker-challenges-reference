# daftar-api, two stages. The same file for every cache backend in this part. Do not edit.
# Stage "build" installs the packages (slow), then runs a small build step.
# The last stage copies the result. The packages are NOT a layer of the final image on their own.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server.mjs ./
RUN node --check server.mjs && mkdir dist && cp server.mjs dist/

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./
COPY package.json ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
