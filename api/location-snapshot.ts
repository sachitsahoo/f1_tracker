import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Location } from "../src/types/f1.ts";
import { checkRateLimit, clientIp, isValidIsoDate } from "../lib/rateLimit";

// ─── Module-level caches (persist across warm Fluid Compute invocations) ──────

/**
 * Location data cache.
 * Key:   `${sessionKey}:${dateGt}:${dateLt}`
 * Value: full OpenF1 response array for that window.
 *
 * Historical location data is immutable — once a race lap has ended its
 * telemetry never changes — so entries never need invalidation.
 * CACHE_MAX limits memory on any single warm instance.
 */
const locationCache = new Map<string, Location[]>();
// 53 laps × ~660 KB ≈ 35 MB per race. 150 entries covers ~3 full races
// comfortably within the 1 GB Vercel function memory limit.
const CACHE_MAX = 150;

/**
 * JWT token cache — same pattern as api/token.ts and api/live.ts.
 * Avoids re-fetching a token on every cache miss.
 */
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getBearerToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const { OPENF1_USERNAME, OPENF1_PASSWORD } = process.env;
  if (!OPENF1_USERNAME || !OPENF1_PASSWORD) return null;

  const upstream = await fetch("https://api.openf1.org/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: OPENF1_USERNAME,
      password: OPENF1_PASSWORD,
    }),
  });

  if (!upstream.ok) return null;
  const body = (await upstream.json()) as { access_token?: string };
  if (!body.access_token) return null;

  cachedToken = body.access_token;
  tokenExpiresAt = Date.now() + 3_500_000;
  return cachedToken;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * GET /api/location-snapshot
 *
 * Server-side caching proxy for OpenF1 `/v1/location` date-window queries.
 *
 * Query params:
 *   session_key  required  positive integer
 *   date_gt      optional  ISO 8601 — lower bound of the window (exclusive)
 *   date_lt      optional  ISO 8601 — upper bound of the window (exclusive)
 *
 * For a given (session_key, date_gt, date_lt) the response is cached
 * indefinitely in memory — historical telemetry never changes. Concurrent
 * requests for the same key are served from cache after the first miss,
 * so N users scrubbing the same replay lap produce exactly 1 OpenF1 call.
 *
 * Returns the raw OpenF1 Location array. Errors from OpenF1 are surfaced
 * as 502 so the frontend can handle them explicitly.
 */
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

  // ── Optional date bounds — validate ISO 8601 format before URL interpolation ─

  const rawDateGt = req.query["date_gt"];
  const rawDateLt = req.query["date_lt"];
  const dateGt = typeof rawDateGt === "string" ? rawDateGt : "";
  const dateLt = typeof rawDateLt === "string" ? rawDateLt : "";

  if (dateGt && !isValidIsoDate(dateGt)) {
    res
      .status(400)
      .json({ error: "date_gt must be a valid ISO 8601 datetime" });
    return;
  }
  if (dateLt && !isValidIsoDate(dateLt)) {
    res
      .status(400)
      .json({ error: "date_lt must be a valid ISO 8601 datetime" });
    return;
  }

  // ── Cache lookup ────────────────────────────────────────────────────────────
  // Deterministic key: same session + same lap boundary → same timestamps →
  // same key for every user, making the cache maximally effective.

  const cacheKey = `${sessionKey}:${dateGt}:${dateLt}`;

  if (locationCache.has(cacheKey)) {
    // Serve from cache — no OpenF1 call, no rate-limit consumption.
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.status(200).json(locationCache.get(cacheKey));
    return;
  }

  // ── Cache miss — fetch from OpenF1 ─────────────────────────────────────────
  // Build URL with literal `date>` / `date<` operators: OpenF1 requires these
  // exact characters and does not accept their percent-encoded equivalents.

  let url = `https://api.openf1.org/v1/location?session_key=${sessionKey}`;
  if (dateGt) url += `&date>${dateGt}`;
  if (dateLt) url += `&date<${dateLt}`;

  const token = await getBearerToken();
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers });
  } catch (err) {
    console.error("[api/location-snapshot] fetch error:", err);
    res.status(502).json({ error: "Failed to reach OpenF1" });
    return;
  }

  if (!upstream.ok) {
    res.status(502).json({ error: `OpenF1 returned ${upstream.status}` });
    return;
  }

  const data = (await upstream.json()) as Location[];

  // ── Populate cache ──────────────────────────────────────────────────────────
  // Evict the oldest entry when at capacity (FIFO — insertion order in Map).

  if (locationCache.size >= CACHE_MAX) {
    const oldest = locationCache.keys().next().value;
    if (oldest !== undefined) locationCache.delete(oldest);
  }
  locationCache.set(cacheKey, data);

  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.status(200).json(data);
}
