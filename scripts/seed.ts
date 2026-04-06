/**
 * scripts/seed.ts — Historical data seed script
 *
 * Fetches every Race session from 2023–2025 via the OpenF1 REST API and
 * persists the data needed for leaderboard display and lap-by-lap replay.
 *
 * What is stored per session:
 *   /v1/drivers   → drivers table     (full roster, static per session)
 *   /v1/position  → positions table   (all records — leaderboard over time)
 *   /v1/intervals → intervals table   (all records — gap data over time)
 *   /v1/stints    → stints table      (tire compounds per driver)
 *   /v1/laps      → laps table        (lap/sector times per driver)
 *   /v1/location  → locations table   (ONE snapshot per driver per lap,
 *                                      closest to lap date_start — not raw telemetry)
 *
 * Idempotency:
 *   The sessions table row is inserted LAST inside a transaction. Its presence
 *   means all child data for that session is complete. Re-running the script
 *   skips any session_key already in the sessions table.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host/db \
 *   OPENF1_API_KEY=<your_key>               \
 *   npx tsx scripts/seed.ts
 *
 * Estimated runtime: ~15–20 minutes for 70 sessions (dominated by the 400ms
 * inter-request delay and one location fetch per driver per session).
 */

import pg from "pg";
import type { PoolClient } from "pg";
import type {
  Session,
  Driver,
  Position,
  Interval,
  Stint,
  Lap,
  Location,
} from "../src/types/f1.ts";

// ─── Configuration ────────────────────────────────────────────────────────────

const DATABASE_URL = process.env["DATABASE_URL"];
const OPENF1_USERNAME = process.env["OPENF1_USERNAME"];
const OPENF1_PASSWORD = process.env["OPENF1_PASSWORD"];

const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_TOKEN_URL = "https://api.openf1.org/token";
/** 400 ms between requests. Can be reduced to ~150 ms with a paid subscription. */
const DELAY_MS = 400;
/** Rows per INSERT batch — stays under pg's 65 535 parameter limit. */
const BATCH_SIZE = 500;
/** Years to seed. Adjust as new seasons complete. */
const SEED_YEARS = [2023, 2024, 2025] as const;

// ─── Startup validation ───────────────────────────────────────────────────────

if (!DATABASE_URL) {
  console.error("❌  DATABASE_URL environment variable is required.");
  console.error(
    "    Example: DATABASE_URL=postgres://user:pass@localhost/f1 npx tsx scripts/seed.ts",
  );
  process.exit(1);
}
if (!OPENF1_USERNAME || !OPENF1_PASSWORD) {
  console.error("❌  OPENF1_USERNAME and OPENF1_PASSWORD are both required.");
  console.error(
    "    These are your OpenF1 account credentials, not a pre-baked token.",
  );
  console.error(
    "    The script exchanges them for a fresh JWT on startup (same flow as api/token.ts).",
  );
  process.exit(1);
}

// ─── OpenF1 token management ──────────────────────────────────────────────────
// OpenF1's paid API uses short-lived JWTs (≈ 3600 s).
// Mirrors the caching + refresh logic in api/token.ts.

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0; // Date.now() ms

/**
 * POST to the OpenF1 token endpoint with username + password.
 * Returns the raw access_token JWT string.
 * Throws on any non-2xx response.
 */
async function fetchFreshToken(): Promise<string> {
  const res = await fetch(OPENF1_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: OPENF1_USERNAME as string,
      password: OPENF1_PASSWORD as string,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `OpenF1 token endpoint returned HTTP ${res.status} — check OPENF1_USERNAME / OPENF1_PASSWORD`,
    );
  }

  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("OpenF1 token response did not contain access_token");
  }

  return body.access_token;
}

/**
 * Returns a valid Bearer token, fetching or refreshing as needed.
 * Caches for 3500 s (100 s safety margin before OpenF1's ~3600 s expiry).
 */
async function getBearerToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken;

  console.log("  🔑  Fetching fresh OpenF1 JWT…");
  _cachedToken = await fetchFreshToken();
  _tokenExpiresAt = Date.now() + 3_500_000; // 3500 s
  return _cachedToken;
}

/** Invalidate the cache so the next getBearerToken() call fetches a new token. */
function invalidateToken(): void {
  _cachedToken = null;
  _tokenExpiresAt = 0;
}

