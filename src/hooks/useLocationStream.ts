import { useState, useEffect, useRef, useCallback } from "react";
import mqtt from "mqtt";
import type { Location, ApiError } from "../types/f1";
import type { UseLocationsResult } from "./useLocations";
import { getMqttCredentials, hasAuthKey } from "../api/auth";
import { getLocations } from "../api/openf1";
import { emitApiEvent } from "../utils/apiEvents";
import { useInterval } from "./useInterval";

// ─── Constants ────────────────────────────────────────────────────────────────

const MQTT_BROKER_URL = "wss://mqtt.openf1.org:8084/mqtt";
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

  const poll = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return;

    if (cursorRef.current === undefined) setLoading(true);
    setError(null);

    try {
      const batch = await getLocations(sessionKey, cursorRef.current);

      if (batch.length > 0) {
        const latestDate = batch.reduce(
          (max, l) => (l.date > max ? l.date : max),
          batch[0].date,
        );
        cursorRef.current = latestDate;
        batch.forEach(mergeLocation);
      }
    } catch (err) {
      setError(err as ApiError);
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
  // Delivers live updates with lower latency than the 1 s REST poll.
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!hasAuthKey || sessionKey === null) return;

    let cancelled = false;
    let client: mqtt.MqttClient | undefined;

    async function connect() {
      const creds = await getMqttCredentials();
      if (!creds || cancelled) return;

      client = mqtt.connect(MQTT_BROKER_URL, {
        username: creds.username,
        password: creds.password,
        reconnectPeriod: 5_000,
        connectTimeout: 10_000,
      });

      client.on("connect", () => {
        mqttLiveRef.current = true;
        emitApiEvent("success", "");

        client!.subscribe(LOCATION_TOPIC, (err) => {
          if (err) {
            emitApiEvent(
              "network-error",
              `MQTT subscribe error: ${err.message}`,
            );
          }
        });
      });

      client.on("message", (_topic: string, payload: Buffer) => {
        try {
          const msg = JSON.parse(payload.toString()) as LocationMessage;
          if (msg.session_key !== sessionKey) return;

          const loc: Location = {
            driver_number: msg.driver_number,
            date: msg.date,
            x: msg.x,
            y: msg.y,
            z: msg.z,
            session_key: msg.session_key,
          };

          // Advance the REST cursor so polling skips data already received here.
          if (!cursorRef.current || loc.date > cursorRef.current) {
            cursorRef.current = loc.date;
          }

          mergeLocation(loc);
        } catch {
          // Malformed JSON — skip
        }
      });

      client.on("error", (err: Error) => {
        mqttLiveRef.current = false;
        emitApiEvent("network-error", `MQTT error: ${err.message}`);
      });

      client.on("offline", () => {
        mqttLiveRef.current = false;
        emitApiEvent("network-error", "MQTT offline — REST polling will cover");
      });
    }

    void connect();

    return () => {
      cancelled = true;
      mqttLiveRef.current = false;
      client?.end(true);
    };
  }, [sessionKey, mergeLocation]);

  return { locations, loading, error };
}
