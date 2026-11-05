// Release 2, the risky way (rename in one step): the column name becomes full_name in the same release.
// Release 1 cannot read this database any more. A rollback puts back the old code, and the old code breaks.
import { start } from './base.mjs';

start({
  migrate: (db) => {
    db.exec('CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    const cols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
    if (cols.includes('name')) db.exec('ALTER TABLE customers RENAME COLUMN name TO full_name');
  },
  list: (db) => db.prepare('SELECT id, full_name AS name FROM customers ORDER BY id').all(),
  add: (db, name) => db.prepare('INSERT INTO customers (full_name) VALUES (?)').run(name),
});
