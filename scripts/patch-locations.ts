/**
 * scripts/patch-locations.ts — Patch locations table with end-of-lap snapshots
 *
 * The seed script stored the car position at `lap.date_start` (start of lap).
 * This script updates every row in the `locations` table to instead store the
 * position at `lap.date_start + lap.lap_duration` (end of lap / start of next).
 *
 * Why end-of-lap?
 *   The replay UI scrubs to a lap boundary and shows "where everyone finished
 *   that lap". Using the lap-start position shows where drivers were at the
 *   previous lap boundary — visually off by a full lap's worth of distance.
 *
 * What this script does:
 *   1. Reads all seeded sessions from the DB.
 *   2. For each session, reads laps grouped by driver.
 *   3. For each driver, fetches their full location history from OpenF1 (1 call).
 *   4. For each lap, finds the closest location to date_start + lap_duration.
 *   5. UPDATEs the locations row (same PK, new x/y/z/date).
 *
 * Idempotency:
 *   Running the script twice produces the same result — UPDATE is safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/patch-locations.ts
 *   (reads SUPABASE_URL, OPENF1_USERNAME, OPENF1_PASSWORD from .env)
 *
 * Optional env var:
 *   DELAY_MS=150       # ms between OpenF1 requests (default 400)
 *   SESSION_KEY=9958   # patch a single session only (for testing)
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
// pg is no longer needed — all DB access goes through the Supabase JS client
import type { Location, Lap } from "../src/types/f1.ts";

// ─── Configuration ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env["SUPABASE_URL"];
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const OPENF1_USERNAME = process.env["OPENF1_USERNAME"];
const OPENF1_PASSWORD = process.env["OPENF1_PASSWORD"];
const DELAY_MS = Number(process.env["DELAY_MS"] ?? 400);
const TARGET_SESSIONS: Set<number> = process.env["SESSION_KEY"]
  ? new Set(process.env["SESSION_KEY"].split(",").map(Number))
  : new Set();

const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_TOKEN_URL = "https://api.openf1.org/token";

// ─── Startup validation ────────────────────────────────────────────────────────

if (!SUPABASE_URL) {
  console.error("❌  SUPABASE_URL environment variable is required.");
  process.exit(1);
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌  SUPABASE_SERVICE_ROLE_KEY environment variable is required.",
  );
  process.exit(1);
}
if (!OPENF1_USERNAME || !OPENF1_PASSWORD) {
  console.error("❌  OPENF1_USERNAME and OPENF1_PASSWORD are both required.");
  process.exit(1);
}

// ─── Token management (mirrors seed.ts) ───────────────────────────────────────

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

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
    throw new Error(`OpenF1 token endpoint returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("No access_token in token response");
  return body.access_token;
}

async function getBearerToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken;
  console.log("  🔑  Fetching fresh OpenF1 JWT…");
  _cachedToken = await fetchFreshToken();
  _tokenExpiresAt = Date.now() + 3_500_000;
  return _cachedToken;
}

function invalidateToken(): void {
  _cachedToken = null;
  _tokenExpiresAt = 0;
}

// ─── OpenF1 fetch (mirrors seed.ts) ───────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function openf1Get<T>(path: string, retryOn401 = true): Promise<T> {
  await sleep(DELAY_MS);
  const url = `${OPENF1_BASE}${path}`;
  const token = await getBearerToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && retryOn401) {
    console.log("    🔄  Token expired (401) — refreshing and retrying…");
    invalidateToken();
    return openf1Get<T>(path, false);
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

// ─── Binary search (mirrors seed.ts) ──────────────────────────────────────────

function closestByDate(sorted: Location[], targetMs: number): Location | null {
  if (sorted.length === 0) return null;

  let lo = 0;
  let hi = sorted.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (new Date(sorted[mid]!.date).getTime() < targetMs) lo = mid + 1;
    else hi = mid;
  }

  if (lo === 0) return sorted[0]!;

  const before = sorted[lo - 1]!;
  const after = sorted[lo]!;
  const diffBefore = targetMs - new Date(before.date).getTime();
  const diffAfter = new Date(after.date).getTime() - targetMs;

  return diffBefore <= diffAfter ? before : after;
}

// ─── Supabase client ───────────────────────────────────────────────────────────

// Non-null assertions safe — startup validation already exited if missing.
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// ─── DB helpers ────────────────────────────────────────────────────────────────

interface SessionRow {
  session_key: number;
  country_name: string;
  year: number;
  session_name: string;
}

async function getSeededSessions(): Promise<SessionRow[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("session_key, country_name, year, session_name")
    .order("year")
    .order("session_key");
  if (error) throw new Error(`getSeededSessions: ${error.message}`);
  return (data ?? []) as SessionRow[];
}

interface LapRow {
  driver_number: number;
  lap_number: number;
  date_start: string | null;
  lap_duration: number | null;
}

async function getLapsForSession(sessionKey: number): Promise<LapRow[]> {
  const { data, error } = await supabase
    .from("laps")
    .select("driver_number, lap_number, date_start, lap_duration")
    .eq("session_key", sessionKey)
    .order("driver_number")
    .order("lap_number");
  if (error)
    throw new Error(`getLapsForSession(${sessionKey}): ${error.message}`);
  return (data ?? []) as LapRow[];
}

/**
 * Returns the set of (driver_number, lap_number) pairs that actually have a
 * row in the locations table for this session. We only UPDATE rows that exist
 * — no new rows are inserted.
 */