// ─── Database pool ────────────────────────────────────────────────────────────

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Thrown by seedDrivers() when OpenF1 returns 404 or an empty roster for a
 * session. Signals that the race never took place (e.g. a cancelled event)
 * and the entire session should be skipped without seeding any other endpoint.
 */
class CancelledSessionError extends Error {
  constructor(sessionKey: number, reason: string) {
    super(`session ${sessionKey} cancelled — ${reason}`);
    this.name = "CancelledSessionError";
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET a path from the OpenF1 REST API.
 *
 * - Waits DELAY_MS before every request (rate-limit courtesy).
 * - Fetches / caches a JWT via getBearerToken() — never uses a stale env token.
 * - On 401: invalidates the cached token, fetches a fresh one, retries once.
 *   This handles mid-run token expiry (seed runs can exceed the ~3600 s JWT lifetime).
 * - On 429: backs off 60 s and retries (same as fetchWithRetry in openf1.ts).
 * - On any other non-2xx: throws with the HTTP status and URL.
 */
async function openf1Get<T>(path: string, retryOn401 = true): Promise<T> {
  await sleep(DELAY_MS);

  const url = `${OPENF1_BASE}${path}`;
  const token = await getBearerToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && retryOn401) {
    // Token expired mid-run — invalidate cache and retry with a fresh one
    console.log("    🔄  Token expired (401) — refreshing and retrying…");
    invalidateToken();
    return openf1Get<T>(path, false); // false = don't recurse on a second 401
  }

  if (res.status === 429) {
    console.log("    ⚠  Rate limited — waiting 60 s then retrying…");
    await sleep(60_000);
    return openf1Get<T>(path, retryOn401);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — GET ${url}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Insert rows into `table` in batches of BATCH_SIZE using ON CONFLICT DO NOTHING.
 *
 * buildValues(row) must return exactly `cols.length` values in column order.
 * Returns the total number of rows newly inserted (conflicts count as 0).
 */
async function bulkInsert<T>(
  client: PoolClient,
  table: string,
  cols: readonly string[],
  rows: T[],
  buildValues: (row: T) => unknown[],
): Promise<number> {
  if (rows.length === 0) return 0;

  let total = 0;

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const params: unknown[] = [];
    const placeholders: string[] = [];

    for (const row of batch) {
      const vals = buildValues(row);
      const offset = params.length;
      const rowPlaceholders = vals
        .map((_, i) => `$${offset + i + 1}`)
        .join(",");
      placeholders.push(`(${rowPlaceholders})`);
      params.push(...vals);
    }

    const sql = `
      INSERT INTO ${table} (${cols.join(",")})
      VALUES ${placeholders.join(",")}
      ON CONFLICT DO NOTHING
    `;

    const result = await client.query(sql, params);
    total += result.rowCount ?? 0;
  }

  return total;
}

/**
 * Binary search `sorted` (ascending by `date`) for the Location record whose
 * timestamp is closest to `targetMs`. Returns null only when the array is empty.
 *
 * O(log N) per call — sort once per driver, then search once per lap.
 */
function closestByDate(sorted: Location[], targetMs: number): Location | null {
  if (sorted.length === 0) return null;

  let lo = 0;
  let hi = sorted.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // Non-null assertion: lo/hi are always valid indices within sorted
    if (new Date(sorted[mid]!.date).getTime() < targetMs) lo = mid + 1;
    else hi = mid;
  }

  // lo is now the index of the first element ≥ target.
  // Compare with the element just before it to find the truly closest one.
  if (lo === 0) return sorted[0]!;

  const before = sorted[lo - 1]!;
  const after = sorted[lo]!;

  const diffBefore = targetMs - new Date(before.date).getTime();
  const diffAfter = new Date(after.date).getTime() - targetMs;

  return diffBefore <= diffAfter ? before : after;
}

// ─── Schema bootstrap ─────────────────────────────────────────────────────────

/**
 * Create all tables if they do not already exist.
 * Mirrors db/schema.sql — see that file for column documentation.
 */
/**
 * Create all tables (if not already present) and ensure every session_key
 * foreign key is DEFERRABLE INITIALLY DEFERRED.
 *
 * Why deferred FKs?
 *   Child rows (drivers, positions, …) are inserted BEFORE the sessions row
 *   inside a single transaction. The sessions row is inserted LAST as a
 *   "fully seeded" marker. DEFERRABLE INITIALLY DEFERRED shifts the FK check
 *   to COMMIT time, when the sessions row already exists.
 *
 * The DO $$ block is idempotent: DROP CONSTRAINT IF EXISTS is a no-op when
 * the constraint is absent (fresh DB) or has already been patched.
 */
async function ensureSchema(client: PoolClient): Promise<void> {
  // ── Create tables ────────────────────────────────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_key         INTEGER PRIMARY KEY,
      session_name        TEXT,
      session_type        TEXT        NOT NULL,
      date_start          TIMESTAMPTZ,
      date_end            TIMESTAMPTZ,
      circuit_key         INTEGER,
      circuit_short_name  TEXT,
      country_name        TEXT,
      year                INTEGER     NOT NULL,
      location            TEXT
    );

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

