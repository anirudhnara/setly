-- Tiger Data is managed Postgres with TimescaleDB.
-- Run this once after the Drizzle migration that creates price_points.
-- The primary key already includes observed_at, which TimescaleDB requires.
SELECT create_hypertable('price_points', 'observed_at', if_not_exists => TRUE);
