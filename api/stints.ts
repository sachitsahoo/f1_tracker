import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import type { Stint } from "../src/types/f1.ts";
import { checkRateLimit, clientIp } from "../lib/rateLimit";

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (checkRateLimit(clientIp(req), "data")) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  // ── Required: session_key ────────────────────────────────────────────────────
  const rawSessionKey = req.query["session_key"];
  if (!rawSessionKey || Array.isArray(rawSessionKey)) {
    res
      .status(400)
      .json({ error: "Missing required query parameter: session_key" });
    return;
  }
  const sessionKey = Number(rawSessionKey);
  if (!Number.isInteger(sessionKey) || sessionKey <= 0) {
    res.status(400).json({ error: "session_key must be a positive integer" });
    return;
  }

  // ── Optional: driver_number ──────────────────────────────────────────────────
  let driverNumber: number | null = null;
  const rawDriverNumber = req.query["driver_number"];
  if (rawDriverNumber !== undefined) {
    if (Array.isArray(rawDriverNumber)) {
      res.status(400).json({ error: "driver_number must be a single value" });
      return;
    }
    driverNumber = Number(rawDriverNumber);
    if (!Number.isInteger(driverNumber) || driverNumber <= 0) {
      res
        .status(400)
        .json({ error: "driver_number must be a positive integer" });
      return;
    }
  }

  // ── Environment validation ───────────────────────────────────────────────────
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Database not configured" });
    return;
  }

  // ── Query Supabase ───────────────────────────────────────────────────────────
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query = supabase
      .from("stints")
      .select(
        "session_key, driver_number, lap_start, lap_end, compound, tyre_age_at_start",
      )
      .eq("session_key", sessionKey)
      .order("driver_number", { ascending: true })
      // Rows where lap_start IS NULL sort first with ascending nullsFirst;
      // order by lap_start ascending after driver grouping for chronological stints.
      .order("lap_start", { ascending: true, nullsFirst: true });

    if (driverNumber !== null) {
      query = query.eq("driver_number", driverNumber);
    }

    const { data, error } = await query.returns<Stint[]>();

    if (error) {
      console.error("[api/stints] Supabase error:", error.message);
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    // lap_start is nullable — the column is typed INTEGER / null in the DB and
    // the Stint interface already declares it as number (the seed inserts null
    // directly). No coercion needed; just pass through as-is so consumers can
    // handle null gracefully (e.g. stints seeded before a driver's first lap).
    res
      .setHeader("Cache-Control", "no-store")
      .status(200)
      .json(data ?? []);
  } catch (err) {
    console.error("[api/stints] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
