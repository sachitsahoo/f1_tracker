import type {
  Session,
  Driver,
  Position,
  Location,
  Interval,
  Stint,
  RaceControl,
  Lap,
  ApiError,
} from "../types/f1.ts";
import { emitApiEvent } from "../utils/apiEvents";
import { getBearerToken, invalidateToken } from "./auth";

// In dev the Vite proxy rewrites /api/openf1/* → https://api.openf1.org/v1/*
// In production Vercel rewrites handle the same forwarding (see vercel.json).
const BASE_URL = "/api/openf1";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Normalises an ISO 8601 timestamp to UTC `Z` notation before it is used as a
 * query-parameter value.
 *
 * OpenF1 returns timestamps like `2025-12-07T14:38:30.459000+00:00`.
 * When that string is passed to `URLSearchParams.set()` the `+` is percent-
 * encoded to `%2B`, producing `…%2B00:00`.  The OpenF1 API does not recognise
 * that variant and silently returns 404 instead of data.
 *
 * Replacing `+00:00` with `Z` (and falling back to `new Date().toISOString()`
 * for any other offset) produces a clean `…T14:38:30.459000Z` that round-trips
 * through URLSearchParams without any encoding surprises.
 */
function toUtcZ(date: string): string {
  // Fast path: already in Z form
  if (date.endsWith("Z")) return date;
  // Replace trailing +00:00 (the only offset OpenF1 ever returns)
  if (date.endsWith("+00:00")) return date.slice(0, -6) + "Z";
  // Fallback: parse and re-serialise via the JS Date engine
  return new Date(date).toISOString();
}

/** Resolves after `ms` milliseconds. Used for rate-limit back-off. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Sliding-window rate limiter ──────────────────────────────────────────────
//
// OpenF1 sponsor tier: 6 req/s hard limit.  We self-limit to 5 req/s (one
// buffer slot) so a transient burst never causes a 429.
//
// Algorithm: track the start timestamps of in-flight / recently-completed
// requests in a circular list.  Before firing any request, check how many
// timestamps fall within the last 1 000 ms.  If already at the cap, sleep
// until the oldest timestamp exits the window, then proceed.
//
// React StrictMode mounts components twice in development, which doubles the
// number of simultaneous requests.  The limiter absorbs that automatically —
// excess requests queue up and drain at ≤ 5/s instead of all firing at once.

const RATE_LIMIT_PER_SEC = 5; // 1 below the 6/s hard limit
const RATE_WINDOW_MS = 1_000;
const _requestTimestamps: number[] = [];

async function acquireSlot(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;

    // Evict timestamps that have left the sliding window
    while (_requestTimestamps.length > 0 && _requestTimestamps[0] < cutoff) {
      _requestTimestamps.shift();
    }

    if (_requestTimestamps.length < RATE_LIMIT_PER_SEC) {
      _requestTimestamps.push(now);
      return; // slot acquired — proceed with the request
    }

    // Window is full: wait until the oldest slot expires, then re-check
    const waitMs = _requestTimestamps[0] + RATE_WINDOW_MS - now + 5;
    await sleep(waitMs > 0 ? waitMs : 5);
  }
}

/**
 * Builds the Authorization header for a request.
 * Returns an empty object when no token is available (unauthenticated tier).
 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Wraps `fetch` with three resilience behaviours:
 *
 *  1. **Auth header injection:** attaches a Bearer token when the token proxy
 *     is configured. Tokens are fetched/cached by getBearerToken().
 *
 *  2. **HTTP 401 (token expired):** invalidates the cached token, fetches a
 *     fresh one, and retries the request exactly once.
 *
 *  3. **HTTP 429 (rate limit):** emits a `rate-limit` warning event, backs off
 *     for 60 s (OpenF1 sponsor tier: 6 req/s · 60 req/min), then retries exactly once.
 *
 *  4. **Network error (offline / DNS / CORS):** catches the `TypeError` thrown
 *     by the browser's `fetch`, emits a `network-error` event, and rethrows a
 *     typed `ApiError` (status 0) so hooks can retain stale data gracefully.
 */
