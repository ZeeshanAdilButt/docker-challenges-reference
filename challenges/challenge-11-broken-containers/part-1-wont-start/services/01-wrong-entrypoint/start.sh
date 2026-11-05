#!/bin/sh
# Start script: print a line, then run the server as process 1.
echo "starting wrong-entrypoint"
exec node /app/server.mjs
