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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Supabase credentials not configured" });
    return;
  }

  const year =
    typeof req.query.year === "string" && req.query.year.trim() !== ""
      ? parseInt(req.query.year, 10)
      : new Date().getFullYear();

  if (isNaN(year)) {
    res.status(400).json({ error: "Invalid year parameter" });
    return;
  }

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
    res.status(500).json({ error: error.message });
    return;
  }

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, stale-while-revalidate=300",
  );
  res.status(200).json(data);
}
