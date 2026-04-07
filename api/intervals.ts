import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
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

  // ── Validate required query param ──────────────────────────────────────────

  const { session_key, driver_number } = req.query;

  if (!session_key || typeof session_key !== "string") {
    res
      .status(400)
      .json({ error: "Missing required query param: session_key" });
    return;
  }

  const sessionKeyNum = Number(session_key);
  if (!Number.isInteger(sessionKeyNum) || sessionKeyNum <= 0) {
    res.status(400).json({ error: "session_key must be a positive integer" });
    return;
  }

  // ── Validate optional driver_number ────────────────────────────────────────

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

  // ── Resolve Supabase credentials ───────────────────────────────────────────

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Supabase credentials not configured" });
    return;
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query = supabase
      .from("intervals")
      .select("session_key, driver_number, date, gap_to_leader, interval")
      .eq("session_key", sessionKeyNum)
      .order("date", { ascending: true });

    if (driverNumberNum !== undefined) {
      query = query.eq("driver_number", driverNumberNum);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[api/intervals] Supabase error:", error.message);
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (err) {
    console.error("[api/intervals] Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
