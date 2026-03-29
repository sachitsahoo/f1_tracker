import { useState, useEffect, useCallback } from "react";
import { getStints } from "../api/openf1";
import type { Stint, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 30_000;

export interface UseStintsResult {
  stints: Stint[];
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches /v1/stints for the given session.
 *
 * When `isLive` is true (default): polls every 30 s (tire data changes per pit stop).
 * When `isLive` is false (historical): fires one immediate fetch then stops.
 */
export function useStints(
  sessionKey: number | null,
  isLive = true,
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
      const data = await getStints(sessionKey);
      setStints(data);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  // Immediate initial fetch so historical sessions load before the interval fires.
  useEffect(() => {
    if (sessionKey === null) return;
    void poll();
  }, [sessionKey, poll]);

  // Ongoing polling — only while the session is live.
  useInterval(poll, isLive && sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { stints, loading, error };
}
