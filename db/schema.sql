-- F1 Live Tracker — PostgreSQL schema
-- Run once to create tables, or let scripts/seed.ts run it automatically.
-- All tables use ON CONFLICT DO NOTHING — safe to re-apply.

-- ─── Design note: DEFERRABLE INITIALLY DEFERRED foreign keys ─────────────────
--
-- All session_key foreign keys are declared DEFERRABLE INITIALLY DEFERRED.
--
-- The seed script inserts child rows (drivers, positions, …) first inside a
-- transaction, then inserts the sessions row LAST as a "fully seeded" marker.
-- With an immediate FK check that ordering would cause a constraint violation
-- the moment the first INSERT into drivers runs.
--
-- DEFERRABLE INITIALLY DEFERRED shifts the check to COMMIT time, when the
-- sessions row already exists. The transaction is still atomic — a failure at
-- any point rolls everything back and leaves no partial data.
--
-- All FK constraints are given explicit names (tablename_session_key_fkey) so
-- the migration block at the bottom of this file can find and patch them on
-- databases created before this change.

-- ─── Sessions ─────────────────────────────────────────────────────────────────
-- One row per OpenF1 session that has been fully seeded.
-- Inserted LAST inside the seed transaction — its presence == complete data.

CREATE TABLE IF NOT EXISTS sessions (
  session_key         INTEGER PRIMARY KEY,
  session_name        TEXT,
  session_type        TEXT        NOT NULL,  -- 'Race' | 'Sprint' | etc.
  date_start          TIMESTAMPTZ,
  date_end            TIMESTAMPTZ,
  circuit_key         INTEGER,
  circuit_short_name  TEXT,
  country_name        TEXT,
  year                INTEGER     NOT NULL,
  location            TEXT
);

-- ─── Drivers ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drivers (
  session_key    INTEGER NOT NULL,
  driver_number  INTEGER NOT NULL,
  broadcast_name TEXT,
  full_name      TEXT,
  name_acronym   TEXT,
  team_name      TEXT,
  team_colour    TEXT,
  headshot_url   TEXT,
  PRIMARY KEY (session_key, driver_number),
  CONSTRAINT drivers_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED
);

-- ─── Positions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS positions (
  session_key   INTEGER     NOT NULL,
  driver_number INTEGER     NOT NULL,
  date          TIMESTAMPTZ NOT NULL,
  position      INTEGER     NOT NULL,
  PRIMARY KEY (session_key, driver_number, date),
  CONSTRAINT positions_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS positions_session_date_idx
  ON positions (session_key, date);

-- ─── Intervals ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS intervals (
  session_key   INTEGER     NOT NULL,
  driver_number INTEGER     NOT NULL,
  date          TIMESTAMPTZ NOT NULL,
  gap_to_leader TEXT,
  interval      TEXT,
  PRIMARY KEY (session_key, driver_number, date),
  CONSTRAINT intervals_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS intervals_session_date_idx
  ON intervals (session_key, date);

-- ─── Stints ───────────────────────────────────────────────────────────────────

-- lap_start is nullable: OpenF1 omits it on some early-season stints.
-- Because a PRIMARY KEY column cannot be NULL, we use a surrogate BIGSERIAL
-- and a partial unique index for deduplication on the natural key.
CREATE TABLE IF NOT EXISTS stints (
  id                BIGSERIAL NOT NULL,
  session_key       INTEGER   NOT NULL,
  driver_number     INTEGER   NOT NULL,
  lap_start         INTEGER,
  lap_end           INTEGER,
  compound          TEXT,
  tyre_age_at_start INTEGER,
  PRIMARY KEY (id),
  CONSTRAINT stints_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED
);

-- Deduplication for stints where lap_start is known
CREATE UNIQUE INDEX IF NOT EXISTS stints_natural_key_idx
  ON stints (session_key, driver_number, lap_start)
  WHERE lap_start IS NOT NULL;

-- ─── Laps ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS laps (
  session_key       INTEGER     NOT NULL,
  driver_number     INTEGER     NOT NULL,
  lap_number        INTEGER     NOT NULL,
  date_start        TIMESTAMPTZ,
  lap_duration      REAL,
  duration_sector_1 REAL,
  duration_sector_2 REAL,
  duration_sector_3 REAL,
  is_pit_out_lap    BOOLEAN,
  PRIMARY KEY (session_key, driver_number, lap_number),
  CONSTRAINT laps_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED
);

-- ─── Locations ────────────────────────────────────────────────────────────────
-- One X/Y/Z snapshot per driver per lap (not raw telemetry).

CREATE TABLE IF NOT EXISTS locations (
  session_key   INTEGER     NOT NULL,
  driver_number INTEGER     NOT NULL,
  lap_number    INTEGER     NOT NULL,
  date          TIMESTAMPTZ NOT NULL,
  x             INTEGER     NOT NULL,
  y             INTEGER     NOT NULL,
  z             INTEGER     NOT NULL,
  PRIMARY KEY (session_key, driver_number, lap_number),
  CONSTRAINT locations_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED
);

-- ─── Migration: patch existing non-deferrable FK constraints ──────────────────
-- Safe to run repeatedly. DROP CONSTRAINT IF EXISTS is a no-op when the
-- constraint does not exist (fresh database, or already patched).

DO $$ BEGIN
  -- Patch stints table: switch from (session_key, driver_number, lap_start) PK
  -- to a surrogate BIGSERIAL id so lap_start can be nullable.
  -- Safe to run repeatedly — the IF NOT EXISTS guard is a no-op on fresh DBs
  -- and on DBs that were already patched.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stints' AND column_name = 'id'
  ) THEN
    ALTER TABLE stints DROP CONSTRAINT IF EXISTS stints_pkey;
    ALTER TABLE stints ALTER COLUMN lap_start DROP NOT NULL;
    ALTER TABLE stints ADD COLUMN id BIGSERIAL;
    ALTER TABLE stints ADD PRIMARY KEY (id);
    CREATE UNIQUE INDEX IF NOT EXISTS stints_natural_key_idx
      ON stints (session_key, driver_number, lap_start)
      WHERE lap_start IS NOT NULL;
  END IF;

  ALTER TABLE drivers   DROP CONSTRAINT IF EXISTS drivers_session_key_fkey;
  ALTER TABLE drivers   ADD  CONSTRAINT drivers_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED;

  ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_session_key_fkey;
  ALTER TABLE positions ADD  CONSTRAINT positions_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED;

  ALTER TABLE intervals DROP CONSTRAINT IF EXISTS intervals_session_key_fkey;
  ALTER TABLE intervals ADD  CONSTRAINT intervals_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED;

  ALTER TABLE stints    DROP CONSTRAINT IF EXISTS stints_session_key_fkey;
  ALTER TABLE stints    ADD  CONSTRAINT stints_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED;

  ALTER TABLE laps      DROP CONSTRAINT IF EXISTS laps_session_key_fkey;
  ALTER TABLE laps      ADD  CONSTRAINT laps_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED;

  ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_session_key_fkey;
  ALTER TABLE locations ADD  CONSTRAINT locations_session_key_fkey
    FOREIGN KEY (session_key) REFERENCES sessions (session_key)
    DEFERRABLE INITIALLY DEFERRED;
END; $$;
