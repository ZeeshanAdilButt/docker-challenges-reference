-- Run once by the "migrate" job. Safe to run twice.
CREATE TABLE IF NOT EXISTS notes (
  id serial PRIMARY KEY,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs_done (
  id serial PRIMARY KEY,
  job text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now()
);
