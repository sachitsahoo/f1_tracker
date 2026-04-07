import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, clientIp } from "./_shared";
import { createClient } from "@supabase/supabase-js";

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

  // ── Env validation ───────────────────────────────────────────────────────────

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Database credentials not configured" });
    return;
  }

  // ── Query param validation ───────────────────────────────────────────────────

  const { session_key, driver_number, lap_number } = req.query;

  if (!session_key || typeof session_key !== "string") {
    res
      .status(400)
      .json({ error: "Missing required query parameter: session_key" });
    return;
  }

  const sessionKeyNum = Number(session_key);
  if (!Number.isInteger(sessionKeyNum) || sessionKeyNum <= 0) {
    res.status(400).json({ error: "session_key must be a positive integer" });
    return;
  }

  let driverNumberNum: number | undefined;
  if (driver_number !== undefined) {
    if (typeof driver_number !== "string") {
      res.status(400).json({ error: "driver_number must be a single value" });
      return;
    }
    driverNumberNum = Number(driver_number);
    if (!Number.isInteger(driverNumberNum) || driverNumberNum <= 0) {
      res
        .status(400)
        .json({ error: "driver_number must be a positive integer" });
      return;
    }
  }

  let lapNumberNum: number | undefined;
  if (lap_number !== undefined) {
    if (typeof lap_number !== "string") {
      res.status(400).json({ error: "lap_number must be a single value" });
      return;
    }
    lapNumberNum = Number(lap_number);
    if (!Number.isInteger(lapNumberNum) || lapNumberNum <= 0) {
      res.status(400).json({ error: "lap_number must be a positive integer" });
      return;
    }
  }

  // ── Supabase query ───────────────────────────────────────────────────────────

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query = supabase
      .from("locations")
      .select("session_key, driver_number, lap_number, date, x, y, z")
      .eq("session_key", sessionKeyNum);

    if (driverNumberNum !== undefined) {
      query = query.eq("driver_number", driverNumberNum);
    }

    if (lapNumberNum !== undefined) {
      query = query.eq("lap_number", lapNumberNum);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[/api/locations] Supabase error:", error.message);
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=30");
    res.status(200).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/locations] Unexpected error:", message);
    res.status(500).json({ error: "Internal server error" });
  }
}
