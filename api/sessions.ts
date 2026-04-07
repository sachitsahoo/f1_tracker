import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, clientIp } from "./_rateLimit";

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

  // ── Env validation ──────────────────────────────────────────────────────────

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Supabase credentials not configured" });
    return;
  }

  // ── Year param validation ───────────────────────────────────────────────────
  // Default to the current year. Reject anything outside a sane F1 range so
  // callers cannot manufacture arbitrary ISO timestamps.

  let year: number;

  if (typeof req.query.year === "string" && req.query.year.trim() !== "") {
    year = parseInt(req.query.year, 10);
    if (isNaN(year) || year < 1950 || year > 2100) {
      res
        .status(400)
        .json({ error: "year must be an integer between 1950 and 2100" });
      return;
    }
  } else {
    year = new Date().getFullYear();
  }

  // ── Supabase query ──────────────────────────────────────────────────────────

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const yearStart = `${year}-01-01T00:00:00Z`;
    const yearEnd = `${year + 1}-01-01T00:00:00Z`;

    const { data, error } = await supabase
      .from("sessions")
      .select(
        "session_key, session_name, session_type, date_start, date_end, circuit_key, year, circuit_short_name, country_name, location",
      )
      .gte("date_start", yearStart)
      .lt("date_start", yearEnd)
      .order("date_start", { ascending: false });

    if (error) {
      console.error("[/api/sessions] Supabase error:", error.message);
      res.status(500).json({ error: "Database query failed" });
      return;
    }

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    res.status(200).json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/sessions] Unexpected error:", message);
    res.status(500).json({ error: "Internal server error" });
  }
}
