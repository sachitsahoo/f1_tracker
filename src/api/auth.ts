/**
 * OpenF1 authentication — client-side token proxy layer.
 *
 * Credentials (username + password) live exclusively in Vercel platform
 * environment variables and are never shipped to the browser.
 *
 * The browser fetches a short-lived JWT from /api/token (our own serverless
 * function) and caches it in memory for the session.  Tokens are refreshed
 * automatically 100 s before they expire, or immediately on a 401 response.
 *
 * In local dev: run `vercel dev` to serve both Vite and the /api/token
 * function together.  Or set VITE_USE_TOKEN_PROXY=false to skip auth and
 * use the unauthenticated OpenF1 free tier.
 */

import type { TokenProxyResponse } from "../types/f1";

// ─── Build-time flag ──────────────────────────────────────────────────────────

/** True when the token proxy is enabled (production + vercel dev). */
export const hasAuthKey: boolean =
  import.meta.env.VITE_USE_TOKEN_PROXY === "true";

// ─── Module-level cache ───────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Date.now() + 3500 * 1000

/** Deduplicate concurrent callers — they all await the same fetch. */
let inflight: Promise<string | null> | null = null;

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function fetchTokenFromProxy(): Promise<string | null> {
  try {
    const res = await fetch("/api/token");

    if (res.status === 503) {
      // Credentials not configured — don't spin, return null permanently
      tokenExpiresAt = Date.now() + 60_000; // retry in 1 min
      return null;
    }

    if (!res.ok) return null;

    const body = (await res.json()) as TokenProxyResponse;
    cachedToken = body.token;
    tokenExpiresAt = Date.now() + 3_500_000;
    return cachedToken;
  } catch {
    return null;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Returns a valid Bearer token, fetching or refreshing as needed.
 * Multiple concurrent callers share a single in-flight request.
 * Returns null when the proxy is disabled or credentials are unconfigured.
 */
export async function getBearerToken(): Promise<string | null> {
  if (!hasAuthKey) return null;

  // Cache hit
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  // Deduplicate concurrent callers
  if (inflight) return inflight;

  inflight = fetchTokenFromProxy().finally(() => {
    inflight = null;
  });

  return inflight;
}

/**
 * Zeroes the token cache without triggering a new fetch.
 * Call this before getBearerToken() to force a refresh (e.g. on 401).
 */
export function invalidateToken(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

/**
 * Returns an `Authorization: Bearer` header record when a token is available.
 * Async — awaits getBearerToken() internally.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getBearerToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Returns MQTT credentials when a token is available, null otherwise.
 * The access token doubles as the MQTT password (OpenF1 token-based auth).
 */
export async function getMqttCredentials(): Promise<{
  username: string;
  password: string;
} | null> {
  const token = await getBearerToken();
  if (!token) return null;
  return { username: "f1-live-tracker", password: token };
}
