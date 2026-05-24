import { useState, useEffect, useCallback } from "react";
import { getLaps } from "../api/openf1";
import { hasAuthKey } from "../api/auth";
import { subscribeTopic } from "../api/mqtt";
import type { Lap, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 30_000;
const LAPS_TOPIC = "v1/laps";

interface LapMessage extends Lap {
  _id?: number;
  _key?: string;
}

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

  // REST polling — gated off when MQTT is available. Sponsor-tier users
  // get new laps via subscribeTopic below.
  useInterval(
    fetchLaps,
    isLive && sessionKey !== null && !hasAuthKey ? POLL_INTERVAL_MS : null,
  );

  // ── MQTT live stream ─────────────────────────────────────────────────────
  // OpenF1 publishes one message per completed lap. Dedupe by
  // (driver_number, lap_number) and replace-in-place so a corrected lap
  // (e.g. sector times updated after the lap closes) is reflected.
  useEffect(() => {
    if (!hasAuthKey || sessionKey === null || !isLive) return;
    const unsubscribe = subscribeTopic<LapMessage>(LAPS_TOPIC, (msg) => {
      if (msg.session_key !== sessionKey) return;
      const lap: Lap = {
        date_start: msg.date_start,
        driver_number: msg.driver_number,
        duration_sector_1: msg.duration_sector_1,
        duration_sector_2: msg.duration_sector_2,
        duration_sector_3: msg.duration_sector_3,
        i1_speed: msg.i1_speed,
        i2_speed: msg.i2_speed,
        is_pit_out_lap: msg.is_pit_out_lap,
        lap_duration: msg.lap_duration,
        lap_number: msg.lap_number,
        segments_sector_1: msg.segments_sector_1,
        segments_sector_2: msg.segments_sector_2,
        segments_sector_3: msg.segments_sector_3,
        st_speed: msg.st_speed,
        session_key: msg.session_key,
      };
      setLaps((prev) => {
        const idx = prev.findIndex(
          (l) =>
            l.driver_number === lap.driver_number &&
            l.lap_number === lap.lap_number,
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = lap;
          return next;
        }
        return [...prev, lap];
      });
      setLoading(false);
      setError(null);
    });
    return unsubscribe;
  }, [sessionKey, isLive]);

  const totalLaps =
    laps.length > 0 ? Math.max(...laps.map((l) => l.lap_number)) : null;

  return { laps, totalLaps, loading, error };
}
