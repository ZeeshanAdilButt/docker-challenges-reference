# Daftar platform

A small job platform: you type a sentence, a worker shouts it back and counts the words.

## Run it

You need Node 16 and MySQL 5.7 on your machine.

    npm install
    npm run start:all

Then open http://localhost:3000. The database is MySQL on port 3306.

With Docker (old way):

    docker-compose up

The API is at http://localhost:3000/api and the worker polls MySQL every 5 seconds.

## Tests

    npm test

## Deploy

Copy the folder to the server with scp and run `pm2 restart all`.
