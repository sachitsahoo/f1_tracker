import { useState, useRef, useCallback } from "react";

import { getRaceControl } from "../api/openf1";
import type { RaceControl, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 10_000;

// ─── Return shape ─────────────────────────────────────────────────────────────

export interface UseRaceControlResult {
  /**
   * All race control messages received so far for the session, in chronological
   * order. New messages are appended on each poll via the `date_gt` cursor.
   */
  messages: RaceControl[];
  /** True only on the very first fetch before any data has arrived. */
  loading: boolean;
  error: ApiError | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Polls `/v1/race_control` every 10 s for the given session, accumulating all
 * messages in chronological order. Pauses automatically when `sessionKey` is
 * null (no active session / off-season).
 *
 * Uses a `date_gt` cursor so each poll only fetches new messages — never
 * re-downloads the full history on every tick.
 */
export function useRaceControl(
  sessionKey: number | null,
): UseRaceControlResult {
  const [messages, setMessages] = useState<RaceControl[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  // Mutable cursor — the ISO date of the latest message we have already seen.
  // Passed as `date_gt` on every subsequent poll to fetch only new records.
  const cursorRef = useRef<string | undefined>(undefined);

  const poll = useCallback(async () => {
    if (sessionKey === null) return;

    try {
      const data = await getRaceControl(sessionKey, cursorRef.current);

      if (data.length > 0) {
        // Advance cursor to the newest message's timestamp
        const latest = data.reduce((a, b) =>
          new Date(a.date) >= new Date(b.date) ? a : b,
        );
        cursorRef.current = latest.date;

        // Append new messages in arrival order (API returns chronologically)
        setMessages((prev) => [...prev, ...data]);
      }

      setError(null);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  // Reset accumulated state whenever session changes
  // (sessionKey change triggers a new poll cycle via useInterval dependency)
  const prevSessionRef = useRef<number | null>(null);
  if (prevSessionRef.current !== sessionKey) {
    prevSessionRef.current = sessionKey;
    // Reset is synchronous so state is clean before next render
    if (messages.length > 0) {
      setMessages([]);
      setLoading(true);
    }
    cursorRef.current = undefined;
  }

  useInterval(poll, sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { messages, loading, error };
}
