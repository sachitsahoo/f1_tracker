import type { VercelRequest, VercelResponse } from "@vercel/node";
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

  // ── Validate required query params ─────────────────────────────────────────

  const { session_key, driver_number } = req.query;

  if (!session_key || typeof session_key !== "string") {
    res
      .status(400)
      .json({ error: "Missing required query parameter: session_key" });
    return;
  }

  const parsedSessionKey = parseInt(session_key, 10);
  if (isNaN(parsedSessionKey)) {
    res.status(400).json({ error: "Invalid session_key: must be an integer" });
    return;
  }

  let parsedDriverNumber: number | null = null;
  if (driver_number !== undefined) {
    if (typeof driver_number !== "string") {
      res
        .status(400)
        .json({ error: "Invalid driver_number: must be a single value" });
      return;
    }
    parsedDriverNumber = parseInt(driver_number, 10);
    if (isNaN(parsedDriverNumber)) {
      res
        .status(400)
        .json({ error: "Invalid driver_number: must be an integer" });
      return;
    }
  }

  // ── Validate environment ────────────────────────────────────────────────────

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Database credentials not configured" });
    return;
  }

  // ── Query Supabase ──────────────────────────────────────────────────────────

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query = supabase
      .from("positions")
      .select("driver_number, date, position, session_key")
      .eq("session_key", parsedSessionKey)
      .order("date", { ascending: true });

    if (parsedDriverNumber !== null) {
      query = query.eq("driver_number", parsedDriverNumber);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
}
