import { useState, useEffect, useCallback } from "react";
import { getLaps } from "../api/openf1";
import type { Lap, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 30_000;

export interface UseLapsResult {
  laps: Lap[];
  totalLaps: number | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches all laps for the given session.
 *
 * When `isLive` is true (default): re-fetches every 30 s so the FL chip,
 * LAST LAP cells, and sector chips reflect newly-completed laps within
 * about a half-lap of cadence. Lap data is small (one row per driver per
 * lap) so replacing state on each poll is cheap.
 *
 * When `isLive` is false (historical): fires one fetch on session change
 * then sits idle — the dataset is static.
 *
 * `totalLaps` is the highest `lap_number` seen across all drivers.
 * Returns `null` while loading or when sessionKey is null.
 */
export function useLaps(
  sessionKey: number | null,
  isLive = true,
): UseLapsResult {
  const [laps, setLaps] = useState<Lap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const fetchLaps = useCallback(async () => {
    if (sessionKey === null) return;
    try {
      const data = await getLaps(sessionKey);
      setLaps(data);
      setError(null);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  // Initial fetch on session change.
  useEffect(() => {
    if (sessionKey === null) {
      setLaps([]);
      return;
    }
    setLoading(true);
    setError(null);
    fetchLaps();
  }, [sessionKey, fetchLaps]);

  // Live polling — skipped automatically when isLive is false.
  useInterval(
    fetchLaps,
    isLive && sessionKey !== null ? POLL_INTERVAL_MS : null,
  );

  const totalLaps =
    laps.length > 0 ? Math.max(...laps.map((l) => l.lap_number)) : null;

  return { laps, totalLaps, loading, error };
}