    CREATE UNIQUE INDEX IF NOT EXISTS stints_natural_key_idx
      ON stints (session_key, driver_number, lap_start)
      WHERE lap_start IS NOT NULL;

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
  `);

  // ── Patch any pre-existing non-deferrable FK constraints ─────────────────────
  // DROP CONSTRAINT IF EXISTS is a no-op on a fresh database or if the
  // constraint was already created as DEFERRABLE (CREATE TABLE IF NOT EXISTS
  // above skips the body when the table exists, so existing constraints are
  // unchanged — this block corrects them).
  await client.query(`
    DO $$ BEGIN
      -- Patch stints: switch to surrogate BIGSERIAL PK so lap_start can be nullable.
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
  `);
}

// ─── Per-endpoint seeders ─────────────────────────────────────────────────────

async function seedDrivers(
  client: PoolClient,
  sessionKey: number,
): Promise<number> {
  let data: Driver[];
  try {
    data = await openf1Get<Driver[]>(`/drivers?session_key=${sessionKey}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("HTTP 404")) {
      // 404 on drivers means the race never took place (e.g. cancelled event).
      // Throw so seedSession aborts cleanly — no point hitting the other
      // endpoints for a session that has no data at all.
      throw new CancelledSessionError(
        sessionKey,
        "drivers endpoint returned 404",
      );
    }
    throw err;
  }

  if (data.length === 0) {
    throw new CancelledSessionError(
      sessionKey,
      "drivers endpoint returned empty roster",
    );
  }

  return bulkInsert(
    client,
    "drivers",
    [
      "session_key",
      "driver_number",
      "broadcast_name",
      "full_name",
      "name_acronym",
      "team_name",
      "team_colour",
      "headshot_url",
    ] as const,
    data,
    (d) => [
      sessionKey,
      d.driver_number,
      d.broadcast_name ?? null,
      d.full_name ?? null,
      d.name_acronym ?? null,
      d.team_name ?? null,
      d.team_colour ?? null,
      d.headshot_url ?? null,
    ],
  );
}

async function seedPositions(
  client: PoolClient,
  sessionKey: number,
): Promise<number> {
  const data = await openf1Get<Position[]>(
    `/position?session_key=${sessionKey}`,
  );

  return bulkInsert(
    client,
    "positions",
    ["session_key", "driver_number", "date", "position"] as const,
    data,
    (r) => [sessionKey, r.driver_number, r.date, r.position],
  );
}

async function seedIntervals(
  client: PoolClient,
  sessionKey: number,
): Promise<number> {
  const data = await openf1Get<Interval[]>(
    `/intervals?session_key=${sessionKey}`,
  );

  return bulkInsert(
    client,
    "intervals",
    [
      "session_key",
      "driver_number",
      "date",
      "gap_to_leader",
      "interval",
    ] as const,
    data,
    (r) => [
      sessionKey,
      r.driver_number,
      r.date,
      // gap_to_leader and interval can be string | number | null — store as TEXT
      r.gap_to_leader != null ? String(r.gap_to_leader) : null,
      r.interval != null ? String(r.interval) : null,
    ],
  );
}

async function seedStints(
  client: PoolClient,
  sessionKey: number,
): Promise<number> {
  const data = await openf1Get<Stint[]>(`/stints?session_key=${sessionKey}`);

  return bulkInsert(
    client,
    "stints",
    [
      "session_key",
      "driver_number",
      "lap_start",
      "lap_end",
      "compound",
      "tyre_age_at_start",
    ] as const,
    data,
    (r) => [
      sessionKey,
      r.driver_number,
      r.lap_start,
      r.lap_end ?? null,
      r.compound ?? null,
      // tyre_age_at_start is typed as number but OpenF1 can return null
      (r.tyre_age_at_start as number | null) ?? null,
    ],
  );
}