async function fetchWithRetry(
  url: string,
  retryOn401 = true,
): Promise<Response> {
  // Throttle: wait for an available slot before firing the request.
  // This prevents startup bursts from hitting the 6 req/s OpenF1 cap.
  await acquireSlot();

  let res: Response;
  const headers = await authHeaders();

  // ── Initial attempt ────────────────────────────────────────────────────────
  try {
    res = await fetch(url, { headers });
  } catch (_err) {
    emitApiEvent(
      "network-error",
      "Network connection lost — showing last known data",
    );
    const error: ApiError = {
      status: 0,
      message: "Network request failed — check your connection",
      isRateLimit: false,
    };
    throw error;
  }

  // ── 401 — token expired, refresh and retry once ────────────────────────────
  if (res.status === 401 && retryOn401) {
    invalidateToken();
    const freshHeaders = await authHeaders();
    try {
      return await fetch(url, { headers: freshHeaders });
    } catch (_err) {
      emitApiEvent("network-error", "Network error during token refresh retry");
      const error: ApiError = {
        status: 0,
        message: "Network error during token refresh retry",
        isRateLimit: false,
      };
      throw error;
    }
  }

  // ── 429 back-off + single retry ────────────────────────────────────────────
  if (res.status === 429) {
    emitApiEvent(
      "rate-limit",
      "Rate limited by OpenF1 — backing off 60 s then retrying…",
    );
    await sleep(60_000);

    const retryHeaders = await authHeaders();
    try {
      res = await fetch(url, { headers: retryHeaders });
    } catch (_err) {
      emitApiEvent(
        "network-error",
        "Network connection lost during rate-limit retry",
      );
      const error: ApiError = {
        status: 0,
        message: "Network error during rate-limit retry",
        isRateLimit: false,
      };
      throw error;
    }
  }

  return res;
}

/**
 * Validates an HTTP response and deserialises the JSON body.
 * Throws a typed `ApiError` on non-2xx status codes.
 *
 * Emits a `success` event on a valid 2xx response so that
 * NetworkStatusContext can clear any active "Connection lost" indicator.
 *
 * @param emptyOn404 - When true, a 404 is treated as an empty result ([])
 *   rather than an error.  Use this for all polling endpoints where OpenF1
 *   returns 404 to mean "no data for this query" (e.g. no positions yet,
 *   session not yet live) rather than a genuine URL error.
 */
async function handleResponse<T>(
  res: Response,
  emptyOn404 = false,
): Promise<T> {
  // 404 on polling endpoints = "no data yet" — return empty array silently.
  if (emptyOn404 && res.status === 404) {
    emitApiEvent("success", "");
    return [] as unknown as T;
  }

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    const error: ApiError = {
      status: res.status,
      message,
      isRateLimit: res.status === 429,
    };
    throw error;
  }
  // Successful response — signal the UI to clear connection-lost state.
  emitApiEvent("success", "");
  const data: unknown = await res.json();
  return data as T;
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/**
 * Fetches all sessions for the current year and returns the most recent one.
 * Uses the current year dynamically so it never needs updating between seasons.
 */
export async function getLatestSession(): Promise<Session> {
  const year = new Date().getFullYear();
  const res = await fetchWithRetry(`${BASE_URL}/sessions?year=${year}`);
  const sessions = await handleResponse<Session[]>(res);

  const now = new Date();
  const sorted = [...sessions]
    .filter((s) => new Date(s.date_start) <= now)
    .sort(
      (a, b) =>
        new Date(a.date_start).getTime() - new Date(b.date_start).getTime(),
    );

  const latest = sorted.at(-1);
  if (!latest) {
    const error: ApiError = {
      status: 404,
      message: `No sessions found for ${year}`,
      isRateLimit: false,
    };
    throw error;
  }
  return latest;
}

/**
 * Returns all Race-type sessions for `year` that have already started,
 * sorted ascending by date_start (oldest first).
 * Used by useSessions to populate the session picker.
 */
export async function getRaceSessions(year: number): Promise<Session[]> {
  const res = await fetchWithRetry(
    `${BASE_URL}/sessions?year=${year}&session_type=Race`,
  );
  const sessions = await handleResponse<Session[]>(res, true);
  const now = new Date();
  return sessions
    .filter((s) => new Date(s.date_start) <= now)
    .sort(
      (a, b) =>
        new Date(a.date_start).getTime() - new Date(b.date_start).getTime(),
    );
}

// ─── Drivers ──────────────────────────────────────────────────────────────────

/**
 * Returns all drivers for a given session. Static per session — only needs
 * fetching once per session key change.
 */
export async function getDrivers(
  sessionKey: number | "latest",
): Promise<Driver[]> {
  const res = await fetchWithRetry(
    `${BASE_URL}/drivers?session_key=${sessionKey}`,
  );
  return handleResponse<Driver[]>(res);
}

// ─── Positions ────────────────────────────────────────────────────────────────

