import { useState, useEffect, useRef, useCallback } from "react";

import { getWeather } from "../api/openf1";
import type { Weather, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 60_000;

// ─── Return shape ─────────────────────────────────────────────────────────────

export interface UseWeatherResult {
  /**
   * All weather samples for the session, in chronological (date asc) order.
   * OpenF1 emits ~1 sample/minute, so a 2-hour race fits comfortably in
   * memory and can be filtered client-side by replay cutoff.
   */
  samples: Weather[];
  /** True only on the very first fetch before any data has arrived. */
  loading: boolean;
  error: ApiError | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches `GET /api/openf1/weather?session_key=<key>` once on session
 * change, and re-polls every 60 s while `isLive === true`. Weather changes
 * slowly enough that minute-granularity is plenty.
 *
 * Pauses automatically when `sessionKey` is null. In replay mode the hook
 * fires one fetch and then sits idle — the entire session's samples are
 * cached in state, and the caller picks whichever sample is appropriate
 * for the current replay cutoff.
 */
export function useWeather(
  sessionKey: number | null,
  isLive = true,
): UseWeatherResult {
  const [samples, setSamples] = useState<Weather[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  const initialFetchDoneRef = useRef(false);

  // Reset state whenever the session changes.
  useEffect(() => {
    initialFetchDoneRef.current = false;
    setSamples([]);
    setLoading(true);
    setError(null);
  }, [sessionKey]);

  const poll = useCallback(async () => {
    if (sessionKey === null) return;
    try {
      const data = await getWeather(sessionKey);
      setSamples(data);
      setError(null);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
      initialFetchDoneRef.current = true;
    }
  }, [sessionKey]);

  // Initial fetch on session change. Done as an effect rather than relying on
  // useInterval's leading-edge call so it runs even when isLive is false
  // (replay mode — we want one fetch then nothing).
  useEffect(() => {
    if (sessionKey === null) return;
    poll();
  }, [sessionKey, poll]);

  // Live mode: refresh every 60s. Skipped automatically in replay (isLive=false).
  useInterval(poll, isLive && sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { samples, loading, error };
}