/**
 * Fetch laps, insert them, and return the raw array.
 * The caller needs the raw data to drive the location snapshot logic.
 */
async function seedLaps(
  client: PoolClient,
  sessionKey: number,
): Promise<Lap[]> {
  const data = await openf1Get<Lap[]>(`/laps?session_key=${sessionKey}`);

  await bulkInsert(
    client,
    "laps",
    [
      "session_key",
      "driver_number",
      "lap_number",
      "date_start",
      "lap_duration",
      "duration_sector_1",
      "duration_sector_2",
      "duration_sector_3",
      "is_pit_out_lap",
    ] as const,
    data,
    (r) => [
      sessionKey,
      r.driver_number,
      r.lap_number,
      r.date_start ?? null,
      r.lap_duration ?? null,
      r.duration_sector_1 ?? null,
      r.duration_sector_2 ?? null,
      r.duration_sector_3 ?? null,
      r.is_pit_out_lap,
    ],
  );

  return data;
}

/**
 * For each driver in the session:
 *   1. Fetch ALL of their location records for the session (one API call).
 *   2. Sort ascending by date once — O(N log N).
 *   3. For each lap this driver ran, binary-search for the record closest
 *      to lap.date_start — O(L log N) per driver.
 *   4. Bulk-insert those snapshots (one row per driver per lap).
 *
 * This approach keeps API calls to N_drivers (≈ 20) rather than
 * N_drivers × N_laps (≈ 1 300), while still only storing one point per lap.
 */
async function seedLocationSnapshots(
  client: PoolClient,
  sessionKey: number,
  laps: Lap[],
): Promise<number> {
  // Group laps by driver — O(total laps)
  const lapsByDriver = new Map<number, Lap[]>();
  for (const lap of laps) {
    let bucket = lapsByDriver.get(lap.driver_number);
    if (!bucket) {
      bucket = [];
      lapsByDriver.set(lap.driver_number, bucket);
    }
    bucket.push(lap);
  }

  type Snapshot = {
    driver_number: number;
    lap_number: number;
    date: string;
    x: number;
    y: number;
    z: number;
  };

  const snapshots: Snapshot[] = [];

  for (const [driverNumber, driverLaps] of lapsByDriver) {
    // One API call per driver — full location history for this session
    const locations = await openf1Get<Location[]>(
      `/location?session_key=${sessionKey}&driver_number=${driverNumber}`,
    );

    if (locations.length === 0) continue;

    // Sort ascending by date so binary search works — O(N log N)
    locations.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Pick one location per lap — O(L log N) total
    for (const lap of driverLaps) {
      if (!lap.date_start) continue; // safety: some laps lack a timestamp

      const targetMs = new Date(lap.date_start).getTime();
      const closest = closestByDate(locations, targetMs);
      if (!closest) continue;

      snapshots.push({
        driver_number: driverNumber,
        lap_number: lap.lap_number,
        date: closest.date,
        x: closest.x,
        y: closest.y,
        z: closest.z,
      });
    }
  }

  return bulkInsert(
    client,
    "locations",
    [
      "session_key",
      "driver_number",
      "lap_number",
      "date",
      "x",
      "y",
      "z",
    ] as const,
    snapshots,
    (r) => [sessionKey, r.driver_number, r.lap_number, r.date, r.x, r.y, r.z],
  );
}

// ─── Session-level orchestration ──────────────────────────────────────────────

/** True if this session_key already has a completed row in the sessions table. */
async function isAlreadySeeded(sessionKey: number): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key = $1) AS exists",
    [sessionKey],
  );
  return rows[0]?.exists === true;
}

/**
 * Seed one session inside a single transaction.
 *
 * Order matters:
 *   drivers → positions → intervals → stints → laps → locations → sessions
 *
 * The sessions row is inserted last. If anything fails before COMMIT the
 * transaction is rolled back and the session will be retried on the next run.
 */
