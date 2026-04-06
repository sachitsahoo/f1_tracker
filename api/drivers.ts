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

  const { session_key } = req.query;
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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Supabase credentials not configured" });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("session_key", sessionKeyNum);

  if (error) {
    console.error("[api/drivers] Supabase error:", error.message);
    res.status(500).json({ error: "Failed to query drivers" });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json(data);
}
