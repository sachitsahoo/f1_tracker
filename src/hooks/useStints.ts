import { useState, useEffect, useCallback } from "react";
import { getBackendStints } from "../api/openf1";
import type { Stint, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 30_000;

export interface UseStintsResult {
  stints: Stint[];
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches stints from GET /api/stints?session_key=<key>[&driver_number=<n>].
 *
 * The backend queries Supabase directly and passes `lap_start` through as-is
 * (nullable). Consumers should treat `stint.lap_start` as `number | null`.
 *
 * When `isLive` is true (default): polls every 30 s (tire data changes per pit stop).
 * When `isLive` is false (historical): fires one immediate fetch then stops.
 *
 * @param sessionKey   - The numeric session key. Polling is skipped when null.
 * @param isLive       - Whether the session is currently live. Defaults to true.
 * @param driverNumber - Optional driver number to narrow the query to one driver.
 */
export function useStints(
  sessionKey: number | null,
  isLive = true,
  driverNumber?: number,
): UseStintsResult {
  const [stints, setStints] = useState<Stint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Clear stints when session changes
  useEffect(() => {
    setStints([]);
  }, [sessionKey]);

  const poll = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getBackendStints(sessionKey, driverNumber);
      setStints(data);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [sessionKey, driverNumber]);

  // Immediate initial fetch so historical sessions load before the interval fires.
  useEffect(() => {
    if (sessionKey === null) return;
    void poll();
  }, [sessionKey, poll]);

  // Ongoing polling — only while the session is live.
  useInterval(poll, isLive && sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { stints, loading, error };
}