async function seedSession(
  session: Session,
  index: number,
  total: number,
): Promise<void> {
  // Pad the index so columns align for all values up to `total`
  const width = String(total).length;
  const counter = `[${String(index).padStart(width, " ")}/${total}]`;
  const label = `${session.year} ${session.country_name} — ${session.session_name} (session ${session.session_key})`;

  console.log(`\n${counter} Seeding ${label}`);

  if (await isAlreadySeeded(session.session_key)) {
    console.log("  ↩  Already seeded — skipping");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const driverCount = await seedDrivers(client, session.session_key);
    console.log(`  ✓  drivers (${driverCount})`);

    const posCount = await seedPositions(client, session.session_key);
    console.log(`  ✓  positions (${posCount})`);

    const intCount = await seedIntervals(client, session.session_key);
    console.log(`  ✓  intervals (${intCount})`);

    const stintCount = await seedStints(client, session.session_key);
    console.log(`  ✓  stints (${stintCount})`);

    const laps = await seedLaps(client, session.session_key);
    console.log(`  ✓  laps (${laps.length})`);

    const uniqueDrivers = new Set(laps.map((l) => l.driver_number)).size;
    console.log(
      `  …  locations — fetching per driver (${uniqueDrivers} drivers × 1 API call each)`,
    );
    const locCount = await seedLocationSnapshots(
      client,
      session.session_key,
      laps,
    );
    console.log(`  ✓  locations (1 per driver per lap = ${locCount})`);

    // Insert the session record last — its presence is the "fully seeded" marker.
    await client.query(
      `INSERT INTO sessions
         (session_key, session_name, session_type, date_start, date_end,
          circuit_key, circuit_short_name, country_name, year, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING`,
      [
        session.session_key,
        session.session_name,
        session.session_type,
        session.date_start ?? null,
        session.date_end ?? null,
        session.circuit_key ?? null,
        session.circuit_short_name ?? null,
        session.country_name ?? null,
        session.year,
        session.location ?? null,
      ],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");

    if (err instanceof CancelledSessionError) {
      // Race never took place — insert the sessions row to mark it as processed
      // so future re-runs skip it via isAlreadySeeded() rather than hitting
      // the API again.
      await pool.query(
        `INSERT INTO sessions
           (session_key, session_name, session_type, date_start, date_end,
            circuit_key, circuit_short_name, country_name, year, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT DO NOTHING`,
        [
          session.session_key,
          session.session_name,
          session.session_type,
          session.date_start ?? null,
          session.date_end ?? null,
          session.circuit_key ?? null,
          session.circuit_short_name ?? null,
          session.country_name ?? null,
          session.year,
          session.location ?? null,
        ],
      );
      console.log(
        `  ⚠  Session ${session.session_key} skipped — cancelled event (${session.year} ${session.country_name})`,
      );
      return; // not a failure — don't add to the failed list
    }

    throw err; // re-throw unexpected errors so main() can log and continue
  } finally {
    client.release();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("F1 Historical Seed");
  console.log("══════════════════════════════════════════════════════════");

  // Bootstrap the schema (idempotent — CREATE TABLE IF NOT EXISTS)
  const schemaClient = await pool.connect();
  try {
    await ensureSchema(schemaClient);
    console.log("✓  Schema ready");
  } finally {
    schemaClient.release();
  }

  // Collect all Race sessions across the target years
  console.log(`\nFetching Race sessions for ${SEED_YEARS.join(", ")}…`);

  const allSessions: Session[] = [];
  for (const year of SEED_YEARS) {
    const sessions = await openf1Get<Session[]>(
      `/sessions?year=${year}&session_type=Race`,
    );
    console.log(`  ${year}: ${sessions.length} Race sessions`);
    allSessions.push(...sessions);
  }

  const total = allSessions.length;
  console.log(`\nTotal: ${total} sessions to process`);
  console.log("══════════════════════════════════════════════════════════");

  // Seed each session, collecting failures without aborting the run
  const failed: string[] = [];

  for (let i = 0; i < allSessions.length; i++) {
    const session = allSessions[i]!;
    try {
      await seedSession(session, i + 1, total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗  Failed: ${msg}`);
      failed.push(
        `session ${session.session_key} (${session.year} ${session.country_name}): ${msg}`,
      );
    }
  }

  // Summary
  const succeeded = total - failed.length;
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`Done. ${succeeded}/${total} sessions seeded successfully.`);

  if (failed.length > 0) {
    console.log(`\nFailed sessions (${failed.length}) — re-run to retry:`);
    for (const f of failed) console.log(`  ✗  ${f}`);
    process.exitCode = 1; // non-zero exit without throwing, so the summary always prints
  }

  await pool.end();
}

main().catch((err: unknown) => {
  console.error("\n❌  Fatal error:", err);
  process.exit(1);
});
