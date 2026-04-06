import { useState, useEffect, useRef, useCallback } from "react";

import { getRaceControlFromApi } from "../api/openf1";
import type { RaceControl, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 10_000;

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

  // Ongoing polling — only while the session is live.
  useInterval(poll, isLive && sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { messages, loading, error };
}
