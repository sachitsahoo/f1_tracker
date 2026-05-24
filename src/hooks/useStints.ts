import { useState, useEffect, useCallback } from "react";
import { getBackendStints } from "../api/openf1";
import { hasAuthKey } from "../api/auth";
import { subscribeTopic } from "../api/mqtt";
import type { Stint, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 30_000;
const STINTS_TOPIC = "v1/stints";

interface StintMessage extends Stint {
  _id?: number;
  _key?: string;
}

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

  // REST polling — gated off when MQTT is available.
  useInterval(
    poll,
    isLive && sessionKey !== null && !hasAuthKey ? POLL_INTERVAL_MS : null,
  );

  // ── MQTT live stream ─────────────────────────────────────────────────────
  // OpenF1 publishes a stint record per driver per pit stop. Dedupe by
  // (driver_number, lap_start) and replace in place so lap_end updates as
  // the stint progresses.
  useEffect(() => {
    if (!hasAuthKey || sessionKey === null || !isLive) return;
    const unsubscribe = subscribeTopic<StintMessage>(STINTS_TOPIC, (msg) => {
      if (msg.session_key !== sessionKey) return;
      if (driverNumber !== undefined && msg.driver_number !== driverNumber)
        return;
      const stint: Stint = {
        driver_number: msg.driver_number,
        lap_start: msg.lap_start,
        lap_end: msg.lap_end,
        compound: msg.compound,
        tyre_age_at_start: msg.tyre_age_at_start,
        session_key: msg.session_key,
      };
      setStints((prev) => {
        const idx = prev.findIndex(
          (s) =>
            s.driver_number === stint.driver_number &&
            s.lap_start === stint.lap_start,
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = stint;
          return next;
        }
        return [...prev, stint];
      });
      setLoading(false);
      setError(null);
    });
    return unsubscribe;
  }, [sessionKey, isLive, driverNumber]);

  return { stints, loading, error };
}
