/**
 * Shared utilities for Vercel Serverless Functions.
 *
 * IMPORTANT: This file must live inside api/ so Vercel's esbuild bundler
 * includes it when functions do `import { ... } from "./_shared"`.
 * Files outside api/ (e.g. lib/) are NOT bundled by Vercel.
 *
 * Vercel excludes files whose names start with "_" from being deployed as
 * function endpoints, so this file is safe to co-locate here.
 */

import type { VercelRequest } from "@vercel/node";

// ─── Rate limiting ────────────────────────────────────────────────────────────

interface IpRecord {
  count: number;
  windowStart: number;
}

const TIERS = {
  token: { max: 10, windowMs: 60_000 },
  data: { max: 120, windowMs: 60_000 },
} as const;

export type RateLimitTier = keyof typeof TIERS;

const maps: Record<RateLimitTier, Map<string, IpRecord>> = {
  token: new Map(),
  data: new Map(),
};

/**
 * Returns `true` if the request should be rejected (rate limit exceeded).
 * Call early in the handler; return 429 when true.
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

/** Extracts the real client IP from Vercel's x-forwarded-for header. */
export function clientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return (req.socket as { remoteAddress?: string })?.remoteAddress ?? "unknown";
}

// ─── Input validation ─────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Returns true when the string is a valid ISO 8601 datetime. */
export function isValidIsoDate(s: string): boolean {
  return ISO_DATE_RE.test(s) && !isNaN(Date.parse(s));
}

/**
 * Validates and converts a query param to a positive integer.
 * Returns the number on success, or null if invalid.
 */
export function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
