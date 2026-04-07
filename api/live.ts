import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, clientIp } from "./_shared";
import { createClient } from "@supabase/supabase-js";
import type {
  Position,
  Interval,
  Location,
  Stint,
  RaceControl,
} from "../src/types/f1.ts";

// ─── Module-level token cache (persists across warm invocations) ──────────────
// Mirrors the same cache pattern as api/token.ts — do NOT call /api/token via
// HTTP; import the logic directly so both handlers share warm-function state.

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Date.now() + 3500 * 1000

async function getBearerToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const { OPENF1_USERNAME, OPENF1_PASSWORD } = process.env;
  if (!OPENF1_USERNAME || !OPENF1_PASSWORD) {
    throw new Error("OpenF1 credentials not configured");
  }

  const upstream = await fetch("https://api.openf1.org/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: OPENF1_USERNAME,
      password: OPENF1_PASSWORD,
    }),
  });

  if (!upstream.ok) {
    throw new Error(`OpenF1 token endpoint returned ${upstream.status}`);
  }

  const body = (await upstream.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("OpenF1 did not return an access_token");
  }

  cachedToken = body.access_token;
  tokenExpiresAt = Date.now() + 3_500_000; // 3500 s — 100 s safety margin
  return cachedToken;
}

// ─── Live window helper ───────────────────────────────────────────────────────

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function isWithinLiveWindow(dateStart: string, dateEnd: string): boolean {
  const now = Date.now();
  const start = new Date(dateStart).getTime();
  const end = new Date(dateEnd).getTime() + TWO_HOURS_MS;
  return now >= start && now <= end;
}

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

  res.setHeader("Cache-Control", "no-store");

  // ── Validate session_key ────────────────────────────────────────────────────

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

  // ── Validate environment ────────────────────────────────────────────────────

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json({ error: "Database credentials not configured" });
    return;
  }

  try {
    // ── Check live window against Supabase session row ────────────────────────

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: sessionRow, error: dbError } = await supabase
      .from("sessions")
      .select("date_start, date_end")
      .eq("session_key", sessionKey)
      .single();

    if (dbError || !sessionRow) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!isWithinLiveWindow(sessionRow.date_start, sessionRow.date_end)) {
      res.status(200).json({ live: false });
      return;
    }

    // ── Acquire JWT ───────────────────────────────────────────────────────────

    let token: string;
    try {
      token = await getBearerToken();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Token acquisition failed";
      res.status(503).json({ error: message });
      return;
    }

    const authHeaders = { Authorization: `Bearer ${token}` };
    const BASE = "https://api.openf1.org/v1";
    const sk = String(sessionKey);

    // ── Fetch all five endpoints in parallel ──────────────────────────────────

    const [posRes, intRes, locRes, stintRes, rcRes] = await Promise.all([
      fetch(`${BASE}/position?session_key=${sk}`, { headers: authHeaders }),
      fetch(`${BASE}/intervals?session_key=${sk}`, { headers: authHeaders }),
      fetch(`${BASE}/location?session_key=${sk}`, { headers: authHeaders }),
      fetch(`${BASE}/stints?session_key=${sk}`, { headers: authHeaders }),
      fetch(`${BASE}/race_control?session_key=${sk}`, { headers: authHeaders }),
    ]);

    // Surface the first upstream failure with its status code
    const failed = [posRes, intRes, locRes, stintRes, rcRes].find((r) => !r.ok);
    if (failed) {
      res
        .status(502)
        .json({ error: `OpenF1 upstream returned ${failed.status}` });
      return;
    }

    const [positions, intervals, locations, stints, raceControl] =
      (await Promise.all([
        posRes.json(),
        intRes.json(),
        locRes.json(),
        stintRes.json(),
        rcRes.json(),
      ])) as [Position[], Interval[], Location[], Stint[], RaceControl[]];

    res.status(200).json({
      live: true,
      positions,
      intervals,
      locations,
      stints,
      raceControl,
    });
  } catch (err) {
    console.error("[api/live] Unexpected error:", err);
    const message =
      err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
}
