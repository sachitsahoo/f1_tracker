/**
 * scripts/backfill-race-control.ts — Backfill race_control for seeded sessions
 *
 * The `race_control` table was added after the initial seed of 89 sessions.
 * Re-running scripts/seed.ts skips sessions that already exist in the sessions
 * table, so race_control never gets populated for them. This script fixes that
 * gap without re-fetching unrelated data.
 *
 * For each session already present in the sessions table:
 *   1. GET /v1/race_control?session_key=<key> from OpenF1.
 *   2. Upsert the rows into race_control. Dedup is handled by the
 *      (session_key, date, message) unique index — re-runs are idempotent.
 *
 * Usage:
 *   npx tsx scripts/backfill-race-control.ts
 *   (reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENF1_USERNAME, OPENF1_PASSWORD)
 *
 * Optional env vars:
 *   DELAY_MS=150       # ms between OpenF1 requests (default 400)
 *   SESSION_KEY=9839   # back-fill a single session only (comma-separated for many)
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import type { RaceControl } from "../src/types/f1.ts";

// ─── Configuration ───────────────────────────────────────────────────────────

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

// ─── Startup validation ──────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.",
  );
  process.exit(1);
}
if (!OPENF1_USERNAME || !OPENF1_PASSWORD) {
  console.error("❌  OPENF1_USERNAME and OPENF1_PASSWORD are both required.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── OpenF1 token management ─────────────────────────────────────────────────
// Same pattern as scripts/seed.ts — short-lived JWT, refresh on 401.

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
  if (!body.access_token)
    throw new Error("token response missing access_token");
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function openf1Get<T>(path: string, retryOn401 = true): Promise<T> {
  await sleep(DELAY_MS);
  const token = await getBearerToken();
  const res = await fetch(`${OPENF1_BASE}${path}`, {
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
    throw new Error(`HTTP ${res.status} ${res.statusText} — GET ${path}`);
  }
  return res.json() as Promise<T>;
}

// ─── Backfill ────────────────────────────────────────────────────────────────

interface SessionRow {
  session_key: number;
  year: number;
  country_name: string | null;
  session_name: string | null;
}

async function listSessions(): Promise<SessionRow[]> {
  const query = supabase
    .from("sessions")
    .select("session_key, year, country_name, session_name")
    .order("date_start", { ascending: true });

  const { data, error } = await query;
  if (error) throw new Error(`Supabase: ${error.message}`);
  const all = (data ?? []) as SessionRow[];
  if (TARGET_SESSIONS.size === 0) return all;
  return all.filter((s) => TARGET_SESSIONS.has(s.session_key));
}

async function backfillSession(s: SessionRow): Promise<number> {
  const data = await openf1Get<RaceControl[]>(
    `/race_control?session_key=${s.session_key}`,
  );
  if (data.length === 0) return 0;

  // upsert against the (session_key, date, message) unique index — re-runs idempotent
  const rows = data.map((r) => ({
    session_key: s.session_key,
    date: r.date,
    message: r.message,
    driver_number: r.driver_number,
    flag: r.flag,
    lap_number: r.lap_number,
    scope: r.scope,
    sector: r.sector,
  }));

  const { error } = await supabase
    .from("race_control")
    .upsert(rows, {
      onConflict: "session_key,date,message",
      ignoreDuplicates: true,
    });

  if (error) throw new Error(`Supabase upsert: ${error.message}`);
  return rows.length;
}

async function main(): Promise<void> {
  console.log("F1 race_control Backfill");
  console.log("══════════════════════════════════════════════════════════");

  const sessions = await listSessions();
  console.log(`Sessions to process: ${sessions.length}`);
  if (TARGET_SESSIONS.size > 0) {
    console.log(`(filtered via SESSION_KEY=${[...TARGET_SESSIONS].join(",")})`);
  }

  const failed: string[] = [];
  const width = String(sessions.length).length;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]!;
    const counter = `[${String(i + 1).padStart(width, " ")}/${sessions.length}]`;
    const label = `${s.year} ${s.country_name ?? "?"} ${s.session_name ?? ""} (${s.session_key})`;
    process.stdout.write(`${counter} ${label} … `);
    try {
      const n = await backfillSession(s);
      console.log(`✓  ${n} messages`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗  ${msg}`);
      failed.push(`${s.session_key}: ${msg}`);
    }
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log(
    `Done. ${sessions.length - failed.length}/${sessions.length} sessions backfilled.`,
  );
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    for (const f of failed) console.log(`  ✗  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error("❌  Fatal error:", err);
  process.exit(1);
});