async function getExistingLocationKeys(
  sessionKey: number,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("locations")
    .select("driver_number, lap_number")
    .eq("session_key", sessionKey);
  if (error)
    throw new Error(`getExistingLocationKeys(${sessionKey}): ${error.message}`);
  return new Set((data ?? []).map((r) => `${r.driver_number}:${r.lap_number}`));
}

// ─── Core patch logic ──────────────────────────────────────────────────────────

async function patchSession(session: SessionRow): Promise<void> {
  const { session_key } = session;
  const label = `${session.year} ${session.country_name} — ${session.session_name} (${session_key})`;
  console.log(`\nPatching ${label}`);

  // Load laps and existing location rows from DB
  const laps = await getLapsForSession(session_key);
  if (laps.length === 0) {
    console.log("  ↩  No laps in DB — skipping");
    return;
  }

  const existingKeys = await getExistingLocationKeys(session_key);
  if (existingKeys.size === 0) {
    console.log("  ↩  No location rows in DB — skipping");
    return;
  }

  // Group laps by driver
  const lapsByDriver = new Map<number, LapRow[]>();
  for (const lap of laps) {
    let bucket = lapsByDriver.get(lap.driver_number);
    if (!bucket) {
      bucket = [];
      lapsByDriver.set(lap.driver_number, bucket);
    }
    bucket.push(lap);
  }

  let totalUpdated = 0;
  let totalSkipped = 0;
  const driverList = [...lapsByDriver.keys()];
  const driverTotal = driverList.length;
  let driverIdx = 0;

  for (const [driverNumber, driverLaps] of lapsByDriver) {
    driverIdx++;
    process.stdout.write(
      `  [${String(driverIdx).padStart(2)}/${driverTotal}] driver ${driverNumber} — fetching locations…`,
    );

    // One API call per driver for all their location records
    let locations: Location[];
    try {
      locations = await openf1Get<Location[]>(
        `/location?session_key=${session_key}&driver_number=${driverNumber}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(` ✗ ${msg}\n`);
      totalSkipped += driverLaps.length;
      continue;
    }

    if (locations.length === 0) {
      process.stdout.write(` (no data)\n`);
      totalSkipped += driverLaps.length;
      continue;
    }

    // Sort ascending by date once — O(N log N)
    locations.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Build UPDATE statements for each lap
    for (const lap of driverLaps) {
      const key = `${driverNumber}:${lap.lap_number}`;
      if (!existingKeys.has(key)) {
        // No location row for this lap — seed script skipped it, we do too
        totalSkipped++;
        continue;
      }

      if (!lap.date_start) {
        totalSkipped++;
        continue;
      }

      // ── End-of-lap target: date_start + lap_duration (90 s fallback) ──────────
      // Fallback 90 s is the approximate duration of a typical F1 lap if
      // lap_duration is null (e.g. pit-out laps, DNF laps with no timing data).
      const lapDurationSec = lap.lap_duration ?? 90;
      const targetMs =
        new Date(lap.date_start).getTime() + lapDurationSec * 1_000;

      const closest = closestByDate(locations, targetMs);
      if (!closest) {
        totalSkipped++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("locations")
        .update({
          x: closest.x,
          y: closest.y,
          z: closest.z,
          date: closest.date,
        })
        .eq("session_key", session_key)
        .eq("driver_number", driverNumber)
        .eq("lap_number", lap.lap_number);
      if (updateError) throw new Error(`UPDATE failed: ${updateError.message}`);

      totalUpdated++;
    }

    // Count how many laps were actually updated for this driver
    const driverUpdated = driverLaps.filter((l) =>
      existingKeys.has(`${driverNumber}:${l.lap_number}`),
    ).length;
    process.stdout.write(` ✓ ${driverUpdated} laps updated\n`);
  }

  console.log(
    `  ✓  Total: ${totalUpdated} rows updated` +
      (totalSkipped > 0 ? `, ${totalSkipped} skipped` : ""),
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("F1 Location Patch — end-of-lap snapshot");
  console.log("══════════════════════════════════════════════════════════");

  const sessions = await getSeededSessions();

  const toProcess =
    TARGET_SESSIONS.size > 0
      ? sessions.filter((s) => TARGET_SESSIONS.has(s.session_key))
      : sessions;

  if (toProcess.length === 0) {
    if (TARGET_SESSIONS.size > 0) {
      console.error(
        `❌  None of SESSION_KEY=${[...TARGET_SESSIONS].join(",")} found in the sessions table.`,
      );
    } else {
      console.log("No sessions found in DB — nothing to patch.");
    }
    return;
  }

  console.log(
    `Processing ${toProcess.length} session${toProcess.length !== 1 ? "s" : ""}…`,
  );
  console.log(`DELAY_MS=${DELAY_MS}`);
  console.log("══════════════════════════════════════════════════════════");

  const failed: string[] = [];

  for (const session of toProcess) {
    try {
      await patchSession(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗  Failed: ${msg}`);
      failed.push(
        `session ${session.session_key} (${session.year} ${session.country_name}): ${msg}`,
      );
    }
  }

  const succeeded = toProcess.length - failed.length;
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(
    `Done. ${succeeded}/${toProcess.length} sessions patched successfully.`,
  );

  if (failed.length > 0) {
    console.log(`\nFailed sessions (${failed.length}) — re-run to retry:`);
    for (const f of failed) console.log(`  ✗  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error("\n❌  Fatal error:", err);
  process.exit(1);
});
