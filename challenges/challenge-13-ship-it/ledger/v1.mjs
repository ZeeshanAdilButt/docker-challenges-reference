// Release 1: the table has one name column.
import { start } from './base.mjs';

start({
  migrate: (db) => db.exec('CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'),
  list: (db) => db.prepare('SELECT id, name FROM customers ORDER BY id').all(),
  add: (db, name) => db.prepare('INSERT INTO customers (name) VALUES (?)').run(name),
});
