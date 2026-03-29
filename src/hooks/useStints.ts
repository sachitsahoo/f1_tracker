import { useState, useCallback } from "react";
import { getStints } from "../api/openf1";
import type { Stint, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 30_000;

export interface UseStintsResult {
  /**
   * Full list of stints for all drivers in the session.
   * Refreshed in full every 30 s — tire data changes rarely (per pit stop).
   */
  stints: Stint[];
  loading: boolean;
  error: ApiError | null;
}

/**
 * Polls /v1/stints every 30 seconds with a full refresh (no date_gt cursor).
 * Tire compound data changes only on pit stops, so a 30 s refresh is
 * sufficient and avoids the complexity of incremental merging.
 *
 * Pass `null` for sessionKey while the session is still resolving;
 * the interval is paused automatically.
 */
export function useStints(sessionKey: number | null): UseStintsResult {
  const [stints, setStints] = useState<Stint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

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

  // Pause interval when sessionKey is null
  useInterval(poll, sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { stints, loading, error };
}
