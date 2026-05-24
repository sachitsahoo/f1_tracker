import { useState, useEffect, useRef, useCallback } from "react";
import type { Location, ApiError } from "../types/f1";
import type { UseLocationsResult } from "./useLocations";
import { hasAuthKey } from "../api/auth";
import { getLocations } from "../api/openf1";
import { subscribeTopic, isMqttConnected } from "../api/mqtt";
import { useInterval } from "./useInterval";

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATION_TOPIC = "v1/location";
const REST_POLL_MS = 1_000;

// ─── MQTT message shape (REST Location + two extra fields) ────────────────────

interface LocationMessage extends Location {
  _id?: number;
  _key?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Provides driver location data via two complementary paths:
 *
 *  REST polling (always active, 1 s interval)
 *    Seeds the map immediately with existing session data and keeps it
 *    updated.  Critical for sessions that are already in progress or
 *    finished — MQTT has no backfill for data before connection time.
 *
 *  MQTT stream (active when VITE_USE_TOKEN_PROXY=true)
 *    Overlaid on top of REST for lower-latency live updates.  Messages
 *    are merged into the same state; the cursor prevents REST from
 *    re-fetching data already delivered by MQTT.
 *
 * Returns the same { locations, loading, error } shape as useLocations()
 * so it is a drop-in replacement in App.tsx.
 */
export function useLocationStream(
  sessionKey: number | null,
  isLive = true,
): UseLocationsResult {
  const [locations, setLocations] = useState<Record<number, Location>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  // ── Shared location merge ──────────────────────────────────────────────────
  const mergeLocation = useCallback((loc: Location) => {
    setLocations((prev) => {
      const existing = prev[loc.driver_number];
      if (existing && loc.date <= existing.date) return prev;
      return { ...prev, [loc.driver_number]: loc };
    });
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // Path A — REST polling (always on)
  // Seeds existing session data and acts as safety net when MQTT is absent.
  // ══════════════════════════════════════════════════════════════════════════

  const cursorRef = useRef<string | undefined>(undefined);
  // True while an MQTT connection is established — REST polling backs off.
  const mqttLiveRef = useRef(false);

  // Returns an ISO timestamp 5 s in the past. Used as the cold-start cursor
  // and as the 422-recovery cursor so we never ask OpenF1 for an unbounded
  // amount of /location data. Mid-race the full session can be megabytes;
  // OpenF1 explicitly rejects those requests with 422 "too much data at once."
  const recentCursor = (): string => new Date(Date.now() - 5_000).toISOString();

  const poll = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return;

    // Always send a bounded date_gt. Cold start and 422 recovery both
    // fall through to recentCursor() instead of an unbounded fetch.
    const dateGt = cursorRef.current ?? recentCursor();
    const isColdStart = cursorRef.current === undefined;

    if (isColdStart) setLoading(true);
    setError(null);

    try {
      const batch = await getLocations(sessionKey, dateGt);

      if (batch.length > 0) {
        const latestDate = batch.reduce(
          (max, l) => (l.date > max ? l.date : max),
          batch[0].date,
        );
        cursorRef.current = latestDate;
        batch.forEach(mergeLocation);
      } else {
        // Empty batch — advance cursor past the window we just polled
        // so we don't re-fetch the same 5 s of nothing every tick.
        cursorRef.current = dateGt;
      }
    } catch (err) {
      const apiErr = err as ApiError;
      // 422 = "too much data at once". Clear cursor; next poll falls
      // through to recentCursor() so the request stays bounded.
      if (apiErr?.status === 422) {
        cursorRef.current = undefined;
      }
      setError(apiErr);
    } finally {
      setLoading(false);
    }
  }, [sessionKey, mergeLocation]);

  // Poll only when session is live AND MQTT is not covering it.
  // Historical sessions get one seed fetch (above) then stop entirely.
  useInterval(
    poll,
    isLive && sessionKey !== null && !mqttLiveRef.current ? REST_POLL_MS : null,
  );

  // Seed the map immediately on mount regardless of MQTT status —
  // MQTT has no backfill for data before connection time.
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    if (sessionKey === null || initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    void poll();
  }, [sessionKey, poll]);

  // ══════════════════════════════════════════════════════════════════════════
  // Path B — MQTT stream (authenticated tier only, layered on top of REST)
  // The only working live source for /location in 2026 — REST returns empty
  // arrays during live sessions. Subscribes through the shared mqtt module
  // so we don't open a separate WebSocket per hook.
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!hasAuthKey || sessionKey === null) return;

    const unsubscribe = subscribeTopic<LocationMessage>(
      LOCATION_TOPIC,
      (msg) => {
        if (msg.session_key !== sessionKey) return;

        const loc: Location = {
          driver_number: msg.driver_number,
          date: msg.date,
          x: msg.x,
          y: msg.y,
          z: msg.z,
          session_key: msg.session_key,
        };

        // Advance the REST cursor so any concurrent poll skips data already
        // received here. mqttLiveRef tracks broker-connected state so REST
        // polling stands down once MQTT is delivering.
        mqttLiveRef.current = isMqttConnected();
        if (!cursorRef.current || loc.date > cursorRef.current) {
          cursorRef.current = loc.date;
        }
        mergeLocation(loc);
      },
    );

    return () => {
      unsubscribe();
      mqttLiveRef.current = false;
    };
  }, [sessionKey, mergeLocation]);

  return { locations, loading, error };
}
