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

const BASE_URL = "https://api.openf1.org/v1";

// ─── Internal helper ──────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    const error: ApiError = {
      status: res.status,
      message,
      isRateLimit: res.status === 429,
    };
    throw error;
  }
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
  const res = await fetch(`${BASE_URL}/sessions?year=${year}`);
  const sessions = await handleResponse<Session[]>(res);

  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(b.date_start).getTime() - new Date(a.date_start).getTime(),
  );

  const latest = sorted[0];
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

// ─── Drivers ──────────────────────────────────────────────────────────────────

/**
 * Returns all drivers for a given session. Static per session — only needs
 * fetching once per session key change.
 */
export async function getDrivers(
  sessionKey: number | "latest",
): Promise<Driver[]> {
  const res = await fetch(`${BASE_URL}/drivers?session_key=${sessionKey}`);
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
  if (dateGt !== undefined) params.set("date_gt", dateGt);
  const res = await fetch(`${BASE_URL}/position?${params.toString()}`);
  return handleResponse<Position[]>(res);
}

// ─── Locations (telemetry X/Y/Z) ─────────────────────────────────────────────

/**
 * Returns raw telemetry X/Y/Z coordinates per driver. Poll every ~1 s.
 * Pass `dateGt` on subsequent polls. Coordinates must be normalised via
 * `src/utils/coordinates.ts` before use in SVG.
 */
export async function getLocations(
  sessionKey: number | "latest",
  dateGt?: string,
): Promise<Location[]> {
  const params = new URLSearchParams({ session_key: String(sessionKey) });
  if (dateGt !== undefined) params.set("date_gt", dateGt);
  const res = await fetch(`${BASE_URL}/location?${params.toString()}`);
  return handleResponse<Location[]>(res);
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
  if (dateGt !== undefined) params.set("date_gt", dateGt);
  const res = await fetch(`${BASE_URL}/intervals?${params.toString()}`);
  return handleResponse<Interval[]>(res);
}

// ─── Stints (tires) ───────────────────────────────────────────────────────────

/**
 * Returns tire compound and stint info per driver. Updated per pit stop —
 * no `dateGt` filtering needed; re-fetch the full list each time.
 */
export async function getStints(
  sessionKey: number | "latest",
): Promise<Stint[]> {
  const res = await fetch(`${BASE_URL}/stints?session_key=${sessionKey}`);
  return handleResponse<Stint[]>(res);
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
  if (dateGt !== undefined) params.set("date_gt", dateGt);
  const res = await fetch(`${BASE_URL}/race_control?${params.toString()}`);
  return handleResponse<RaceControl[]>(res);
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
  if (dateGt !== undefined) params.set("date_gt", dateGt);
  const res = await fetch(`${BASE_URL}/laps?${params.toString()}`);
  return handleResponse<Lap[]>(res);
}
