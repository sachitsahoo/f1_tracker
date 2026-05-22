/**
 * Shared utilities for Vercel Serverless Functions.
 *
 * Why this is a .js file (not .ts):
 *
 *   We tried three TypeScript variants:
 *     1. api/_shared.ts        → ERR_MODULE_NOT_FOUND at /var/task/api/_shared
 *     2. lib/shared.ts (NFT)   → ERR_MODULE_NOT_FOUND at /var/task/lib/shared
 *     3. lib/shared.ts + includeFiles="lib/**"
 *                              → same ERR_MODULE_NOT_FOUND (the .ts is shipped
 *                                but Vercel doesn't transpile it; the runtime
 *                                ESM resolver can't load .ts directly).
 *
 *   Vercel's Node File Tracer traces .js relative imports out of the function
 *   directory but does NOT transpile .ts files outside api/. Writing this as
 *   plain ESM .js (with JSDoc-typed exports + a sibling .d.ts) keeps the file
 *   importable at runtime AND fully typed at compile time.
 *
 * @module
 */

// ─── Rate limiting ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} IpRecord
 * @property {number} count
 * @property {number} windowStart
 */

const TIERS = /** @type {const} */ ({
  token: { max: 10, windowMs: 60_000 },
  data: { max: 120, windowMs: 60_000 },
});

/** @type {Record<keyof typeof TIERS, Map<string, IpRecord>>} */
const maps = {
  token: new Map(),
  data: new Map(),
};

/**
 * Returns `true` if the request should be rejected (rate limit exceeded).
 * Call early in the handler; return 429 when true.
 *
 * @param {string} ip
 * @param {keyof typeof TIERS} tier
 * @returns {boolean}
 */
export function checkRateLimit(ip, tier) {
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
 * Extracts the real client IP from Vercel's x-forwarded-for header.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @returns {string}
 */
export function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return (
    /** @type {{ remoteAddress?: string } | undefined} */ (req.socket)
      ?.remoteAddress ?? "unknown"
  );
}

// ─── Input validation ───────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Returns true when the string is a valid ISO 8601 datetime.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function isValidIsoDate(s) {
  return ISO_DATE_RE.test(s) && !isNaN(Date.parse(s));
}

/**
 * Validates and converts a query param to a positive integer.
 * Returns the number on success, or null if invalid.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function parsePositiveInt(value) {
  if (typeof value !== "string") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
