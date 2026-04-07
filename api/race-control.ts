import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, clientIp, parsePositiveInt } from "../lib/rateLimit";

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

  // ── Validate session_key ────────────────────────────────────────────────────

  const sessionKeyNum = parsePositiveInt(req.query["session_key"]);
  if (sessionKeyNum === null) {
    res.status(400).json({ error: "session_key must be a positive integer" });
    return;
  }

  // ── Env validation ──────────────────────────────────────────────────────────

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Supabase credentials not configured" });
    return;
  }

  // ── Supabase query ──────────────────────────────────────────────────────────

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("race_control")
      .select("*")
      .eq("session_key", sessionKeyNum) // integer — safe
      .order("date", { ascending: true });

    if (error) {
      console.error("[/api/race-control] Supabase error:", error.message);
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/race-control] Unexpected error:", message);
    res.status(500).json({ error: "Internal server error" });
  }
}
