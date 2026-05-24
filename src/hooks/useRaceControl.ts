import { useState, useEffect, useRef, useCallback } from "react";

import { getRaceControlFromApi } from "../api/openf1";
import { hasAuthKey } from "../api/auth";
import { subscribeTopic } from "../api/mqtt";
import type { RaceControl, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 10_000;
const RACE_CONTROL_TOPIC = "v1/race_control";

// MQTT messages include `_id` / `_key` metadata fields alongside the REST shape.
interface RaceControlMessage extends RaceControl {
  _id?: number;
  _key?: string;
}

// ─── Return shape ─────────────────────────────────────────────────────────────

export interface UseRaceControlResult {
  /**
   * All race control messages for the session, in chronological (date asc)
   * order as returned by the backend. Refreshed on every poll.
   */
  messages: RaceControl[];
  /** True only on the very first fetch before any data has arrived. */
  loading: boolean;
  error: ApiError | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Polls `GET /api/race-control?session_key=<key>` every 10 s for the given
 * session. The backend returns the full set of messages ordered by date
 * ascending, so state is replaced (not appended) on each successful fetch.
 *
 * Pauses automatically when `sessionKey` is null (no active session /
 * off-season). When `isLive` is false, fires one initial fetch then stops.
 */
export function useRaceControl(
  sessionKey: number | null,
  isLive = true,
): UseRaceControlResult {
  const [messages, setMessages] = useState<RaceControl[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  const initialFetchDoneRef = useRef(false);

  // Reset state whenever the session changes
  useEffect(() => {
    initialFetchDoneRef.current = false;
    setMessages([]);
    setLoading(true);
    setError(null);
  }, [sessionKey]);

  const poll = useCallback(async () => {
    if (sessionKey === null) return;

    try {
      const data = await getRaceControlFromApi(sessionKey);
      // Backend returns the full dataset ordered by date asc — replace state
      setMessages(data);
      setError(null);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  // Initial fetch — fires immediately so historical sessions load race control
  // data before the polling interval would otherwise kick in.
  useEffect(() => {
    if (sessionKey === null || initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    void poll();
  }, [sessionKey, poll]);

  // REST polling — only while live AND we don't have an MQTT path. Sponsor-tier
  // users get live messages via subscribeTopic below; the Supabase-backed REST
  // route returns empty for sessions that haven't been seeded yet anyway.
  useInterval(
    poll,
    isLive && sessionKey !== null && !hasAuthKey ? POLL_INTERVAL_MS : null,
  );

  // ── MQTT live stream ──────────────────────────────────────────────────────
  // OpenF1 publishes race control messages on `v1/race_control` for the
  // currently active sessions. Dedupe by (date | driver | message) so a
  // re-delivery on reconnect doesn't double-append.
  useEffect(() => {
    if (!hasAuthKey || sessionKey === null || !isLive) return;
    const unsubscribe = subscribeTopic<RaceControlMessage>(
      RACE_CONTROL_TOPIC,
      (msg) => {
        if (msg.session_key !== sessionKey) return;
        const event: RaceControl = {
          date: msg.date,
          driver_number: msg.driver_number,
          flag: msg.flag,
          lap_number: msg.lap_number,
          message: msg.message,
          scope: msg.scope,
          sector: msg.sector,
          session_key: msg.session_key,
        };
        const key = `${event.date}|${event.driver_number ?? ""}|${event.message}`;
        setMessages((prev) => {
          if (
            prev.some(
              (m) => `${m.date}|${m.driver_number ?? ""}|${m.message}` === key,
            )
          ) {
            return prev;
          }
          return [...prev, event].sort((a, b) =>
            a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
          );
        });
        setLoading(false);
        setError(null);
      },
    );
    return unsubscribe;
  }, [sessionKey, isLive]);

  return { messages, loading, error };
}
