/**
 * Shared in-memory IP rate limiter for Vercel Serverless Functions.
 *
 * Uses a sliding fixed-window counter per IP. State persists across warm
 * invocations but resets on cold start — acceptable given that limits are
 * set conservatively enough that a single cold-start bypass is not harmful.
 *
 * Usage:
 *   import { checkRateLimit, clientIp } from "./_rateLimit";
 *
 *   const ip = clientIp(req);
 *   if (checkRateLimit(ip, "data")) {
 *     res.status(429).json({ error: "Too many requests" });
 *     return;
 *   }
 */

import type { VercelRequest } from "@vercel/node";

// ─── Limits per named tier ────────────────────────────────────────────────────

const TIERS = {
  /** Token endpoint — tightly restricted to prevent credential hammering. */
  token: { max: 10, windowMs: 60_000 },
  /** Data endpoints — generous enough for normal polling, blocks scrapers.
   *  One browser at 1s location + 4s position + 10s race-control ≈ 75 req/min.
   *  120 allows for two concurrent tabs or users behind NAT. */
  data: { max: 120, windowMs: 60_000 },
} as const;

export type RateLimitTier = keyof typeof TIERS;

// ─── Per-tier IP maps (module-level, persists across warm invocations) ────────

interface IpRecord {
  count: number;
  windowStart: number;
}

const maps: Record<RateLimitTier, Map<string, IpRecord>> = {
  token: new Map(),
  data: new Map(),
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns `true` if the request should be rejected (rate limit exceeded).
 * Call this early in the handler and return 429 when it returns `true`.
 */
export function checkRateLimit(ip: string, tier: RateLimitTier): boolean {
  const { max, windowMs } = TIERS[tier];
  const ipLog = maps[tier];
  const now = Date.now();
  const rec = ipLog.get(ip);

  if (!rec || now - rec.windowStart > windowMs) {
    ipLog.set(ip, { count: 1, windowStart: now });
    return false;
  }

  rec.count += 1;
  return rec.count > max;
}

/**
 * Extracts the real client IP from Vercel's `x-forwarded-for` header.
 * Vercel always sets this; falls back to socket address in local dev.
 */
export function clientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return (req.socket as { remoteAddress?: string })?.remoteAddress ?? "unknown";
}

/** ISO 8601 datetime prefix — e.g. "2025-03-16T14:00:00" */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Returns `true` when the string is a valid ISO 8601 datetime.
 * Used to validate date_gt / date_lt params before URL interpolation.
 */
export function isValidIsoDate(s: string): boolean {
  return ISO_DATE_RE.test(s) && !isNaN(Date.parse(s));
}

/**
 * Validates and converts a query param to a positive integer.
 * Returns the number on success, or `null` if invalid.
 */
export function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