/**
 * Returns race positions (P1–P20) per driver. Poll every ~4 s.
 * Pass `dateGt` (ISO 8601) on subsequent polls to fetch only new records.
 */
export async function getPositions(
  sessionKey: number | "latest",
  dateGt?: string,
): Promise<Position[]> {
  const params = new URLSearchParams({ session_key: String(sessionKey) });
  if (dateGt !== undefined) params.set("date_gt", toUtcZ(dateGt));
  const res = await fetchWithRetry(`${BASE_URL}/position?${params.toString()}`);
  return handleResponse<Position[]>(res, true);
}

// ─── Locations (telemetry X/Y/Z) ─────────────────────────────────────────────

/**
 * Returns raw telemetry X/Y/Z coordinates per driver. Poll every ~1 s.
 * Pass `dateGt` on subsequent polls. Coordinates must be normalised via
 * `src/utils/coordinates.ts` before use in SVG.
 *
 * `dateLt` bounds the upper end of the window — used by useLocationSnapshot
 * to fetch a fixed-width slice of history for the replay scrubber.
 *
 * ⚠️  OpenF1 filter syntax for this endpoint is `date>` / `date<`, NOT
 * `date_gt` / `date_lt`. We build those parts with string concatenation
 * instead of URLSearchParams so the `>` and `<` characters are preserved
 * as literals in the URL and are not percent-encoded to `%3E` / `%3C`.
 */
export async function getLocations(
  sessionKey: number | "latest",
  dateGt?: string,
  dateLt?: string,
): Promise<Location[]> {
  // session_key is safe for URLSearchParams; date filters are not.
  let url = `${BASE_URL}/location?session_key=${encodeURIComponent(String(sessionKey))}`;
  if (dateGt !== undefined) url += `&date>${toUtcZ(dateGt)}`;
  if (dateLt !== undefined) url += `&date<${toUtcZ(dateLt)}`;
  const res = await fetchWithRetry(url);
  return handleResponse<Location[]>(res, true);
}

// ─── Intervals (gaps) ─────────────────────────────────────────────────────────

/**
 * Returns gap-to-leader and interval to the car ahead. Poll every ~4 s.
 * Pass `dateGt` on subsequent polls to avoid re-fetching stale records.
 */
export async function getIntervals(
  sessionKey: number | "latest",
  dateGt?: string,
): Promise<Interval[]> {
  const params = new URLSearchParams({ session_key: String(sessionKey) });
  if (dateGt !== undefined) params.set("date_gt", toUtcZ(dateGt));
  const res = await fetchWithRetry(
    `${BASE_URL}/intervals?${params.toString()}`,
  );
  return handleResponse<Interval[]>(res, true);
}

// ─── Stints (tires) ───────────────────────────────────────────────────────────

/**
 * Returns tire compound and stint info per driver. Updated per pit stop —
 * no `dateGt` filtering needed; re-fetch the full list each time.
 */
export async function getStints(
  sessionKey: number | "latest",
): Promise<Stint[]> {
  const res = await fetchWithRetry(
    `${BASE_URL}/stints?session_key=${sessionKey}`,
  );
  return handleResponse<Stint[]>(res, true);
}

// ─── Race Control ─────────────────────────────────────────────────────────────

/**
 * Returns race control messages (flags, safety car, incidents). Event-driven —
 * poll every ~4 s and pass `dateGt` to filter new messages only.
 */
export async function getRaceControl(
  sessionKey: number | "latest",
  dateGt?: string,
): Promise<RaceControl[]> {
  const params = new URLSearchParams({ session_key: String(sessionKey) });
  if (dateGt !== undefined) params.set("date_gt", toUtcZ(dateGt));
  const res = await fetchWithRetry(
    `${BASE_URL}/race_control?${params.toString()}`,
  );
  return handleResponse<RaceControl[]>(res, true);
}

// ─── Laps ─────────────────────────────────────────────────────────────────────

/**
 * Returns lap times and sector times per driver. Updated once per completed lap.
 * Pass `dateGt` to fetch only laps completed since the last poll.
 */
export async function getLaps(
  sessionKey: number | "latest",
  dateGt?: string,
): Promise<Lap[]> {
  const params = new URLSearchParams({ session_key: String(sessionKey) });
  if (dateGt !== undefined) params.set("date_gt", toUtcZ(dateGt));
  const res = await fetchWithRetry(`${BASE_URL}/laps?${params.toString()}`);
  return handleResponse<Lap[]>(res, true);
}
