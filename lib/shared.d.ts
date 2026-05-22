/**
 * Type declarations for lib/shared.js — the runtime is plain ESM JavaScript
 * (see the file's docstring for why) but the api/*.ts files still need
 * proper TypeScript types when importing.
 *
 * Keep these signatures in sync with lib/shared.js.
 */

import type { VercelRequest } from "@vercel/node";

export type RateLimitTier = "token" | "data";

/**
 * Returns `true` if the request should be rejected (rate limit exceeded).
 * Call early in the handler; return 429 when true.
 */
export function checkRateLimit(ip: string, tier: RateLimitTier): boolean;

/** Extracts the real client IP from Vercel's x-forwarded-for header. */
export function clientIp(req: VercelRequest): string;

/** Returns true when the string is a valid ISO 8601 datetime. */
export function isValidIsoDate(s: string): boolean;

/**
 * Validates and converts a query param to a positive integer.
 * Returns the number on success, or null if invalid.
 */
export function parsePositiveInt(value: unknown): number | null;
