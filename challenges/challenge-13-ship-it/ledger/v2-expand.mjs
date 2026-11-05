// Release 2, the careful way (expand): ADD a new column full_name, copy the data, write BOTH columns, read the new one.
// The old column stays. Release 1 can still run against this database, so you can roll back.
import { start } from './base.mjs';

start({
  migrate: (db) => {
    db.exec('CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    const cols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
    if (!cols.includes('full_name')) db.exec('ALTER TABLE customers ADD COLUMN full_name TEXT');
    db.exec('UPDATE customers SET full_name = name WHERE full_name IS NULL');
  },
  list: (db) => db.prepare('SELECT id, COALESCE(full_name, name) AS name FROM customers ORDER BY id').all(),
  add: (db, name) => db.prepare('INSERT INTO customers (name, full_name) VALUES (?, ?)').run(name, name),
});
