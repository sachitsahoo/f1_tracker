import { useState, useEffect } from "react";
import { getLaps } from "../api/openf1";
import type { Lap, ApiError } from "../types/f1";

export interface UseLapsResult {
  laps: Lap[];
  totalLaps: number | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches all laps for the given session once on mount / session change.
 * No polling — lap data for a completed race is static.
 *
 * `totalLaps` is the highest `lap_number` seen across all drivers.
 * Returns `null` while loading or when sessionKey is null.
 */
export function useLaps(sessionKey: number | null): UseLapsResult {
  const [laps, setLaps] = useState<Lap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (sessionKey === null) {
      setLaps([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getLaps(sessionKey)
      .then((data) => {
        if (!cancelled) setLaps(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err as ApiError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  const totalLaps =
    laps.length > 0 ? Math.max(...laps.map((l) => l.lap_number)) : null;

  return { laps, totalLaps, loading, error };
}
